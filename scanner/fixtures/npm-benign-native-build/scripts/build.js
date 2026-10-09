// Beagle Brigade negative control. This is what an honest postinstall hook
// looks like: it compiles a native addon and touches nothing else.
//
// A scanner that flags this is useless, because thousands of real packages
// build native code at install time. The gate is not "does it run at install",
// it is "does it run at install AND reach for credentials or remote code".

const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "..", "build");

function build() {
  if (!fs.existsSync(out)) {
    fs.mkdirSync(out, { recursive: true });
  }
  cp.execSync("node-gyp rebuild", { stdio: "inherit" });
  console.log("native addon built in", out);
}

try {
  build();
} catch (err) {
  console.error("native build failed, falling back to prebuilt binary");
  process.exit(0);
}
