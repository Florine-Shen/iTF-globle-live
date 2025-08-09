import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  const year = (req.query.year || '2025').toString();
  const nation = (req.query.nation || '').toString(); // 例如 ITA / CHN / USA
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
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });

    // 尝试点“Accept” cookies（如果有）
    try {
      const btn = await page.$('button[aria-label*="Accept"],button:has-text("Accept")');
      if (btn) await btn.click();
    } catch {}

    // 解析当前页 + 自动翻页
    const seen = new Set();
    const parsePage = async () => {
      const html = await page.content();
      const re = /data-tournament-name="([^"]+)"|data-location="([^"]+)"|data-start-date="([^"]+)"|data-end-date="([^"]+)"|data-surface="([^"]+)"/gmi;
      let m, obj = { name:null, location:null, start:null, end:null, surface:null };
      const push = () => {
        if (obj.name || obj.location || obj.start) seen.add(JSON.stringify(obj));
        obj = { name:null, location:null, start:null, end:null, surface:null };
      };
      while ((m = re.exec(html)) !== null) {
        if (m[1]) obj.name = m[1].trim();
        if (m[2]) obj.location = m[2].trim();
        if (m[3]) obj.start = m[3].trim();
        if (m[4]) obj.end = m[4].trim();
        if (m[5]) obj.surface = m[5].trim();
      }
      push();
    };

    await parsePage();
    for (let i = 0; i < 60; i++) {
      const nextSel = 'a[rel="next"], button[aria-label*="Next"], .pagination .next:not(.disabled)';
      const hasNext = await page.$(nextSel);
      if (!hasNext) break;
      try {
        await Promise.all([
          page.click(nextSel),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        ]);
        await parsePage();
      } catch { break; }
    }

    const raw = Array.from(seen).map(s => JSON.parse(s));
    const toISO = (d) => {
      if (!d) return d;
      const mm = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
      const m = d.match(/(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/);
      if (m) {
        const day = String(m[1]).padStart(2,'0');
        const mon = String(mm[m[2].toLowerCase()]).padStart(2,'0');
        return `${m[3]}-${mon}-${day}`;
      }
      return d;
    };

    const items = raw.map(x => {
      const loc = (x.location || '').split(',').map(s => s.trim());
      const city = loc[0] || null;
      const country = loc[1] || null;
      const lvl = (x.name || '').match(/J\s?-?\s?(30|60|100|200)/i);
      return {
        name: x.name || null,
        city, country,
        startISO: toISO(x.start),
        endISO: toISO(x.end),
        level: lvl ? ('J' + lvl[1]) : null,
        surface: x.surface || null
      };
    }).filter(r => r.city || r.name);

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    res.status(200).json({ ok:true, source: baseUrl, count: items.length, items });
  } catch (e) {
    res.status(200).json({ ok:false, error: String(e), items: [] });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
          }
