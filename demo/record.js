// Drive the dashboard and record it, timed to the narration.
//
// Each script segment names a UI region. We spotlight that region (fade the
// rest) for exactly as long as its narration audio runs, so the picture and
// the voice stay in sync without hand-editing a timeline.
//
//   node record.js            records demo/video/dashboard.webm

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const CHANNEL = process.env.BB_BROWSER_CHANNEL || "msedge";
const URL = process.env.BB_URL || "http://localhost:3100";
// The recorder drives a real browser, so only ever point it at the local
// dashboard. Flagged by Semgrep's playwright-goto-injection rule.
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(URL)) {
  throw new Error(`BB_URL must be a local http URL, got ${URL}`);
}
const VIDEO_DIR = path.join(__dirname, "video");
const WIDTH = 1600;
const HEIGHT = 1000;

// Tuned for the light theme: fading to near-white reads as "background",
// and the focused region gets a brand-coloured halo.
const SPOTLIGHT_CSS = `
  [data-demo] { transition: opacity 520ms ease, filter 520ms ease, box-shadow 520ms ease; }
  body.bb-spot [data-demo] { opacity: 0.32; filter: saturate(0.4) blur(0.4px); }
  body.bb-spot [data-demo].bb-focus {
    opacity: 1;
    filter: none;
    box-shadow: 0 0 0 3px rgba(184, 97, 26, 0.55), 0 18px 48px -12px rgba(60, 40, 20, 0.28);
    border-radius: 16px;
  }
  body.bb-spot header[data-demo].bb-focus { box-shadow: none; }
`;

async function spotlight(page, target) {
  // nosemgrep: playwright-evaluate-arg-injection -- arg is a region name from the ACTIONS constant
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

async function scrollDetection(page, section) {
  // Measured with getBoundingClientRect relative to the scroller's current
  // position. An earlier offsetTop version resolved against a different
  // offsetParent and scrolled to the wrong section, which swapped the
  // evidence and agent beats against the narration.
  // nosemgrep: playwright-evaluate-arg-injection -- arg is a section name from the ACTIONS constant
  return page.evaluate((name) => {
      const el = document.querySelector(`[data-demo="detection"] [data-section="${name}"]`);
      const scroller = document.querySelector('[data-demo="detection"] .overflow-y-auto');
      if (!el || !scroller) return "missing";
      const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const top = Math.max(0, scroller.scrollTop + delta - 4);
      scroller.scrollTo({ top, behavior: "smooth" });
      return `${name}->${Math.round(top)}`;
    }, section)
    .catch((err) => `error ${err}`);
}

// Which region each narration beat looks at, and anything to do first.
const ACTIONS = {
  header: { focus: "header" },
  feed: { focus: "feed" },
  bark: { focus: "detection", pinMalicious: true },
  evidence: { focus: "detection", section: "evidence" },
  agent: { focus: "detection", section: "agent" },
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
  });
  const page = await context.newPage();
  // Playwright starts the video when the page is created, but the narration
  // starts at the first beat below. Measure the gap so the mux can trim it.
  const t0 = Date.now();

  // nosemgrep: playwright-goto-injection -- URL is validated as localhost above
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  // Let the first poll land so the feed is populated before the first beat.
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: SPOTLIGHT_CSS });

  const leadInMs = Date.now() - t0;

  let clickhouseRound = 0;
  // Playwright starts the video slightly before newPage() returns, so the
  // lead-in above undercounts. The beats, though, are wall-clock exact, so
  // the mux aligns on the END of the recording instead.
  const beatsStart = Date.now();
  for (const segment of manifest.segments) {
    const action = ACTIONS[segment.action] ?? { focus: null };
    const ms = Math.round(segment.seconds * 1000);
    console.log(`  ${segment.id}  ${segment.action}  ${segment.seconds}s`);
    const started = Date.now();

    if (action.pinMalicious) {
      // Pin the known fixture through the dashboard's deep link, so the
      // evidence panel is deterministic even when live traffic has pushed
      // the fixture out of the 60-row feed (which broke an earlier take).
      await page.evaluate(() => {
        window.location.hash = "pin=expres@4.18.2";
      });
      await page.waitForTimeout(400);
    }

    await spotlight(page, action.focus);

    if (action.section) {
      await page.waitForTimeout(500);
      await scrollDetection(page, action.section);
    }

    if (action.cycleQueries) {
      // Two ClickHouse beats share the preset list: first half, then second.
      const buttons = page.locator('[data-demo="clickhouse"] button');
      const total = await buttons.count();
      const picks = clickhouseRound === 0 ? [0, 1, 2] : [3, 5, 0];
      clickhouseRound += 1;
      const valid = picks.filter((i) => i < total);
      const slice = Math.floor(ms / Math.max(valid.length, 1));
      for (const i of valid) {
        await buttons.nth(i).click().catch(() => {});
        await page.waitForTimeout(slice);
      }
    }

    // Hold until this beat's narration has finished, whatever the actions took.
    const remaining = ms - (Date.now() - started);
    if (remaining > 0) await page.waitForTimeout(remaining);
  }

  await spotlight(page, null);
  await page.waitForTimeout(1500);
  const beatsMs = Date.now() - beatsStart;

  const video = page.video();
  await context.close();
  await browser.close();

  const raw = await video.path();
  const final = path.join(VIDEO_DIR, "dashboard.webm");
  fs.renameSync(raw, final);
  fs.writeFileSync(
    path.join(VIDEO_DIR, "timing.json"),
    JSON.stringify({ leadInMs, beatsMs }, null, 2),
  );
  console.log(`lead-in to trim: ${(leadInMs / 1000).toFixed(2)}s`);
  console.log(`\nrecorded ${final}`);
})();
