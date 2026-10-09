// Render each slide of slides.html to a PNG, for the README and as a
// fallback if the deck cannot be opened on the presenting machine.
//   node slides-shot.js [outDir]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const CHANNEL = process.env.BB_BROWSER_CHANNEL || "msedge";
const ROOT = path.resolve(__dirname, "..");

(async () => {
  const outDir = process.argv[2] || path.join(ROOT, "docs", "slides");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ channel: CHANNEL });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  for (let n = 1; n <= 4; n += 1) {
    // nosemgrep: playwright-goto-injection -- constant path to the repo's own slides.html
    await page.goto(`file://${path.join(ROOT, "slides.html").replace(/\\/g, "/")}#${n}`, {
      waitUntil: "load",
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, `slide-${n}.png`) });
  }

  await browser.close();
  console.log(errors.length ? `PAGE ERRORS: ${errors.join(" | ")}` : `wrote 4 slides to ${outDir}`);
})();
