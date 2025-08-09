import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  const year = (req.query.year || '2025').toString();
  const nation = (req.query.nation || '').toString(); // e.g. ITA / CHN / USA

  // ITF 官方筛选页：年 + 可选国家
  const baseUrl =
    'https://www.itftennis.com/en/tournament-calendar/world-tennis-tour-juniors-calendar/?categories=All&startdate=' +
    year + (nation ? '&nation=' + nation : '');

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    );
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });

    // 接受 Cookies（如果有）
    try {
      const accept = await page.$('button[aria-label*="Accept"], button:has-text("Accept")');
      if (accept) await accept.click();
    } catch {}

    const seen = new Set();

    // 解析当前页：优先读 data-* 属性；否则退化读可见表格
    const parsePage = async () => {
      const html = await page.content();

      // 方案A：ITF 页里常见的 data-* 属性
      const re =
        /data-tournament-name="([^"]+)"|data-location="([^"]+)"|data-start-date="([^"]+)"|data-end-date="([^"]+)"|data-surface="([^"]+)"/gmi;

      let m;
      let obj = { name: null, location: null, start: null, end: null, surface: null };
      const push = () => {
        if (obj.name || obj.location || obj.start) seen.add(JSON.stringify(obj));
        obj = { name: null, location: null, start: null, end: null, surface: null };
      };

      while ((m = re.exec(html)) !== null) {
        if (m[1]) obj.name = m[1].trim();
        if (m[2]) obj.location = m[2].trim();
        if (m[3]) obj.start = m[3].trim();
        if (m[4]) obj.end = m[4].trim();
        if (m[5]) obj.surface = m[5].trim();
      }
      push();

      // 方案B：若方案A几乎没有命中，则尝试直接读表格行
      if (seen.size < 3) {
        const rows = await page.$$eval('table tbody tr', trs =>
          trs.map(tr => {
            const tds = tr.querySelectorAll('td');
            return {
              date: tds[0]?.textContent?.trim() || '',
              name: tds[1]?.textContent?.trim() || '',
              location: tds[2]?.textContent?.trim() || '',
              surface: tds[3]?.textContent?.trim() || '',
            };
          })
        );

        for (const r of rows) {
          const objB = {
            name: r.name || null,
            location: r.location || null,
            start: r.date || null,
            end: null,
            surface: r.surface || null,
          };
          seen.add(JSON.stringify(objB));
        }
      }
    };

    // 解析第一页
    await parsePage();

    // 轻量分页：最多翻 5 页，避免移动端超时
    for (let i = 0; i < 5; i++) {
      const nextSel = 'a[rel="next"], button[aria-label*="Next"], .pagination .next:not(.disabled)';
      const hasNext = await page.$(nextSel);
      if (!hasNext) break;
      try {
        await Promise.all([
          page.click(nextSel),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        ]);
        await parsePage();
      } catch {
        break;
      }
    }

    const raw = Array.from(seen).map(s => JSON.parse(s));

    // 简易日期标准化（如 "12 Jan 2025" -> "2025-01-12"）
    const toISO = d => {
      if (!d) return d;
      const mm = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const m = d.match(/(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/);
      if (m) {
        const day = String(m[1]).padStart(2, '0');
        const mon = String(mm[m[2].toLowerCase()]).padStart(2, '0');
        return `${m[3]}-${mon}-${day}`;
      }
      return d;
    };

    const items = raw
      .map(x => {
        const loc = (x.location || '').split(',').map(s => s.trim());
        const city = loc[0] || null;
        const country = loc[1] || null;
        const lvl = (x.name || '').match(/J\s?-?\s?(30|60|100|200)/i);
        return {
          name: x.name || null,
          city,
          country,
          startISO: toISO(x.start),
          endISO: toISO(x.end),
          level: lvl ? 'J' + lvl[1] : null,
          surface: x.surface || null,
        };
      })
      .filter(r => r.name || r.city);

    // 关键：兼容前端预期字段 success / data
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    res.status(200).json({
      ok: true,
      success: true,
      source: baseUrl,
      count: items.length,
      items,
      data: items,
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      success: false,
      error: String(e),
      items: [],
      data: [],
    });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
  }
}
