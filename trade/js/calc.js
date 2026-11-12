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

// Removes the most recently entered exit and its fees, returning it (or null when there is none).
// Exits recorded before per-exit fees existed carry no fee of their own: if such an exit was the only one,
// every fee on the trade came from it, so the fees are cleared; otherwise they are left as they are.
export function undoLastExit(t) {
  if (!t.exits || !t.exits.length) return null;
  const e = t.exits.pop();
  if (e.fees != null) t.fees = Math.max(0, (t.fees || 0) - e.fees);
  else if (!t.exits.length) t.fees = 0;
  return e;
}

// The latest exit date, whatever order partial exits were entered in.
export const closeDate = (t) => ((t.exits || []).reduce((d, e) => (d == null || e.date > d ? e.date : d), null));

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

// R at risk with the original stop (negative = loss if hit), on the open shares.
export function initRiskR(t, rU) {
  if (!(rU > 0)) return 0;
  return ((t.initStop - t.entry) * dir(t) * openShares(t)) / rU;
}

// Current stop measured against the original risk: -1 = stop unchanged, 0 = breakeven, +2 = locked twice the original risk.
// Null when the original stop was at or beyond the entry (no original risk to compare with).
export function stopRatio(t) {
  const init = (t.entry - t.initStop) * dir(t);
  if (!(init > 0)) return null;
  return ((t.stop - t.entry) * dir(t)) / init;
}

// Size of the original position as a % of the capital at the time it was opened.
// rValue was 1R then, i.e. riskPct % of that capital.
export function positionPct(t, riskPct = 1) {
  if (!(t.rValue > 0) || !(riskPct > 0)) return null;
  const capAtEntry = t.rValue / (riskPct / 100);
  return ((t.entry * t.shares) / capAtEntry) * 100;
}

// Price move since entry in %, positive when the position is winning (shorts included).
export function pricePct(t) {
  if (t.lastPrice == null || !(t.entry > 0)) return null;
  return ((t.lastPrice - t.entry) / t.entry) * dir(t) * 100;
}

export function floatPnl(t) {
  if (t.lastPrice == null) return null;
  return (t.lastPrice - t.entry) * dir(t) * openShares(t);
}

export const openTrades = (state) => state.trades.filter((t) => !isClosed(t));
export const closedTrades = (state) =>
  state.trades.filter(isClosed)
    .map((t, i) => ({ t, d: closeDate(t), i }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i))
    .map((x) => x.t);

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
  warnings.push(...checkShares({ shares, entry, per, side, rU, heatLeftR: Infinity, cashAvail, cap }));

  return {
    ok: true, shares, per, cost, rr, rewardPer, warnings,
    riskAmt: shares * per,
    actualR: (shares * per) / rU,
    costPct: cap > 0 ? cost / cap : 0,
  };
}

/**
 * Checks for a given share count (used when the user types their own share count instead of the suggestion).
 * Returns warning codes: 'heatOver' | 'cash' | 'concentration'.
 */
export function checkShares({ shares, entry, per, side = 'long', rU, heatLeftR, cashAvail, cap }) {
  const out = [];
  const cost = shares * entry;
  if (rU > 0 && (shares * per) / rU > heatLeftR + 1e-9) out.push('heatOver');
  if (side !== 'short' && cost > cashAvail + 1e-9) out.push('cash');
  if (cap > 0 && cost / cap > 0.25) out.push('concentration');
  return out;
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
export const BE = 0.005; // |R| below this shows as 0.00R and counts as breakeven

// Summary statistics for a list of closed trades (already in chronological order).
export function stats(trades) {
  const rs = trades.map(tradeR);
  // A trade that rounds to 0.00R is breakeven: it counts towards the trade count but is neither a win nor a loss,
  // so it cannot drag the average loss towards zero. The cut-off matches what fmtR displays as 0.00R.
  const wins = rs.filter((r) => r >= BE);
  const losses = rs.filter((r) => r <= -BE);
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
    wins: wins.length, losses: losses.length, breakeven: rs.length - wins.length - losses.length,
    winRate: rs.length ? wins.length / rs.length : 0,
    expectancy: rs.length ? acc / rs.length : 0,
    avgWin, avgLoss,
    payoff: avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null,
  };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// First day (YYYY-MM-DD, local time) of the current week (Monday), month or year.
export function periodStart(kind, now = new Date()) {
  if (kind === 'year') return ymd(new Date(now.getFullYear(), 0, 1));
  if (kind === 'month') return ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
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

// Setup x confidence (1-5) totals for the 3D chart. Trades without a confidence score are left out.
export function setupConfGrid(trades, setups) {
  return setups.map((s) => {
    const row = [0, 0, 0, 0, 0];
    for (const t of trades) {
      if ((t.setup || '未分類') !== s) continue;
      const c = Number(t.conf);
      if (c >= 1 && c <= 5) row[c - 1] += tradeR(t);
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
