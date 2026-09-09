"use strict";

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }

function fmtMoney(v) {
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-$" : "$") + s;
}

function fmtPrice(v) {
  return v === null || v === undefined || Number.isNaN(v) ? "-" : v.toFixed(2);
}

function fmtTime(unixSeconds) {
  if (unixSeconds === null || unixSeconds === undefined) return "-";
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function pnlClass(v) {
  return v > 0 ? "pnl-pos" : v < 0 ? "pnl-neg" : "";
}

function setStatus(msg, isError) {
  const el = $("statusMsg");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--text-dim)";
}

function fatal(msg) {
  const el = $("fatalBanner");
  el.textContent = msg;
  el.hidden = false;
  setStatus(msg, true);
}

// Parses the CSV formats produced by scripts/fetch_yahoo.py, scripts/fetch_stooq.py
// and scripts/make_demo_data.py: header "time,open,high,low,close,volume".
// `time` may be unix seconds/milliseconds, or an ISO-8601 string ending in Z.
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = {
    time: header.indexOf("time"),
    open: header.indexOf("open"),
    high: header.indexOf("high"),
    low: header.indexOf("low"),
    close: header.indexOf("close"),
    volume: header.indexOf("volume"),
  };
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(",");
    const rawTime = cols[col.time].trim();
    let t;
    if (/^\d+$/.test(rawTime)) {
      t = parseInt(rawTime, 10);
      if (rawTime.length > 10) t = Math.floor(t / 1000);
    } else {
      t = Math.floor(Date.parse(rawTime) / 1000);
    }
    if (!Number.isFinite(t)) continue;
    bars.push({
      time: t,
      open: parseFloat(cols[col.open]),
      high: parseFloat(cols[col.high]),
      low: parseFloat(cols[col.low]),
      close: parseFloat(cols[col.close]),
      volume: col.volume >= 0 ? parseFloat(cols[col.volume] || "0") : 0,
    });
  }
  bars.sort((a, b) => a.time - b.time);
  const out = [];
  for (const b of bars) {
    if (out.length && out[out.length - 1].time === b.time) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chart setup
// ---------------------------------------------------------------------------

const LWC = window.LightweightCharts;

function makeChart(container, extraOptions) {
  return LWC.createChart(container, Object.assign({
    layout: { background: { color: "transparent" }, textColor: "#8792a2", attributionLogo: false },
    grid: {
      vertLines: { color: "#1c222e" },
      horzLines: { color: "#1c222e" },
    },
    rightPriceScale: { borderColor: "#2a3140" },
    timeScale: { borderColor: "#2a3140", timeVisible: true, secondsVisible: false },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    autoSize: true,
  }, extraOptions || {}));
}

function addSeriesCompat(chart, kind, options) {
  // Lightweight Charts v5 uses chart.addSeries(SeriesType, options);
  // older builds exposed chart.addCandlestickSeries()/addHistogramSeries()/addAreaSeries().
  if (typeof chart.addSeries === "function" && LWC[kind]) {
    return chart.addSeries(LWC[kind], options);
  }
  const legacyName = "add" + kind.replace("Series", "") + "Series";
  return chart[legacyName](options);
}

function attachMarkers(series) {
  if (typeof LWC.createSeriesMarkers === "function") {
    const primitive = LWC.createSeriesMarkers(series, []);
    return primitive;
  }
  return { setMarkers: (m) => series.setMarkers(m) };
}

let priceChart, candleSeries, volumeSeries, markers, equityChart, equitySeries;

if (!LWC) {
  fatal(
    "Chart library failed to load (vendor/lightweight-charts.standalone.production.js).\n" +
    "This almost always means the page was opened directly as a file:// URL instead of through a local " +
    "server, or the server isn't serving the repo root. Run `python3 -m http.server 8000` from the repo " +
    "root and open http://localhost:8000/web/ - see README.md."
  );
} else {
  try {
    priceChart = makeChart($("priceChart"));
    candleSeries = addSeriesCompat(priceChart, "CandlestickSeries", {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    volumeSeries = addSeriesCompat(priceChart, "HistogramSeries", {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    markers = attachMarkers(candleSeries);

    equityChart = makeChart($("equityChart"));
    equitySeries = addSeriesCompat(equityChart, "AreaSeries", {
      lineColor: "#4f8ef7",
      topColor: "rgba(79,142,247,0.35)",
      bottomColor: "rgba(79,142,247,0.02)",
      lineWidth: 2,
    });

    // Keep the two time axes lined up.
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) equityChart.timeScale().setVisibleLogicalRange(range);
    });
  } catch (err) {
    fatal("Failed to initialize the chart: " + (err.message || err));
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const engine = new BacktestEngine();
let manifest = { datasets: [] };
let currentDatasetMeta = null;
let priceLines = [];
let playTimer = null;

const STORAGE_KEY = "nqes-backtester-session-v1";

function saveSession() {
  if (!currentDatasetMeta) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ datasetId: currentDatasetMeta.id, engine: engine.serialize() })
    );
  } catch (e) {
    /* localStorage may be unavailable (private mode, quota) - non-fatal */
  }
}

