# Data

The web app reads plain CSV files from this folder, listed in
[`manifest.json`](./manifest.json). Nothing is fetched over the network at
runtime -- you fetch/import data first (as CSV files), then the app replays it.

## CSV format

```
time,open,high,low,close,volume
1704207600,4780.25,4795.5,4772.0,4788.75,1423000
```

- `time`: unix timestamp in **seconds** (preferred), or an ISO-8601 string
  ending in `Z` (e.g. `2024-01-02T21:00:00Z`). Always UTC -- ambiguous local
  timestamps are a common source of subtly-wrong replays, so this app does
  not guess a timezone.
- `open,high,low,close`: numbers.
- `volume`: integer, optional (defaults to 0 if the column is missing).
- Rows must be one bar per row; the app sorts by time and de-duplicates for
  you, so exact ordering in the file doesn't matter.

## Getting REAL data

Pick whichever fits what you need:

1. **`python3 scripts/fetch_yahoo.py`** (needs `pip install -r requirements.txt`)
   Pulls the continuous front-month ES=F / NQ=F contract from Yahoo Finance:
   several years of daily bars, plus intraday (1m/5m/15m) for whatever
   recent window Yahoo still serves (Yahoo itself limits 1-minute data to
   ~7 days and other intraday granularities to ~60 days -- that's a Yahoo
   limitation, not this tool's).

2. **`python3 scripts/fetch_stooq.py`** (no extra packages)
   Pulls daily data from stooq.com, which usually keeps a longer daily
   history than Yahoo. Good for swing-trade-style replay over years.

3. **Bring your own export.** For serious intraday backtesting you'll want a
   real historical-data vendor (e.g. Databento, Firstrate Data, CME Data
   Mine) or your broker's/TradingView's export. Export to CSV, rename the
   columns to match the format above (a spreadsheet's "Save As CSV" plus a
   header rename is usually enough), drop the file in `data/`, and add an
   entry to `manifest.json`:

   ```json
   {
     "id": "ES_1m_databento",
     "symbol": "ES",
     "timeframe": "1m",
     "name": "E-mini S&P 500 (Databento)",
     "file": "data/ES_1m_databento.csv",
     "source": "databento",
     "real": true
   }
   ```

Both fetch scripts are idempotent: re-run them any time to refresh the data,
they overwrite their own files and manifest entries in place.

## Demo data

`scripts/make_demo_data.py` generates small **synthetic** (not real)
datasets, prefixed `DEMO_`, purely so the app has something to display
immediately after cloning the repo. The UI always labels these
`[DEMO - synthetic, not real]`. Delete the `DEMO_*.csv` files and their
manifest entries once you've loaded real data, or just ignore them.

## Contract specs used by the app

| Symbol | Multiplier | Tick  | Tick value |
|--------|-----------:|------:|-----------:|
| ES     | $50/pt     | 0.25  | $12.50     |
| MES    | $5/pt      | 0.25  | $1.25      |
| NQ     | $20/pt     | 0.25  | $5.00      |
| MNQ    | $2/pt      | 0.25  | $0.50      |

MES/MNQ (the "micro" contracts) track the exact same price series as ES/NQ,
just at 1/10th the multiplier -- pick whichever contract size fits your
account in the "Contract" dropdown; you don't need separate data for it.
