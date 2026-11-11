// Pure trading maths. No DOM, no storage: everything here is unit-tested.
//
// R convention used across the app:
//   1R = settings.riskPct % of current capital (default 1%).
//   A trade's result in R = realised P&L / the dollar value of 1R when it was opened (trade.rValue),
//   so a default 0.5R trade that hits its stop shows as -0.5R.

export const dir = (t) => (t.side === 'short' ? -1 : 1);

export const closedShares = (t) => (t.exits || []).reduce((n, e) => n + e.shares, 0);
export const openShares = (t) => Math.max(0, t.shares - closedShares(t));
export const isClosed = (t) => openShares(t) === 0;

export function realizedPnl(t) {
  const gross = (t.exits || []).reduce((sum, e) => sum + (e.price - t.entry) * dir(t) * e.shares, 0);
  return gross - (t.fees || 0);
}

export const closeDate = (t) => (t.exits && t.exits.length ? t.exits[t.exits.length - 1].date : null);

// Result of a fully closed trade in R.
export const tradeR = (t) => (t.rValue > 0 ? realizedPnl(t) / t.rValue : 0);

// Current capital = starting capital + deposits/withdrawals + all realised P&L.
// Unrealised P&L is deliberately excluded so position sizing never leans on open profits.
export function capital(state) {
  const flows = (state.cashflows || []).reduce((s, c) => s + c.amount, 0);
  const pnl = (state.trades || []).reduce((s, t) => s + realizedPnl(t), 0);
  return (state.settings.startCapital || 0) + flows + pnl;
}

export const rUnit = (state) => capital(state) * ((state.settings.riskPct || 1) / 100);

// Locked-in result if the stop is hit now. Negative = still at risk, positive = profit locked.
export function openRiskR(t, rU) {
  if (!(rU > 0)) return 0;
  return ((t.stop - t.entry) * dir(t) * openShares(t)) / rU;
}

// Unrealised result at the last known price, or null when no price is known.
export function floatR(t, rU) {
  if (t.lastPrice == null || !(rU > 0)) return null;
  return ((t.lastPrice - t.entry) * dir(t) * openShares(t)) / rU;
}

export function floatPnl(t) {
  if (t.lastPrice == null) return null;
  return (t.lastPrice - t.entry) * dir(t) * openShares(t);
}

export const openTrades = (state) => state.trades.filter((t) => !isClosed(t));
export const closedTrades = (state) =>
  state.trades.filter(isClosed).sort((a, b) => (closeDate(a) < closeDate(b) ? -1 : closeDate(a) > closeDate(b) ? 1 : 0));

// Open heat = total R still at risk across open positions (locked profits do not offset it).
export function heatR(state) {
  const rU = rUnit(state);
  return openTrades(state).reduce((s, t) => s + Math.max(0, -openRiskR(t, rU)), 0);
}

// Net R across open positions if every stop is hit now: losses at risk minus profit already locked.
export function openRiskTotal(state) {
  const rU = rUnit(state);
  return openTrades(state).reduce((s, t) => s + openRiskR(t, rU), 0);
}

// Cash not tied up in open long positions.
export function cash(state) {
  const used = openTrades(state).reduce((s, t) => s + (t.side === 'short' ? 0 : t.entry * openShares(t)), 0);
  return capital(state) - used;
}

/**
 * Position sizing.
 * Returns { ok:false, error } for unusable input, otherwise the suggested share count
 * plus warning codes: 'heat' | 'cash' | 'concentration' | 'lowRR' | 'targetSide' | 'zero'.
 */
