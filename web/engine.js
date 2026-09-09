// Backtest engine: pure state/logic, no DOM access. Used by app.js.
"use strict";

const CONTRACTS = {
  ES:  { label: "ES  — E-mini S&P 500",    root: "ES", multiplier: 50, tick: 0.25, tickValue: 12.5 },
  MES: { label: "MES — Micro E-mini S&P 500", root: "ES", multiplier: 5,  tick: 0.25, tickValue: 1.25 },
  NQ:  { label: "NQ  — E-mini Nasdaq-100", root: "NQ", multiplier: 20, tick: 0.25, tickValue: 5 },
  MNQ: { label: "MNQ — Micro E-mini Nasdaq-100", root: "NQ", multiplier: 2,  tick: 0.25, tickValue: 0.5 },
};

function roundTick(price, tick) {
  return Math.round(price / tick) * tick;
}

class BacktestEngine {
  constructor() {
    this.bars = [];
    this.idx = -1; // index of last revealed bar, -1 = nothing revealed yet
    this.contractKey = "ES";
    this.startingCapital = 50000;
    this.commissionPerSide = 0; // $ per contract per side (entry or exit)
    this.realizedPnL = 0;
    this.position = null; // {side:'long'|'short', qty, entryPrice, entryTime, entryIdx, sl, tp}
    this.pendingOrders = []; // {id, kind:'limit'|'stop', side, qty, price, sl, tp, createdIdx}
    this.trades = []; // closed trades
    this.equityCurve = []; // {time, equity}
    this._orderSeq = 1;
    this.log = []; // human-readable event log, most recent last
  }

  get contract() {
    return CONTRACTS[this.contractKey];
  }

  loadBars(bars) {
    this.bars = bars;
    this.idx = -1;
    this.position = null;
    this.pendingOrders = [];
    this.trades = [];
    this.equityCurve = [];
    this.realizedPnL = 0;
    this.log = [];
  }

  reset() {
    const bars = this.bars;
    this.loadBars(bars);
  }

  get currentBar() {
    return this.idx >= 0 ? this.bars[this.idx] : null;
  }

  get atEnd() {
    return this.idx >= this.bars.length - 1;
  }

  _pushLog(msg) {
    const bar = this.currentBar;
    this.log.push({ time: bar ? bar.time : null, msg });
    if (this.log.length > 500) this.log.shift();
  }

  // ---- Order fill helpers -------------------------------------------------

  _fillPendingOrders(bar) {
    const remaining = [];
    for (const o of this.pendingOrders) {
      let fillPrice = null;
      if (o.kind === "limit") {
        if (o.side === "long" && bar.low <= o.price) {
          fillPrice = Math.min(o.price, bar.open);
        } else if (o.side === "short" && bar.high >= o.price) {
          fillPrice = Math.max(o.price, bar.open);
        }
      } else if (o.kind === "stop") {
        if (o.side === "long" && bar.high >= o.price) {
          fillPrice = Math.max(o.price, bar.open);
        } else if (o.side === "short" && bar.low <= o.price) {
          fillPrice = Math.min(o.price, bar.open);
        }
      }
      if (fillPrice !== null) {
        this._openOrFlip(o.side, o.qty, fillPrice, bar.time, { sl: o.sl, tp: o.tp });
        this._pushLog(`Pending ${o.kind} ${o.side} x${o.qty} filled @ ${fillPrice.toFixed(2)}`);
      } else {
        remaining.push(o);
      }
    }
    this.pendingOrders = remaining;
  }

  _checkStopsAndTargets(bar) {
    if (!this.position) return;
    const p = this.position;
    let slHit = p.sl != null && (p.side === "long" ? bar.low <= p.sl : bar.high >= p.sl);
    let tpHit = p.tp != null && (p.side === "long" ? bar.high >= p.tp : bar.low <= p.tp);
    // Conservative assumption when both could occur in the same bar: SL first.
    if (slHit) {
      this._closePosition(p.sl, bar.time, "stop-loss");
    } else if (tpHit) {
      this._closePosition(p.tp, bar.time, "take-profit");
    }
  }

  // ---- Position management --------------------------------------------------

  _openOrFlip(side, qty, price, time, { sl = null, tp = null } = {}) {
    if (this.position && this.position.side !== side) {
      // Reverse: close existing, then open new with same qty as requested.
      this._closePosition(price, time, "reverse");
    }
    if (this.position && this.position.side === side) {
      // Add to position: recompute weighted average entry.
      const p = this.position;
      const totalQty = p.qty + qty;
      p.entryPrice = (p.entryPrice * p.qty + price * qty) / totalQty;
      p.qty = totalQty;
      if (sl != null) p.sl = sl;
      if (tp != null) p.tp = tp;
      this.realizedPnL -= this.commissionPerSide * qty;
      return;
    }
    this.position = {
      side,
      qty,
      entryPrice: price,
      entryTime: time,
      entryIdx: this.idx,
      sl,
      tp,
    };
    this.realizedPnL -= this.commissionPerSide * qty;
  }

  _closePosition(price, time, reason) {
    const p = this.position;
    if (!p) return;
    const dir = p.side === "long" ? 1 : -1;
    const pnlPoints = (price - p.entryPrice) * dir;
    const pnlUSD = pnlPoints * this.contract.multiplier * p.qty;
    const commission = this.commissionPerSide * p.qty; // exit side
    this.realizedPnL += pnlUSD - commission;
    this.trades.push({
      side: p.side,
      qty: p.qty,
      entryTime: p.entryTime,
      entryPrice: p.entryPrice,
      exitTime: time,
      exitPrice: price,
      pnlPoints,
      pnlUSD: pnlUSD - commission,
      reason,
    });
    this._pushLog(
      `Closed ${p.side} x${p.qty} @ ${price.toFixed(2)} (${reason}) -> $${(pnlUSD - commission).toFixed(2)}`
    );
    this.position = null;
  }

