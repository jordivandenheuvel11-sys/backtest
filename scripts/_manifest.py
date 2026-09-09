"""Shared helper for updating data/manifest.json from the fetch scripts."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
MANIFEST_PATH = os.path.join(DATA_DIR, "manifest.json")


def load():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return {"datasets": []}


def save(manifest):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)


def upsert(manifest, entry):
    manifest["datasets"] = [d for d in manifest["datasets"] if d["id"] != entry["id"]]
    manifest["datasets"].append(entry)
