// Screenshot the dashboard. Used while iterating on the UI and for stills.
//   node shot.js <out.png> [width] [height] [waitMs]
//
// Uses the Edge that ships with Windows rather than downloading a browser.
const { chromium } = require("playwright");

const CHANNEL = process.env.BB_BROWSER_CHANNEL || "msedge";

(async () => {
  const [out = "shot.png", w = "1600", h = "1000", wait = "7000"] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: CHANNEL });
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:3100", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: out });
  await browser.close();

  console.log(errors.length ? "PAGE ERRORS:" : "no page errors");
  errors.slice(0, 10).forEach((e) => console.log("  " + e));
})();
