// Randomised cross-checks: every number the app shows is recomputed here a second, independent way
// (a cash ledger and brute-force loops) and compared. Seeded, so a failure is reproducible.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { emptyState } from '../js/store.js';

// FUZZ_SEED=n shifts every seed, so the same checks can be rerun on fresh random data.
const SHIFT = Number(process.env.FUZZ_SEED || 0);
function rng(seed) {
  let s = (seed + SHIFT * 7919) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const eq = (a, b, msg) => assert.ok(close(a, b), `${msg}: ${a} vs ${b}`);
const pad = (n) => String(n).padStart(2, '0');

function randomState(rand) {
  const state = emptyState();
  state.settings.startCapital = Math.round(5000 + rand() * 200000);
  const nTrades = Math.floor(rand() * 40);
  for (let i = 0; i < nTrades; i++) {
    const side = rand() < 0.3 ? 'short' : 'long';
    const d = side === 'short' ? -1 : 1;
    const entry = +(1 + rand() * 500).toFixed(2);
    const riskPer = +(entry * (0.005 + rand() * 0.1)).toFixed(2) || 0.01;
    const initStop = +(entry - d * riskPer).toFixed(2);
    const moved = rand();
    const stop = moved < 0.4 ? initStop : moved < 0.6 ? entry : +(entry + d * riskPer * rand() * 3).toFixed(2);
    const shares = 1 + Math.floor(rand() * 500);
    const exits = [];
    let left = shares;
    const nExits = Math.floor(rand() * 4);
    for (let k = 0; k < nExits && left > 0; k++) {
      const n = k === nExits - 1 && rand() < 0.7 ? left : 1 + Math.floor(rand() * left);
      left -= n;
      exits.push({ date: `2026-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`, price: +(entry * (0.8 + rand() * 0.5)).toFixed(2), shares: n });
    }
    state.trades.push({
      id: `t${i}`, sym: `S${i % 7}`, side, setup: ['突破', '回調', '趨勢'][i % 3], conf: 1 + (i % 5),
      entry, shares, initStop, stop, rValue: 50 + rand() * 2000, exits, fees: rand() < 0.5 ? +(rand() * 20).toFixed(2) : 0,
      mistakes: rand() < 0.3 ? ['FOMO 追入'] : [], lastPrice: rand() < 0.7 ? +(entry * (0.8 + rand() * 0.5)).toFixed(2) : null,
    });
  }
  const nFlows = Math.floor(rand() * 4);
  for (let i = 0; i < nFlows; i++) state.cashflows.push({ id: `c${i}`, date: '2026-01-01', amount: Math.round((rand() - 0.3) * 20000) });
  return state;
}

// Reference P&L from a cash ledger: what went out when opening vs what came back when closing.
function ledgerPnl(t) {
  let cashFlow = 0;
  const sold = t.exits.reduce((n, e) => n + e.shares, 0);
  if (t.side === 'short') {
    cashFlow += t.entry * sold;                                   // proceeds of the shares that were later bought back
    for (const e of t.exits) cashFlow -= e.price * e.shares;      // buying them back
  } else {
    cashFlow -= t.entry * sold;                                   // cost of the shares that were later sold
    for (const e of t.exits) cashFlow += e.price * e.shares;
  }
  return cashFlow - t.fees;
}

test('capital, P&L, R and open risk agree with an independent ledger (3000 random accounts)', () => {
  const rand = rng(12345);
  for (let run = 0; run < 3000; run++) {
    const s = randomState(rand);
    const refCap = s.settings.startCapital + s.cashflows.reduce((a, c) => a + c.amount, 0) + s.trades.reduce((a, t) => a + ledgerPnl(t), 0);
    eq(C.capital(s), refCap, `capital run ${run}`);
    const rU = refCap / 100;
    eq(C.rUnit(s), rU, `1R run ${run}`);

    let heat = 0, net = 0, cashUsed = 0;
    for (const t of s.trades) {
      eq(C.realizedPnl(t), ledgerPnl(t), `pnl ${t.id}`);
      const open = t.shares - t.exits.reduce((n, e) => n + e.shares, 0);
      assert.equal(C.openShares(t), open);
      assert.equal(C.isClosed(t), open === 0);
      if (open === 0) { eq(C.tradeR(t), ledgerPnl(t) / t.rValue, `tradeR ${t.id}`); continue; }
      // Brute force: loss if stop hit = sum over each open share.
      let ifStopped = 0, ifNow = 0;
      for (let k = 0; k < open; k++) {
        ifStopped += t.side === 'short' ? t.entry - t.stop : t.stop - t.entry;
        if (t.lastPrice != null) ifNow += t.side === 'short' ? t.entry - t.lastPrice : t.lastPrice - t.entry;
      }
      if (rU > 0) {
        eq(C.openRiskR(t, rU), ifStopped / rU, `openRisk ${t.id}`);
        if (t.lastPrice != null) eq(C.floatR(t, rU), ifNow / rU, `floatR ${t.id}`);
        heat += Math.max(0, -ifStopped / rU);
        net += ifStopped / rU;
      }
      if (t.side !== 'short') cashUsed += t.entry * open;
      const ratio = C.stopRatio(t);
      const origRisk = Math.abs(t.entry - t.initStop);
      const sameSide = t.side === 'short' ? t.initStop > t.entry : t.initStop < t.entry;
      if (sameSide) eq(ratio, (t.side === 'short' ? t.entry - t.stop : t.stop - t.entry) / origRisk, `ratio ${t.id}`);
      if (t.lastPrice != null) eq(C.pricePct(t), ((t.side === 'short' ? t.entry - t.lastPrice : t.lastPrice - t.entry) / t.entry) * 100, `pct ${t.id}`);
    }
    if (rU > 0) { eq(C.heatR(s), heat, `heat run ${run}`); eq(C.openRiskTotal(s), net, `net run ${run}`); }
    eq(C.cash(s), refCap - cashUsed, `cash run ${run}`);
  }
});

test('stats agree with brute force and closed trades are in date order (3000 random accounts)', () => {
  const rand = rng(777);
  for (let run = 0; run < 3000; run++) {
    const s = randomState(rand);
    const closed = C.closedTrades(s);
    const lastDate = (t) => t.exits.map((e) => e.date).sort().pop();
    for (let i = 1; i < closed.length; i++) assert.ok(lastDate(closed[i - 1]) <= lastDate(closed[i]), `order run ${run}`);
    for (const t of closed) assert.equal(C.closeDate(t), lastDate(t), `closeDate is the latest exit, run ${run}`);

    const rs = closed.map((t) => ledgerPnl(t) / t.rValue);
    const st = C.stats(closed);
    eq(st.total, rs.reduce((a, b) => a + b, 0), 'total');
    const wins = rs.filter((r) => r >= 0.005), losses = rs.filter((r) => r <= -0.005); // 0.00R on screen = breakeven
    assert.equal(st.wins, wins.length);
    assert.equal(st.losses, losses.length);
    eq(st.winRate, rs.length ? wins.length / rs.length : 0, 'win rate');
    eq(st.expectancy, rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, 'expectancy');
    eq(st.avgWin, wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0, 'avg win');
    eq(st.avgLoss, losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0, 'avg loss');
    // Max drawdown by checking every pair of points.
    const cum = [0]; rs.forEach((r) => cum.push(cum[cum.length - 1] + r));
    let dd = 0;
    for (let i = 0; i < cum.length; i++) for (let j = i; j < cum.length; j++) dd = Math.min(dd, cum[j] - cum[i]);
    eq(st.maxDd, dd, `max drawdown run ${run}`);
    // Group totals add back up to the overall total.
    eq(C.bySetup(closed).reduce((a, g) => a + g.total, 0), st.total, 'by setup sums to total');
    eq(C.setupConfGrid(closed, ['突破', '回調', '趨勢']).flatMap((g) => g.row).reduce((a, b) => a + b, 0), st.total, 'grid sums to total');
    eq(C.byDate(closed).reduce((a, g) => a + g.total, 0), st.total, 'by date sums to total');
  }
});

test('position sizing never exceeds the risk budget and never leaves a whole share unused (20000 cases)', () => {
  const rand = rng(99);
  for (let i = 0; i < 20000; i++) {
    const side = rand() < 0.3 ? 'short' : 'long';
    const entry = +(0.5 + rand() * 1000).toFixed(2);
    const gap = +(Math.max(0.01, entry * rand() * 0.2)).toFixed(2);
    const stop = +(side === 'short' ? entry + gap : entry - gap).toFixed(2);
    if (!(stop > 0)) continue;
    const rU = 10 + rand() * 5000, riskMult = [0.25, 0.5, 1][i % 3], heatLeftR = rand() * 5;
    const r = C.sizePosition({ entry, stop, side, riskMult, rU, heatLeftR, cashAvail: 1e12, cap: 1e12 });
    assert.ok(r.ok, `ok ${entry} ${stop} ${side}`);
    const per = Math.abs(entry - stop), budget = Math.min(rU * riskMult, heatLeftR * rU);
    assert.ok(r.shares * per <= budget + 1e-6, `over budget: ${r.shares} x ${per} > ${budget}`);
    assert.ok((r.shares + 1) * per > budget - 1e-6, `one more share would still fit: ${r.shares} x ${per} vs ${budget}`);
    eq(r.actualR, (r.shares * per) / rU, 'actual R');
  }
});
