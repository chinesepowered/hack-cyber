// Mux the recorded screen capture with the narration into a shareable mp4.
//
//   node build-video.js        writes demo/build/beagle-brigade-demo.mp4

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEMO = __dirname;
const AUDIO_DIR = path.join(DEMO, "audio");
const VIDEO = path.join(DEMO, "video", "dashboard.webm");
const BUILD = path.join(DEMO, "build");
const OUT = path.join(BUILD, "beagle-brigade-demo.mp4");

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function probe(file) {
  return parseFloat(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    ).trim(),
  );
}

(async () => {
  if (!fs.existsSync(VIDEO)) throw new Error("run `node record.js` first");
  const manifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, "manifest.json"), "utf8"));
  fs.mkdirSync(BUILD, { recursive: true });

  // Concatenate the narration segments in script order.
  const listFile = path.join(BUILD, "audio-list.txt");
  fs.writeFileSync(
    listFile,
    manifest.segments
      .map((s) => `file '${path.join(AUDIO_DIR, path.basename(s.file)).replace(/\\/g, "/")}'`)
      .join("\n"),
  );
  const narration = path.join(BUILD, "narration.m4a");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "192k", narration]);

  const audioLen = probe(narration);
  const videoLen = probe(VIDEO);
  console.log(`narration ${audioLen.toFixed(1)}s | video ${videoLen.toFixed(1)}s`);

  // The recording is driven by the same timings, so these should be close.
  // Hold the last frame if the video came up short rather than cutting the
  // voice off mid-sentence.
  const pad = audioLen > videoLen ? ["-tpad", `stop_mode=clone:stop_duration=${(audioLen - videoLen + 0.5).toFixed(2)}`] : [];

  ffmpeg([
    "-i", VIDEO,
    "-i", narration,
    ...(pad.length ? ["-vf", pad[1]] : []),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    OUT,
  ]);

  const finalLen = probe(OUT);
  const size = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`\n${OUT}`);
  console.log(`${Math.floor(finalLen / 60)}m ${Math.round(finalLen % 60)}s, ${size} MB`);
})();