export function sizePosition({ entry, stop, target, side = 'long', riskMult, rU, heatLeftR, cashAvail, cap }) {
  if (!(entry > 0) || !(stop > 0)) return { ok: false, error: 'missing' };
  const d = side === 'short' ? -1 : 1;
  const per = (entry - stop) * d;
  if (per <= 0) return { ok: false, error: 'stopSide' };
  if (!(rU > 0)) return { ok: false, error: 'noCapital' };

  const wantRisk = rU * riskMult;
  const maxByHeat = Math.max(0, heatLeftR) * rU;
  const budget = Math.min(wantRisk, maxByHeat);
  // Guard against float noise (e.g. 249.99999 / 5) before flooring.
  const shares = Math.floor(budget / per + 1e-9);
  const cost = shares * entry;
  const warnings = [];
  let rr = null;
  let rewardPer = null;

  if (target > 0) {
    rewardPer = (target - entry) * d;
    if (rewardPer > 0) {
      rr = rewardPer / per;
      if (rr < 2) warnings.push('lowRR');
    } else {
      warnings.push('targetSide');
    }
  }
  if (wantRisk > maxByHeat + 1e-9) warnings.push('heat');
  if (shares === 0) warnings.push('zero');
  if (side !== 'short' && cost > cashAvail + 1e-9) warnings.push('cash');
  if (cap > 0 && cost / cap > 0.25) warnings.push('concentration');

  return {
    ok: true, shares, per, cost, rr, rewardPer, warnings,
    riskAmt: shares * per,
    actualR: (shares * per) / rU,
    costPct: cap > 0 ? cost / cap : 0,
  };
}

const sum = (a) => a.reduce((x, y) => x + y, 0);

// Summary statistics for a list of closed trades (already in chronological order).
export function stats(trades) {
  const rs = trades.map(tradeR);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const cum = [0];
  const dd = [0];
  let acc = 0, peak = 0, maxDd = 0;
  for (const r of rs) {
    acc += r;
    peak = Math.max(peak, acc);
    cum.push(acc);
    dd.push(acc - peak);
    maxDd = Math.min(maxDd, acc - peak);
  }
  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0;
  return {
    n: rs.length, rs, cum, dd, peak, maxDd,
    total: acc,
    wins: wins.length, losses: losses.length,
    winRate: rs.length ? wins.length / rs.length : 0,
    expectancy: rs.length ? acc / rs.length : 0,
    avgWin, avgLoss,
    payoff: avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null,
  };
}

// Monday = 0 ... Sunday = 6, parsed as a local date so the weekday never shifts with timezone.
export function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function groupTotals(trades, keysOf) {
  const map = new Map();
  for (const t of trades) {
    for (const k of keysOf(t)) {
      const g = map.get(k) || { key: k, total: 0, count: 0 };
      g.total += tradeR(t);
      g.count += 1;
      map.set(k, g);
    }
  }
  return [...map.values()];
}

export const bySetup = (trades) => groupTotals(trades, (t) => [t.setup || '未分類']);
export const byMistake = (trades) => groupTotals(trades, (t) => t.mistakes || []);
export const byDate = (trades) => groupTotals(trades, (t) => [closeDate(t)]);

export function byWeekday(trades) {
  const out = [0, 1, 2, 3, 4].map((d) => ({ key: d, total: 0, count: 0 }));
  for (const t of trades) {
    const d = weekday(closeDate(t));
    if (d < 5) { out[d].total += tradeR(t); out[d].count += 1; }
  }
  return out;
}

// Setup x weekday totals for the 3D chart.
export function setupWeekdayGrid(trades, setups) {
  return setups.map((s) => {
    const row = [0, 0, 0, 0, 0];
    for (const t of trades) {
      if ((t.setup || '未分類') !== s) continue;
      const d = weekday(closeDate(t));
      if (d < 5) row[d] += tradeR(t);
    }
    return { setup: s, row };
  });
}

// Grey at 0R, full red at -1R, full green at +1R.
const GREY = [142, 153, 168], RED = [240, 97, 109], GREEN = [79, 214, 156];
export function rColor(r) {
  const t = Math.min(Math.abs(r || 0), 1);
  const target = r < 0 ? RED : GREEN;
  const c = GREY.map((g, i) => Math.round(g + (target[i] - g) * t));
  return { fg: `rgb(${c.join(',')})`, bg: `rgba(${c.join(',')},${(0.08 + 0.12 * t).toFixed(2)})` };
}

export function fmtR(r, dp = 2) {
  const v = Math.abs(r) < 0.5 / 10 ** dp ? 0 : r;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}R`;
}