function loadSavedSession(datasetId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.datasetId !== datasetId) return null;
    return parsed.engine;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dataset / contract selectors
// ---------------------------------------------------------------------------

function populateContractSelect() {
  const sel = $("contractSelect");
  sel.innerHTML = "";
  for (const [key, spec] of Object.entries(CONTRACTS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = spec.label;
    sel.appendChild(opt);
  }
}

async function loadManifest() {
  const res = await fetch("../data/manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  manifest = await res.json();
}

function populateDatasetSelect() {
  const sel = $("datasetSelect");
  sel.innerHTML = "";
  if (!manifest.datasets || manifest.datasets.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No data found - see data/README.md";
    sel.appendChild(opt);
    showEmptyState();
    return;
  }
  for (const ds of manifest.datasets) {
    const opt = document.createElement("option");
    opt.value = ds.id;
    const tag = ds.real ? "" : "  [DEMO - synthetic, not real]";
    opt.textContent = `${ds.symbol} ${ds.timeframe} - ${ds.name || ds.symbol}${tag}`;
    sel.appendChild(opt);
  }
}

function showEmptyState() {
  $("priceChart").innerHTML =
    '<div class="empty-state">No datasets found.\n\nRun a data-fetch script (see data/README.md) to download real\nES / NQ futures data, then reload this page.</div>';
}

async function selectDataset(datasetId) {
  const ds = manifest.datasets.find((d) => d.id === datasetId);
  if (!ds) return;
  currentDatasetMeta = ds;
  setStatus("Loading " + ds.file + " ...");
  const res = await fetch("../" + ds.file, { cache: "no-store" });
  if (!res.ok) {
    setStatus("Failed to load " + ds.file + " (HTTP " + res.status + ")", true);
    return;
  }
  const text = await res.text();
  const bars = parseCSV(text);
  if (bars.length === 0) {
    setStatus("Dataset " + ds.file + " has no valid rows.", true);
    return;
  }
  engine.loadBars(bars);
  engine.contractKey = /^NQ/.test(ds.symbol) ? "NQ" : "ES";
  $("contractSelect").value = engine.contractKey;
  engine.startingCapital = parseFloat($("capitalInput").value) || 50000;
  engine.commissionPerSide = parseFloat($("commissionInput").value) || 0;

  const saved = loadSavedSession(ds.id);
  if (saved) {
    engine.restore(saved);
    $("contractSelect").value = engine.contractKey;
    $("capitalInput").value = engine.startingCapital;
    $("commissionInput").value = engine.commissionPerSide;
    setStatus("Restored previous session for " + ds.symbol + " " + ds.timeframe + ".");
  } else {
    setStatus(
      `Loaded ${bars.length} bars for ${ds.symbol} ${ds.timeframe} ` +
        `(${fmtTime(bars[0].time)} to ${fmtTime(bars[bars.length - 1].time)}).`
    );
  }

  $("datasetInfo").textContent = `${bars.length} bars | ${fmtTime(bars[0].time)} -> ${fmtTime(bars[bars.length - 1].time)}`;
  $("seekSlider").min = 0;
  $("seekSlider").max = bars.length - 1;
  $("seekSlider").value = Math.max(0, engine.idx);

  render();
  priceChart.timeScale().fitContent();
  equityChart.timeScale().fitContent();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const bars = engine.bars;
  const revealed = engine.idx >= 0 ? bars.slice(0, engine.idx + 1) : [];

  candleSeries.setData(revealed);
  volumeSeries.setData(
    revealed.map((b) => ({
      time: b.time,
      value: b.volume || 0,
      color: b.close >= b.open ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)",
    }))
  );
  equitySeries.setData(engine.equityCurve.map((e) => ({ time: e.time, value: e.equity })));

  renderPriceLines();
  renderMarkers(revealed);
  renderPositionBox();
  renderPendingOrders();
  renderAccountBox();
  renderStatsBox();
  renderTradeTable();
  renderSeekControls();
  saveSession();
}

function renderPriceLines() {
  for (const line of priceLines) {
    try { candleSeries.removePriceLine(line); } catch (e) { /* already gone */ }
  }
  priceLines = [];
  const p = engine.position;
  if (p) {
    priceLines.push(candleSeries.createPriceLine({
      price: p.entryPrice, color: "#e2a03f", lineWidth: 1, lineStyle: LWC.LineStyle.Dashed,
      axisLabelVisible: true, title: "entry",
    }));
    if (p.sl != null) {
      priceLines.push(candleSeries.createPriceLine({
        price: p.sl, color: "#ef5350", lineWidth: 1, lineStyle: LWC.LineStyle.Dotted,
        axisLabelVisible: true, title: "SL",
      }));
    }
    if (p.tp != null) {
      priceLines.push(candleSeries.createPriceLine({
        price: p.tp, color: "#26a69a", lineWidth: 1, lineStyle: LWC.LineStyle.Dotted,
        axisLabelVisible: true, title: "TP",
      }));
    }
  }
  for (const o of engine.pendingOrders) {
    priceLines.push(candleSeries.createPriceLine({
      price: o.price, color: "#4f8ef7", lineWidth: 1, lineStyle: LWC.LineStyle.Dashed,
      axisLabelVisible: true, title: `${o.kind} ${o.side}`,
    }));
  }
}

function renderMarkers(revealed) {
  if (!revealed.length) { markers.setMarkers([]); return; }
  const minTime = revealed[0].time;
  const list = [];
  for (const t of engine.trades) {
    if (t.entryTime >= minTime) {
      list.push({
        time: t.entryTime,
        position: t.side === "long" ? "belowBar" : "aboveBar",
        color: t.side === "long" ? "#26a69a" : "#ef5350",
        shape: t.side === "long" ? "arrowUp" : "arrowDown",
        text: `${t.side === "long" ? "B" : "S"} ${t.qty}`,
      });
    }
    if (t.exitTime >= minTime) {
      list.push({
        time: t.exitTime,
        position: t.side === "long" ? "aboveBar" : "belowBar",
        color: "#e2a03f",
        shape: "circle",
        text: `x ${fmtMoney(t.pnlUSD)}`,
      });
    }
  }
  if (engine.position && engine.position.entryTime >= minTime) {
    const p = engine.position;
    list.push({
      time: p.entryTime,
      position: p.side === "long" ? "belowBar" : "aboveBar",
      color: p.side === "long" ? "#26a69a" : "#ef5350",
      shape: p.side === "long" ? "arrowUp" : "arrowDown",
      text: `${p.side === "long" ? "B" : "S"} ${p.qty} (open)`,
    });
  }
  list.sort((a, b) => a.time - b.time);
  markers.setMarkers(list);
}

function renderPositionBox() {
  const box = $("positionBox");
  const p = engine.position;
  if (!p) {
    box.innerHTML = "Flat - no open position";
    $("closePosBtn").disabled = true;
    return;
  }
  const bar = engine.currentBar;
  const unreal = bar ? engine.unrealizedPnL(bar.close) : 0;
  const cls = p.side === "long" ? "pos-long" : "pos-short";
  box.innerHTML =
    `<span class="${cls}">${p.side.toUpperCase()} ${p.qty}</span> @ ${fmtPrice(p.entryPrice)}  (${fmtTime(p.entryTime)})\n` +
    `Mark: ${fmtPrice(bar ? bar.close : null)}   Unrealized: <span class="${pnlClass(unreal)}">${fmtMoney(unreal)}</span>\n` +
    `SL: ${p.sl != null ? fmtPrice(p.sl) : "-"}   TP: ${p.tp != null ? fmtPrice(p.tp) : "-"}`;
  $("closePosBtn").disabled = false;
}

function renderPendingOrders() {
  const box = $("pendingOrdersBox");
  if (!engine.pendingOrders.length) { box.innerHTML = ""; return; }
  box.innerHTML = "Pending orders:\n" + engine.pendingOrders
    .map((o) => `#${o.id} ${o.kind} ${o.side} ${o.qty} @ ${fmtPrice(o.price)} <a href="#" data-cancel="${o.id}" style="color:var(--blue)">cancel</a>`)
    .join("\n");
  box.querySelectorAll("[data-cancel]").forEach((a) => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      engine.cancelOrder(parseInt(a.dataset.cancel, 10));
      render();
    });
  });
}

