#!/usr/bin/env python3
"""Download REAL ES / NQ futures data from Yahoo Finance and register it in
data/manifest.json so the web app picks it up.

Run this on a machine with normal internet access (Yahoo Finance is not
reachable from every sandboxed environment):

    pip install -r requirements.txt
    python3 scripts/fetch_yahoo.py

Yahoo serves the continuous front-month contract under "ES=F" (E-mini S&P
500) and "NQ=F" (E-mini Nasdaq-100). Daily bars go back years; intraday bars
are limited by Yahoo itself (~60 days for 5m/15m, ~7 days for 1m) -- that is
a real-data limitation, not a bug in this script. For a longer intraday
replay history, buy/export data from a vendor (Databento, Firstrate Data,
your broker, TradingView export, CME Data Mine) and drop it in data/ using
the same CSV format -- see data/README.md.
"""
import sys
import time
from datetime import timezone

try:
    import yfinance as yf
except ImportError:
    print("Missing dependency. Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

from _manifest import DATA_DIR, load, save, upsert
import os

SYMBOLS = {
    "ES": {"yahoo": "ES=F", "name": "E-mini S&P 500"},
    "NQ": {"yahoo": "NQ=F", "name": "E-mini Nasdaq-100"},
}

# (timeframe id, yfinance interval, yfinance period)
REQUESTS = [
    ("1d", "1d", "5y"),
    ("15m", "15m", "60d"),
    ("5m", "5m", "60d"),
    ("1m", "1m", "7d"),
]


def fetch_one(yahoo_ticker, interval, period):
    tk = yf.Ticker(yahoo_ticker)
    df = tk.history(period=period, interval=interval, auto_adjust=False)
    if df is None or df.empty:
        return []
    bars = []
    for ts, row in df.iterrows():
        if ts.tzinfo is None:
            ts = ts.tz_localize(timezone.utc)
        bars.append({
            "time": int(ts.tz_convert(timezone.utc).timestamp()),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
        })
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
        for timeframe, interval, period in REQUESTS:
            print(f"Fetching {symbol} ({meta['yahoo']}) {timeframe} [{period} @ {interval}] ...")
            try:
                bars = fetch_one(meta["yahoo"], interval, period)
            except Exception as exc:  # network hiccups, rate limits, schema changes
                print(f"  failed: {exc}")
                continue
            if not bars:
                print("  no data returned (Yahoo may not have this range for this symbol)")
                continue
            ds_id = f"{symbol}_{timeframe}"
            filename = f"data/{ds_id}.csv"
            write_csv(os.path.join(DATA_DIR, "..", filename), bars)
            upsert(manifest, {
                "id": ds_id,
                "symbol": symbol,
                "timeframe": timeframe,
                "name": meta["name"],
                "file": filename,
                "source": "yahoo",
                "real": True,
            })
            print(f"  wrote {filename} ({len(bars)} bars, {bars[0]['time']}..{bars[-1]['time']})")
            any_ok = True
            time.sleep(1)  # be polite to the free endpoint

    save(manifest)
    if any_ok:
        print("\nDone. Reload the web app - the dataset dropdown now includes real data.")
    else:
        print("\nNo data was fetched. Check your internet connection / yfinance version.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
