# NQ / ES Replay Backtester

A local, browser-based replay backtester for E-mini S&P 500 (ES) and E-mini
Nasdaq-100 (NQ) futures. Load real historical OHLCV data, scrub/rewind
through it bar by bar, and place manual buy/sell/limit/stop orders (with
optional stop-loss / take-profit) to test how a trading idea would have
performed -- with a live equity curve, trade log, and stats.

Everything runs client-side in your browser; there is no backend server and
no data is sent anywhere.

## Quick start

```bash
python3 -m http.server 8000
# then open http://localhost:8000/web/
```

A few small **synthetic demo** datasets (clearly labeled `[DEMO]`, not real)
are included so you have something to click around immediately. For real
data, see below.

## Getting real ES / NQ data

This app does not fetch data itself -- you populate `data/` with CSV files
first (see [`data/README.md`](data/README.md) for the exact format), then
the app replays them entirely offline. Two ready-made fetch scripts are
included for you to run **on your own machine**:

```bash
pip install -r requirements.txt
python3 scripts/fetch_yahoo.py     # ES=F / NQ=F, daily + limited intraday (Yahoo's own limits)
python3 scripts/fetch_stooq.py     # ES / NQ daily, no extra packages, usually longer history
```

Both scripts write CSV files into `data/` and register them in
`data/manifest.json`; reload the page afterwards and pick the new dataset
from the "Dataset" selector. For serious intraday replay you'll likely want
a paid vendor export (Databento, Firstrate Data, your broker, CME Data
Mine, a TradingView export) -- `data/README.md` explains how to drop that
in too.

> These fetch scripts could not be network-tested from the sandboxed
> environment this project was built in (it only has access to package
> registries, not general internet/Yahoo/stooq). They use each provider's
> standard, well-documented endpoints, but if a provider has changed
> something since, the script will print a clear error -- open an issue /
> adjust the symbol as needed.

## How replay works

- The chart only ever shows bars up to the current **replay position** --
  later bars are hidden, so you can't see the future while deciding a trade.
- **Step forward** one or many bars, or hit **Play** to auto-advance at a
  chosen speed.
- **Rewind** (step back / drag the slider backward / jump to start) is only
  allowed while you're flat with no pending orders -- once you're in a
  trade, time can only move forward, so fills stay honest. Close the
  position first if you want to rewind and try a different entry.
- The slider under the chart scrubs to any bar directly.

## Placing trades

- **Market**: fills at the close of the last revealed bar.
- **Limit / Stop**: stays pending until a later bar's high/low range
  crosses your price; fills at your price (or the bar's open if it gaps
  through it).
- Optional **stop-loss** / **take-profit** (as absolute prices) are checked
  against every subsequent bar's high/low. If both would be hit within the
  same bar, the stop-loss is assumed to trigger first (a standard,
  conservative assumption -- real intra-bar order is unknowable from OHLC
  data alone).
- Buying while short (or selling while long) closes the existing position
  and opens the new side ("reverse"); there's always at most one open
  position at a time.
- Pick contract size (ES/MES or NQ/MNQ) from the dropdown -- same price
  data, different $/point multiplier.

## Project layout

```
web/               static frontend (open web/index.html via a local server)
  index.html
  engine.js        backtest engine: fills, positions, PnL, stats (no DOM)
  app.js           chart + UI wiring
  vendor/          vendored TradingView lightweight-charts (Apache-2.0)
data/
  manifest.json    lists available datasets for the "Dataset" dropdown
  README.md        CSV format + how to add real data
  DEMO_*.csv       synthetic placeholder data
scripts/
  fetch_yahoo.py   real data via yfinance (Yahoo Finance)
  fetch_stooq.py   real daily data via stooq.com
  make_demo_data.py  regenerates the synthetic demo CSVs
```

## Limitations / assumptions worth knowing

- Fills assume no slippage and full liquidity at your price -- fine for
  evaluating an idea's edge, not a substitute for live execution testing.
- No margin calls / buying-power enforcement; equity can go negative if you
  size wildly out of proportion to starting capital, which is intentional
  (this is a strategy-testing tool, not a risk-management simulator).
- Free data sources (Yahoo, stooq) have real limitations: Yahoo's intraday
  history is short (days-to-weeks), and continuous front-month contracts
  have roll adjustments baked in. For rigorous intraday strategy testing,
  use a proper historical-data vendor.
