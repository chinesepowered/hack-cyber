# Detection fixtures

Inert test inputs for the scanner. You cannot build or demo a malware
detector without known-bad inputs, and we will not point a demo at somebody
else's live package and call it malware on stage.

Every fixture here:

- is **never executed**, by the scanner or anything else; it is read as text
- sends to hosts under `.invalid`, a reserved TLD that cannot resolve
  (RFC 6761), so even if something ran it, it would reach nothing
- carries no real payload, no real credentials and no real endpoints
- is **never published** to any registry

They exist so `beagle replay` produces the same result every time, which is
what the demo runs against if the live feed is quiet.

| Fixture | What it models | Expected |
|---|---|---|
| `npm-credential-stealer` | postinstall hook reading env and `.npmrc`, posting them out | malicious |
| `npm-remote-loader` | preinstall hook fetching and evaluating a second stage | malicious |
| `npm-typosquat-expres` | name one edit from `express`, postinstall spawning a shell | malicious |
| `pypi-setup-exfil` | `setup.py` install command class exfiltrating AWS credentials | malicious |
| `npm-benign-native-build` | legitimate native build with a postinstall hook | clean |

The last one is the important one. A scanner that flags every postinstall
hook is useless, because thousands of legitimate packages compile native
addons at install time. It is the negative control.
