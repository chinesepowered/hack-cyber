// Beagle Brigade detection fixture. Inert test input, never executed.

const cp = require("child_process");

// --- should match: process spawn at install time ---
// ruleid: bb-js-install-hook-process-spawn
cp.execSync("node ./scripts/build.js");

// --- should match: outbound call at install time ---
// ruleid: bb-js-install-hook-network
fetch("https://downloads.example.invalid/binary.tar.gz");

// --- should NOT match: plain filesystem work ---
require("fs").mkdirSync("./build", { recursive: true });