function renderAccountBox() {
  const s = engine.stats();
  const box = $("accountBox");
  const bar = engine.currentBar;
  const unreal = bar ? engine.unrealizedPnL(bar.close) : 0;
  box.innerHTML =
    `Starting capital: ${fmtMoney(engine.startingCapital)}\n` +
    `Balance (realized): <span class="${pnlClass(s.balance - engine.startingCapital)}">${fmtMoney(s.balance)}</span>\n` +
    `Open P&amp;L: <span class="${pnlClass(unreal)}">${fmtMoney(unreal)}</span>\n` +
    `Equity: <span class="${pnlClass(s.equity - engine.startingCapital)}">${fmtMoney(s.equity)}</span>`;
}

function renderStatsBox() {
  const s = engine.stats();
  const box = $("statsBox");
  box.innerHTML =
    `Trades: ${s.trades}  (W ${s.wins} / L ${s.losses})\n` +
    `Win rate: ${s.winRate.toFixed(1)}%\n` +
    `Avg win: ${fmtMoney(s.avgWin)}   Avg loss: ${fmtMoney(s.avgLoss)}\n` +
    `Profit factor: ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "inf"}\n` +
    `Net P&amp;L: <span class="${pnlClass(s.netPnL)}">${fmtMoney(s.netPnL)}</span>\n` +
    `Max drawdown: ${fmtMoney(s.maxDrawdown)}`;
}

