#!/usr/bin/env python3
"""Generate small, clearly-labeled SYNTHETIC demo datasets.

This data is NOT real market data. It exists only so the replay backtester
has something to show immediately after cloning the repo, before you've run
one of the real data-fetch scripts (see data/README.md). Every dataset this
script writes is prefixed "DEMO_" and flagged "real": false in the manifest,
and the web UI labels it accordingly.

Usage:
    python3 scripts/make_demo_data.py
"""
import csv
import json
import math
import os
import random
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
MANIFEST_PATH = os.path.join(DATA_DIR, "manifest.json")


def gen_daily_bars(start_price, days, seed, drift=0.0002, vol=0.011):
    rng = random.Random(seed)
    bars = []
    price = start_price
    d = datetime(2023, 1, 2, tzinfo=timezone.utc)
    while len(bars) < days:
        if d.weekday() < 5:  # skip weekends (futures still trade Sun evening, but keep demo simple)
            ret = rng.gauss(drift, vol)
            open_ = price
            close = open_ * (1 + ret)
            hi_wick = abs(rng.gauss(0, vol * 0.6))
            lo_wick = abs(rng.gauss(0, vol * 0.6))
            high = max(open_, close) * (1 + hi_wick)
            low = min(open_, close) * (1 - lo_wick)
            vol_ = int(abs(rng.gauss(1_500_000, 400_000)))
            bars.append({
                "time": int(d.replace(hour=21, minute=0).timestamp()),
                "open": round(open_, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(close, 2),
                "volume": vol_,
            })
            price = close
        d += timedelta(days=1)
    return bars


def gen_intraday_bars(start_price, minutes_per_day, days, seed, bar_minutes=5, vol=0.0009):
    rng = random.Random(seed)
    bars = []
    price = start_price
    # Start a few weeks back so it lines up plausibly after the daily series.
    d = datetime(2025, 8, 1, 13, 30, tzinfo=timezone.utc)  # 13:30 UTC ~ 9:30 ET
    for _day in range(days):
        while d.weekday() >= 5:
            d += timedelta(days=1)
        t = d
        bars_today = minutes_per_day // bar_minutes
        for _ in range(bars_today):
            ret = rng.gauss(0, vol)
            open_ = price
            close = open_ * (1 + ret)
            hi_wick = abs(rng.gauss(0, vol * 0.7))
            lo_wick = abs(rng.gauss(0, vol * 0.7))
            high = max(open_, close) * (1 + hi_wick)
            low = min(open_, close) * (1 - lo_wick)
            vol_ = int(abs(rng.gauss(2500, 900)))
            bars.append({
                "time": int(t.timestamp()),
                "open": round(open_, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(close, 2),
                "volume": vol_,
            })
            price = close
            t += timedelta(minutes=bar_minutes)
        d += timedelta(days=1)
    return bars


def write_csv(path, bars):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time", "open", "high", "low", "close", "volume"])
        for b in bars:
            w.writerow([b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"]])


def load_manifest():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return {"datasets": []}


def upsert(manifest, entry):
    manifest["datasets"] = [d for d in manifest["datasets"] if d["id"] != entry["id"]]
    manifest["datasets"].append(entry)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    manifest = load_manifest()

    specs = [
        ("DEMO_ES_1d", "ES", "1d", gen_daily_bars(4780, 480, seed=1), "E-mini S&P 500 (synthetic demo)"),
        ("DEMO_NQ_1d", "NQ", "1d", gen_daily_bars(16800, 480, seed=2), "E-mini Nasdaq-100 (synthetic demo)"),
        ("DEMO_ES_5m", "ES", "5m", gen_intraday_bars(5300, 390, 15, seed=3), "E-mini S&P 500 (synthetic demo)"),
        ("DEMO_NQ_5m", "NQ", "5m", gen_intraday_bars(18600, 390, 15, seed=4), "E-mini Nasdaq-100 (synthetic demo)"),
    ]

    for id_, symbol, timeframe, bars, name in specs:
        filename = f"data/{id_}.csv"
        write_csv(os.path.join(ROOT, filename), bars)
        upsert(manifest, {
            "id": id_,
            "symbol": symbol,
            "timeframe": timeframe,
            "name": name,
            "file": filename,
            "source": "synthetic",
            "real": False,
        })
        print(f"wrote {filename} ({len(bars)} bars)")

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"updated {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
