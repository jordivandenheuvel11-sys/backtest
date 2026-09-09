# BTC Predictor

A port of [Bitcoin-Price-Prediction/btcpredictor](https://github.com/Bitcoin-Price-Prediction/btcpredictor):
an LSTM-based Bitcoin price prediction dashboard (UC Berkeley Data-X,
2020-2021), covering three model variants (price-only, technical
indicators, and news/tweet sentiment) plus a live dashboard.

**Start with [`SETUP.md`](SETUP.md)** - this project needs a Firebase
project and an IEXCloud API key you create yourself, and one feature
(Twitter-sentiment scraping via `twint`) is very likely non-functional
today regardless of setup. SETUP.md explains exactly what's needed, what
was already fixed to install on a modern Python, and what to expect.

The original project description is preserved as-is in
[`UPSTREAM_README.md`](UPSTREAM_README.md).

---

This repo previously held an ES/NQ futures replay-backtester; that work was
replaced with this project at the repo owner's request and remains in the
git history (`git log`) if needed again.
