// Generate the narration with ElevenLabs, one mp3 per segment, and record
// each segment's real duration so the screen recording can be timed to it.
//
// ElevenLabs is not a hackathon sponsor. It is used here only to narrate the
// demo video.
//
//   node narrate.js            generate any missing segments
//   node narrate.js --force    regenerate everything

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const API_KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const OUT_DIR = path.join(__dirname, "audio");
const SCRIPT = JSON.parse(fs.readFileSync(path.join(__dirname, "script.json"), "utf8"));
const VOICE = process.env.ELEVENLABS_VOICE_ID || SCRIPT.voice;
const FORCE = process.argv.includes("--force");

function durationSeconds(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Math.round(parseFloat(out.trim()) * 100) / 100;
}

async function speak(text, outFile) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  fs.writeFileSync(outFile, Buffer.from(await response.arrayBuffer()));
}

(async () => {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY missing from .env");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];
  let total = 0;

  for (const segment of SCRIPT.segments) {
    const file = path.join(OUT_DIR, `${segment.id}.mp3`);
    if (FORCE || !fs.existsSync(file)) {
      process.stdout.write(`  generating ${segment.id} ... `);
      await speak(segment.text, file);
      console.log("ok");
    } else {
      console.log(`  ${segment.id} cached`);
    }
    const seconds = durationSeconds(file);
    total += seconds;
    manifest.push({ ...segment, file: path.relative(__dirname, file), seconds });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ voice: VOICE, model: MODEL, totalSeconds: total, segments: manifest }, null, 2),
  );

  const mins = Math.floor(total / 60);
  console.log(`\ntotal narration: ${mins}m ${Math.round(total % 60)}s across ${manifest.length} segments`);
  if (total < 110 || total > 190) {
    console.log("WARNING: target is 2 to 3 minutes; adjust script.json");
  }
})();