  // ---- Public trading API -------------------------------------------------

  marketOrder(side, qty, { sl = null, tp = null } = {}) {
    if (this.idx < 0) throw new Error("Step forward to reveal a bar before trading.");
    const bar = this.currentBar;
    this._openOrFlip(side, qty, bar.close, bar.time, { sl, tp });
    this._pushLog(`Market ${side} x${qty} @ ${bar.close.toFixed(2)}`);
  }

  limitOrder(side, qty, price, { sl = null, tp = null } = {}) {
    const id = this._orderSeq++;
    this.pendingOrders.push({ id, kind: "limit", side, qty, price, sl, tp, createdIdx: this.idx });
    this._pushLog(`Placed limit ${side} x${qty} @ ${price.toFixed(2)}`);
    return id;
  }

  stopOrder(side, qty, price, { sl = null, tp = null } = {}) {
    const id = this._orderSeq++;
    this.pendingOrders.push({ id, kind: "stop", side, qty, price, sl, tp, createdIdx: this.idx });
    this._pushLog(`Placed stop ${side} x${qty} @ ${price.toFixed(2)}`);
    return id;
  }

  cancelOrder(id) {
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
  }

  setStopTarget(sl, tp) {
    if (!this.position) return;
    if (sl !== undefined) this.position.sl = sl;
    if (tp !== undefined) this.position.tp = tp;
  }

  closePosition() {
    if (!this.position || this.idx < 0) return;
    const bar = this.currentBar;
    this._closePosition(bar.close, bar.time, "manual");
  }

  // ---- Time / replay control ----------------------------------------------

  advanceOneBar() {
    if (this.idx + 1 >= this.bars.length) return false;
    this.idx += 1;
    const bar = this.bars[this.idx];
    this._fillPendingOrders(bar);
    this._checkStopsAndTargets(bar);
    this._recordEquity(bar);
    return true;
  }

  stepForward(n = 1) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (!this.advanceOneBar()) break;
      moved++;
    }
    return moved;
  }

  // Seek the replay cursor to a target bar index. Free movement while flat;
  // forward-only (bar by bar, simulating fills) while a position is open.
  seek(targetIdx) {
    targetIdx = Math.max(-1, Math.min(this.bars.length - 1, targetIdx));
    if (targetIdx === this.idx) return true;
    if (targetIdx > this.idx) {
      while (this.idx < targetIdx) {
        if (!this.advanceOneBar()) break;
      }
      return true;
    }
    // Rewinding
    if (this.position || this.pendingOrders.length) {
      return false; // caller should show a warning
    }
    this.idx = targetIdx;
    return true;
  }

  _recordEquity(bar) {
    const unrealized = this.unrealizedPnL(bar.close);
    const equity = this.startingCapital + this.realizedPnL + unrealized;
    this.equityCurve.push({ time: bar.time, equity });
  }

  unrealizedPnL(markPrice) {
    if (!this.position) return 0;
    const p = this.position;
    const dir = p.side === "long" ? 1 : -1;
    const pts = (markPrice - p.entryPrice) * dir;
    return pts * this.contract.multiplier * p.qty;
  }

  get balance() {
    return this.startingCapital + this.realizedPnL;
  }

  get equity() {
    const bar = this.currentBar;
    const unreal = bar ? this.unrealizedPnL(bar.close) : 0;
    return this.balance + unreal;
  }

  stats() {
    const trades = this.trades;
    const wins = trades.filter((t) => t.pnlUSD > 0);
    const losses = trades.filter((t) => t.pnlUSD <= 0);
    const grossWin = wins.reduce((s, t) => s + t.pnlUSD, 0);
    const grossLoss = losses.reduce((s, t) => s + t.pnlUSD, 0);
    let peak = this.startingCapital;
    let maxDD = 0;
    for (const e of this.equityCurve) {
      peak = Math.max(peak, e.equity);
      maxDD = Math.max(maxDD, peak - e.equity);
    }
    return {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      profitFactor: grossLoss !== 0 ? Math.abs(grossWin / grossLoss) : wins.length ? Infinity : 0,
      netPnL: this.realizedPnL,
      maxDrawdown: maxDD,
      equity: this.equity,
      balance: this.balance,
    };
  }

  // ---- Serialization (session save/restore) --------------------------------

  serialize() {
    return {
      contractKey: this.contractKey,
      startingCapital: this.startingCapital,
      commissionPerSide: this.commissionPerSide,
      idx: this.idx,
      realizedPnL: this.realizedPnL,
      position: this.position,
      pendingOrders: this.pendingOrders,
      trades: this.trades,
      equityCurve: this.equityCurve,
      orderSeq: this._orderSeq,
    };
  }

  restore(state) {
    this.contractKey = state.contractKey;
    this.startingCapital = state.startingCapital;
    this.commissionPerSide = state.commissionPerSide;
    this.idx = state.idx;
    this.realizedPnL = state.realizedPnL;
    this.position = state.position;
    this.pendingOrders = state.pendingOrders;
    this.trades = state.trades;
    this.equityCurve = state.equityCurve;
    this._orderSeq = state.orderSeq || 1;
  }
}
