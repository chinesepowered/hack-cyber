// Drive the dashboard and record it, timed to the narration.
//
// Each script segment names a UI region. We spotlight that region (dim
// everything else) for exactly as long as its narration audio runs, so the
// picture and the voice stay in sync without hand-editing a timeline.
//
//   node record.js            records demo/video/dashboard.webm

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const CHANNEL = process.env.BB_BROWSER_CHANNEL || "msedge";
const URL = process.env.BB_URL || "http://localhost:3100";
const VIDEO_DIR = path.join(__dirname, "video");
const WIDTH = 1600;
const HEIGHT = 1000;

const SPOTLIGHT_CSS = `
  [data-demo] { transition: opacity 520ms ease, filter 520ms ease; }
  body.bb-spot [data-demo] { opacity: 0.22; filter: saturate(0.5); }
  body.bb-spot [data-demo].bb-focus {
    opacity: 1;
    filter: none;
    outline: 1px solid rgba(217,137,59,0.45);
    outline-offset: 4px;
    border-radius: 14px;
  }
`;

async function spotlight(page, target) {
  await page.evaluate((name) => {
    document.querySelectorAll("[data-demo]").forEach((el) => el.classList.remove("bb-focus"));
    if (!name) {
      document.body.classList.remove("bb-spot");
      return;
    }
    document.body.classList.add("bb-spot");
    document.querySelectorAll(`[data-demo="${name}"]`).forEach((el) => el.classList.add("bb-focus"));
  }, target);
}

// Which region each narration beat looks at, and anything extra to do first.
const ACTIONS = {
  header: { focus: "header" },
  feed: { focus: "feed" },
  bark: { focus: "feed", pinMalicious: true },
  evidence: { focus: "detection" },
  agent: { focus: "detection", scrollAgent: true },
  clickhouse: { focus: "clickhouse", cycleQueries: true },
  close: { focus: null },
};

(async () => {
  const manifestPath = path.join(__dirname, "audio", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("run `node narrate.js` first: audio/manifest.json is missing");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: CHANNEL });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: VIDEO_DIR, size: { width: WIDTH, height: HEIGHT } },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  // Let the first poll land so the feed is populated before recording beats.
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: SPOTLIGHT_CSS });

  for (const segment of manifest.segments) {
    const action = ACTIONS[segment.action] ?? { focus: null };
    const ms = Math.round(segment.seconds * 1000);
    console.log(`  ${segment.id}  ${segment.action}  ${segment.seconds}s`);

    if (action.pinMalicious) {
      // Pin the known fixture so the evidence panel is deterministic.
      const row = page.locator("tr", { hasText: "expres@" }).first();
      if (await row.count()) {
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await page.waitForTimeout(1200);
      }
    }

    await spotlight(page, action.focus);

    if (action.scrollAgent) {
      await page.waitForTimeout(600);
      await page
        .locator('[data-demo="detection"] .overflow-y-auto')
        .first()
        .evaluate((el) => el.scrollTo({ top: 260, behavior: "smooth" }))
        .catch(() => {});
    }

    if (action.cycleQueries) {
      const buttons = page.locator('[data-demo="clickhouse"] button');
      const count = Math.min(await buttons.count(), 4);
      const slice = Math.max(1200, Math.floor(ms / Math.max(count, 1)));
      for (let i = 0; i < count; i += 1) {
        await buttons.nth(i).click().catch(() => {});
        await page.waitForTimeout(slice);
      }
    } else {
      await page.waitForTimeout(ms);
    }
  }

  await spotlight(page, null);
  await page.waitForTimeout(1200);

  await context.close();
  await browser.close();

  const file = fs.readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
  if (!file) throw new Error("playwright produced no video");
  const final = path.join(VIDEO_DIR, "dashboard.webm");
  fs.renameSync(path.join(VIDEO_DIR, file), final);
  console.log(`\nrecorded ${final}`);
})();
