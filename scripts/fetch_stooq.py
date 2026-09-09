#!/usr/bin/env python3
"""Download REAL daily ES / NQ futures data from stooq.com (free, no API key,
no extra Python packages needed) and register it in data/manifest.json.

Stooq typically keeps a much longer daily history than Yahoo's intraday
endpoints, which is useful if you want to replay/backtest over years rather
than weeks. Run this on a machine with normal internet access:

    python3 scripts/fetch_stooq.py

If stooq has changed its symbol naming since this script was written, this
will print stooq's raw response so you can adjust SYMBOLS below -- this
script could not be network-tested from within the sandboxed session that
generated it.
"""
import csv
import io
import os
import sys
import urllib.request

from _manifest import DATA_DIR, load, save, upsert

# Continuous (front-month, back-adjusted) futures symbols on stooq.
SYMBOLS = {
    "ES": {"stooq": "es.f", "name": "E-mini S&P 500"},
    "NQ": {"stooq": "nq.f", "name": "E-mini Nasdaq-100"},
}

URL = "https://stooq.com/q/d/l/?s={symbol}&i=d"


def fetch_csv(symbol):
    req = urllib.request.Request(
        URL.format(symbol=symbol),
        headers={"User-Agent": "Mozilla/5.0 (compatible; backtest-data-fetch/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_stooq_csv(text):
    reader = csv.DictReader(io.StringIO(text))
    bars = []
    for row in reader:
        try:
            # stooq daily format: Date,Open,High,Low,Close,Volume
            from datetime import datetime, timezone
            d = datetime.strptime(row["Date"], "%Y-%m-%d").replace(
                hour=21, minute=0, tzinfo=timezone.utc
            )
            bars.append({
                "time": int(d.timestamp()),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(float(row["Volume"])) if row.get("Volume") else 0,
            })
        except (KeyError, ValueError):
            continue
    bars.sort(key=lambda b: b["time"])
    return bars


def write_csv(path, bars):
    with open(path, "w") as f:
        f.write("time,open,high,low,close,volume\n")
        for b in bars:
            f.write(f"{b['time']},{b['open']},{b['high']},{b['low']},{b['close']},{b['volume']}\n")


def main():
    manifest = load()
    any_ok = False
    for symbol, meta in SYMBOLS.items():
        print(f"Fetching {symbol} ({meta['stooq']}) daily from stooq ...")
        try:
            text = fetch_csv(meta["stooq"])
        except Exception as exc:
            print(f"  request failed: {exc}")
            continue
        if not text.strip() or text.lstrip().startswith("<"):
            print("  unexpected response (not CSV) - first 200 chars:")
            print("  " + text[:200].replace("\n", " "))
            continue
        bars = parse_stooq_csv(text)
        if not bars:
            print("  no rows parsed - stooq's format or symbol may have changed")
            continue
        ds_id = f"{symbol}_1d_stooq"
        filename = f"data/{ds_id}.csv"
        write_csv(os.path.join(DATA_DIR, "..", filename), bars)
        upsert(manifest, {
            "id": ds_id,
            "symbol": symbol,
            "timeframe": "1d",
            "name": meta["name"] + " (stooq)",
            "file": filename,
            "source": "stooq",
            "real": True,
        })
        print(f"  wrote {filename} ({len(bars)} bars, {bars[0]['time']}..{bars[-1]['time']})")
        any_ok = True

    save(manifest)
    if not any_ok:
        print("\nNo data was fetched from stooq.", file=sys.stderr)
        sys.exit(1)
    print("\nDone. Reload the web app - the dataset dropdown now includes real data.")


if __name__ == "__main__":
    main()
