import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto("https://www.itftennis.com/en/tournament-calendar/juniors-world-tour-calendar/", {
      waitUntil: "networkidle0",
    });

    const data = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("table tbody tr")).map(row => {
        const cols = row.querySelectorAll("td");
        return {
          date: cols[0]?.innerText.trim(),
          tournament: cols[1]?.innerText.trim(),
          location: cols[2]?.innerText.trim(),
          category: cols[3]?.innerText.trim()
        };
      });
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
  }