function renderTradeTable() {
  const tbody = $("tradeTable").querySelector("tbody");
  tbody.innerHTML = "";
  for (const t of engine.trades) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="${t.side === "long" ? "pos-long" : "pos-short"}">${t.side}</td>` +
      `<td>${t.qty}</td>` +
      `<td>${fmtPrice(t.entryPrice)}</td>` +
      `<td>${fmtPrice(t.exitPrice)}</td>` +
      `<td>${t.pnlPoints.toFixed(2)}</td>` +
      `<td class="${pnlClass(t.pnlUSD)}">${fmtMoney(t.pnlUSD)}</td>` +
      `<td>${t.reason}</td>`;
    tbody.appendChild(tr);
  }
  tbody.parentElement.parentElement.scrollTop = tbody.parentElement.parentElement.scrollHeight;
}

function renderSeekControls() {
  const slider = $("seekSlider");
  slider.value = Math.max(0, engine.idx);
  const bar = engine.currentBar;
  const label = engine.idx < 0
    ? `no bars revealed / ${engine.bars.length}`
    : `bar ${engine.idx + 1} / ${engine.bars.length} - ${fmtTime(bar.time)}`;
  $("seekLabel").textContent = label;
  const locked = !!(engine.position || engine.pendingOrders.length);
  $("stepBackBtn").disabled = locked || engine.idx <= -1;
  $("toStartBtn").disabled = locked || engine.idx <= -1;
  $("stepFwdBtn").disabled = engine.atEnd;
  $("stepFwd10Btn").disabled = engine.atEnd;
  $("buyBtn").disabled = engine.idx < 0;
  $("sellBtn").disabled = engine.idx < 0;
}

// ---------------------------------------------------------------------------
// Playback controls
// ---------------------------------------------------------------------------

function stopPlayback() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  $("playBtn").disabled = false;
  $("pauseBtn").disabled = true;
}

function startPlayback() {
  if (playTimer || engine.bars.length === 0) return;
  $("playBtn").disabled = true;
  $("pauseBtn").disabled = false;
  const tick = () => {
    if (!engine.advanceOneBar()) { stopPlayback(); render(); return; }
    render();
  };
  playTimer = setInterval(tick, parseInt($("speedSelect").value, 10));
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

$("datasetSelect").addEventListener("change", (e) => {
  stopPlayback();
  selectDataset(e.target.value).catch((err) => setStatus(String(err.message || err), true));
});

$("contractSelect").addEventListener("change", (e) => {
  engine.contractKey = e.target.value;
  render();
});

$("capitalInput").addEventListener("change", (e) => {
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v) && v > 0) engine.startingCapital = v;
  render();
});

$("commissionInput").addEventListener("change", (e) => {
  const v = parseFloat(e.target.value);
  engine.commissionPerSide = Number.isFinite(v) ? v : 0;
  render();
});

$("resetBtn").addEventListener("click", () => {
  if (!confirm("Reset the session? All trades and progress for this dataset will be cleared.")) return;
  stopPlayback();
  engine.reset();
  localStorage.removeItem(STORAGE_KEY);
  render();
  setStatus("Session reset.");
});

$("toStartBtn").addEventListener("click", () => {
  if (!engine.seek(-1)) setStatus("Close the open position before rewinding.", true);
  render();
});
$("stepBackBtn").addEventListener("click", () => {
  if (!engine.seek(engine.idx - 1)) setStatus("Close the open position before rewinding.", true);
  render();
});
$("stepFwdBtn").addEventListener("click", () => { engine.stepForward(1); render(); });
$("stepFwd10Btn").addEventListener("click", () => { engine.stepForward(10); render(); });

$("playBtn").addEventListener("click", startPlayback);
$("pauseBtn").addEventListener("click", stopPlayback);
$("speedSelect").addEventListener("change", () => { if (playTimer) { stopPlayback(); startPlayback(); } });

$("seekSlider").addEventListener("input", (e) => {
  const target = parseInt(e.target.value, 10);
  if (!engine.seek(target)) {
    setStatus("Close the open position before rewinding.", true);
    e.target.value = engine.idx;
  }
  render();
});

$("orderTypeSelect").addEventListener("change", (e) => {
  $("priceRow").style.display = e.target.value === "market" ? "none" : "flex";
});

function readOrderInputs() {
  const qty = Math.max(1, parseInt($("qtyInput").value, 10) || 1);
  const type = $("orderTypeSelect").value;
  const price = parseFloat($("orderPriceInput").value);
  const sl = $("slInput").value ? parseFloat($("slInput").value) : null;
  const tp = $("tpInput").value ? parseFloat($("tpInput").value) : null;
  return { qty, type, price, sl, tp };
}

function placeOrder(side) {
  const { qty, type, price, sl, tp } = readOrderInputs();
  try {
    if (type === "market") {
      engine.marketOrder(side, qty, { sl, tp });
    } else if (type === "limit") {
      if (!Number.isFinite(price)) throw new Error("Enter a limit price.");
      engine.limitOrder(side, qty, price, { sl, tp });
    } else {
      if (!Number.isFinite(price)) throw new Error("Enter a stop price.");
      engine.stopOrder(side, qty, price, { sl, tp });
    }
    setStatus(engine.log[engine.log.length - 1].msg);
  } catch (err) {
    setStatus(String(err.message || err), true);
  }
  render();
}

$("buyBtn").addEventListener("click", () => placeOrder("long"));
$("sellBtn").addEventListener("click", () => placeOrder("short"));
$("closePosBtn").addEventListener("click", () => { engine.closePosition(); render(); });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  if (!priceChart) return; // fatal() already explained why - see the banner at the top of the page.
  populateContractSelect();
  $("contractSelect").value = "ES";
  try {
    await loadManifest();
  } catch (err) {
    fatal(
      "Could not load data/manifest.json (" + (err.message || err) + ").\n" +
      "Make sure you started the server from the repo ROOT (not the web/ folder) - run " +
      "`python3 -m http.server 8000` in the repo root and open http://localhost:8000/web/. " +
      "Opening index.html directly (a file:// URL) will not work: browsers block fetch() for local files."
    );
    showEmptyState();
    return;
  }
  populateDatasetSelect();
  if (manifest.datasets && manifest.datasets.length) {
    await selectDataset(manifest.datasets[0].id).catch((err) => setStatus(String(err.message || err), true));
  }
}

boot();
