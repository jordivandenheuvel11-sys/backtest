# Setup

This is a port of [Bitcoin-Price-Prediction/btcpredictor](https://github.com/Bitcoin-Price-Prediction/btcpredictor)
(UC Berkeley Data-X, 2020-2021) into this repo, replacing the earlier ES/NQ
replay-backtester that used to live here (still recoverable via `git log` /
`git revert` if you ever want it back).

**Read this before you start** - unlike a typical "clone and run" app, this
project needs several external accounts, and one of its features is very
likely broken today through no fault of this port. None of the services
below (Bitstamp, Firebase, IEXCloud, Heroku) were reachable from the
sandboxed environment this port was assembled in, so nothing past static
code inspection could be tested live here - you'll be the first to actually
run it end-to-end.

## What you need to create yourself

| Service | Used for | Required? |
|---|---|---|
| [Firebase](https://firebase.google.com/) project (free Spark tier is enough) | Realtime + archive database for cached prices/tweets/news, used by the dashboard and `datastore/datastore.py` | Only for the live dashboard / 24/7 collector. The historical notebooks (below) can run without it. |
| [IEXCloud](https://iexcloud.io/) API key | News headlines for the oracle model's sentiment feature | Only if you want news-based sentiment |
| [Heroku](https://www.heroku.com/) account | Hosting `heroku-script/` as an always-on worker (`Procfile` is already set up for it) | Optional - `heroku-script/script.py` is just a Python process, you can run it anywhere (a VM, your own machine, etc.) |
| Bitstamp | Free, keyless public API for BTC OHLCV data (`predictor/datastore/btcstock.py`) | Needed by every model, no signup required |

Once you have a Firebase project, set these environment variables (matching
`heroku-script/util/database.py`):

```
FB_apiKey=...
FB_authDomain=...
FB_databaseURL=...
FB_projectId=...
FB_storageBucket=...
FB_messagingSenderId=...
FB_appId=...
FB_measurementId=...
```

For IEXCloud (`heroku-script/util/news_logger.py`):

```
IEXCLOUD_PK=...   # publishable key
IEXCLOUD_SK=...   # secret key
```

Optional error-alert emails (`heroku-script/util/reporter.py`):

```
BOT_EMAIL=...
BOT_PASSW=...
```

## Installing

The upstream project pinned `python-3.7.9` (see `heroku-script/runtime.txt`)
and depends on two now-abandoned packages that will not install on a modern
Python:

- **`fbprophet`** - fails to build on current Python (its `pystan`
  dependency doesn't compile). This port already swaps
  `predictor/sti/sti.py` over to **`prophet`**, the actively maintained
  successor with the same `Prophet()` API - no other code changes needed.
- **`pyrebase`** - unmaintained, also has install issues on modern Python.
  `predictor/requirements.txt` installs **`pyrebase4`** instead, a
  maintained drop-in fork (still `import pyrebase` in code).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r predictor/requirements.txt
pip install -r heroku-script/requirements.txt
```

Use Python 3.10 or 3.11, not 3.7 (EOL) - everything here was updated to
current package versions, not pinned to the 2020-era originals.

`predictor/Dashboard.ipynb` imports `dash_core_components` and
`dash_html_components` as separate packages; modern Dash (2.x, what
`requirements.txt` installs) merged those into `dash` itself. If that
notebook errors on those imports, replace them with:

```python
from dash import dcc, html
```

## The Twitter/sentiment feature is likely non-functional

`predictor/datastore/tweety.py` (used by `models/oracle.py` and
`OracleDemo.ipynb`) scrapes Twitter search via **`twint`**. `twint` has not
meaningfully worked since Twitter locked down its unauthenticated search
endpoints years ago (it's had no real fixes since ~2021); expect it to
return nothing or throw, not produce tweets. There is no drop-in
replacement to swap in the way `prophet`/`pyrebase4` were - a working
substitute would mean using the paid Twitter/X API or a different
provider, which is a real design decision, not a dependency bump, so it
hasn't been made for you here.

**Practical recommendation:** start with `predictor/BaselineDemo.ipynb`
(price-only LSTM) and `predictor/IndicatorDemo.ipynb` (adds technical
indicators) - both only need Bitstamp's free OHLCV data, no Firebase or
Twitter required. Treat `OracleDemo.ipynb` and the sentiment feature as
needing further work before it does anything useful.

## Layout

```
predictor/           models, datastore, technical-indicator wrapper, notebooks
  models/             baseline.py, indicator.py, oracle.py - the 3 LSTM variants
  datastore/           btcstock.py (Bitstamp OHLCV), tweety.py (twint), realtime.py / archives.py (Firebase)
  sti/                 stock technical indicators wrapper (now uses `prophet`)
  *.ipynb              walkthroughs for each model + the dashboard
heroku-script/        24/7 background data collector (price/tweet/news logging to Firebase)
readme_files/         images referenced by UPSTREAM_README.md
UPSTREAM_README.md    the original project's README, unmodified
```
