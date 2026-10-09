// Mux the recorded screen capture with the narration into a shareable mp4.
//
//   node build-video.js        writes demo/build/beagle-brigade-demo.mp4

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEMO = __dirname;
const AUDIO_DIR = path.join(DEMO, "audio");
const VIDEO = path.join(DEMO, "video", "dashboard.webm");
const TIMING = path.join(DEMO, "video", "timing.json");
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
  const { leadInMs = 0 } = fs.existsSync(TIMING) ? JSON.parse(fs.readFileSync(TIMING, "utf8")) : {};
  fs.mkdirSync(BUILD, { recursive: true });

  // 1. Narration: concatenate the segments in script order.
  const listFile = path.join(BUILD, "audio-list.txt");
  fs.writeFileSync(
    listFile,
    manifest.segments
      .map((s) => `file '${path.join(AUDIO_DIR, path.basename(s.file)).replace(/\\/g, "/")}'`)
      .join("\n"),
  );
  const narration = path.join(BUILD, "narration.m4a");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "192k", narration]);

  // 2. Trim the page-load lead-in off the front of the screen capture so the
  //    first frame lines up with the first word. Align on the end: the beats
  //    are wall-clock exact and the video stops when they do, whereas the
  //    video's start time is not observable from the script.
  const { beatsMs } = fs.existsSync(TIMING) ? JSON.parse(fs.readFileSync(TIMING, "utf8")) : {};
  const rawLen = probe(VIDEO);
  const trimSeconds = beatsMs ? Math.max(0, rawLen - beatsMs / 1000) : leadInMs / 1000;
  console.log(`raw capture ${rawLen.toFixed(2)}s, trimming ${trimSeconds.toFixed(2)}s`);
  const trimmed = path.join(BUILD, "trimmed.mp4");
  ffmpeg([
    "-ss", trimSeconds.toFixed(3),
    "-i", VIDEO,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-an",
    trimmed,
  ]);

  const audioLen = probe(narration);
  const videoLen = probe(trimmed);
  console.log(`narration ${audioLen.toFixed(1)}s | video ${videoLen.toFixed(1)}s`);

  // 3. Mux. If the picture ran short, hold the last frame rather than cut
  //    the voice mid-sentence; add a one-second tail either way.
  const hold = Math.max(0, audioLen - videoLen) + 1.0;
  ffmpeg([
    "-i", trimmed,
    "-i", narration,
    "-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}[v]`,
    "-map", "[v]",
    "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", (audioLen + 1.0).toFixed(2),
    OUT,
  ]);

  const finalLen = probe(OUT);
  const size = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`\n${OUT}`);
  console.log(`${Math.floor(finalLen / 60)}m ${Math.round(finalLen % 60)}s, ${size} MB`);
})();
