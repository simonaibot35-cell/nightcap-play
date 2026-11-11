import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { createStore, demoState, emptyState, normalize, today } from '../js/store.js';
import { createSync } from '../js/sync.js';
import { fetchQuote, refreshQuotes, marketOpen, pricesStale } from '../js/quotes.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const trade = (o = {}) => ({ id: 't', sym: 'X', side: 'long', setup: '突破', entry: 100, shares: 50, initStop: 95, stop: 95, rValue: 500, exits: [], fees: 0, mistakes: [], lastPrice: null, ...o });
const state = (trades = [], settings = {}) => ({ ...emptyState(), settings: { ...emptyState().settings, startCapital: 50000, ...settings }, trades });

test('capital = start + cashflows + realised P&L, R = 1%', () => {
  const s = state([trade({ exits: [{ date: '2026-10-01', price: 110, shares: 50 }], fees: 5 })]);
  s.cashflows = [{ id: 'c', date: '2026-10-01', amount: 1000 }];
  assert.equal(C.capital(s), 50000 + 1000 + 495);
  near(C.rUnit(s), 514.95);
});

test('unrealised P&L never changes capital', () => {
  assert.equal(C.capital(state([trade({ lastPrice: 200 })])), 50000);
});

test('default 0.5R sizing: $50k, 100 -> 95 gives 50 shares', () => {
  const r = C.sizePosition({ entry: 100, stop: 95, target: 115, side: 'long', riskMult: 0.5, rU: 500, heatLeftR: 5, cashAvail: 50000, cap: 50000 });
  assert.equal(r.shares, 50);
  assert.equal(r.riskAmt, 250);
  near(r.actualR, 0.5);
  near(r.rr, 3);
  assert.deepEqual(r.warnings, []);
});

test('sizing floors shares and survives float noise', () => {
  const r = C.sizePosition({ entry: 10.3, stop: 10.2, side: 'long', riskMult: 0.5, rU: 500, heatLeftR: 5, cashAvail: 1e9, cap: 1e9 });
  assert.equal(r.shares, 2500);
  assert.equal(C.sizePosition({ entry: 100, stop: 93, side: 'long', riskMult: 0.5, rU: 500, heatLeftR: 5, cashAvail: 1e9, cap: 1e9 }).shares, 35);
});

test('short sizing and wrong-side stops', () => {
  const r = C.sizePosition({ entry: 100, stop: 104, target: 88, side: 'short', riskMult: 1, rU: 500, heatLeftR: 5, cashAvail: 0, cap: 50000 });
  assert.equal(r.shares, 125);
  near(r.rr, 3);
  assert.ok(!r.warnings.includes('cash'), 'shorts are not checked against cash');
  assert.equal(C.sizePosition({ entry: 100, stop: 104, side: 'long', riskMult: 1, rU: 500, heatLeftR: 5 }).error, 'stopSide');
  assert.equal(C.sizePosition({ entry: 100, stop: 96, side: 'short', riskMult: 1, rU: 500, heatLeftR: 5 }).error, 'stopSide');
  assert.equal(C.sizePosition({ entry: NaN, stop: 96, riskMult: 1, rU: 500, heatLeftR: 5 }).error, 'missing');
});

test('sizing warnings: heat cap shrinks size, cash, concentration, low R:R', () => {
  const heat = C.sizePosition({ entry: 100, stop: 95, side: 'long', riskMult: 1, rU: 500, heatLeftR: 0.4, cashAvail: 1e9, cap: 1e9 });
  assert.equal(heat.shares, 40);
  assert.ok(heat.warnings.includes('heat'));
  const tight = C.sizePosition({ entry: 100, stop: 99.5, target: 100.5, side: 'long', riskMult: 0.5, rU: 500, heatLeftR: 5, cashAvail: 1000, cap: 50000 });
  assert.equal(tight.shares, 500);
  for (const w of ['cash', 'concentration', 'lowRR']) assert.ok(tight.warnings.includes(w), w);
  const full = C.sizePosition({ entry: 100, stop: 95, side: 'long', riskMult: 0.5, rU: 500, heatLeftR: 0, cashAvail: 1e9, cap: 1e9 });
  assert.equal(full.shares, 0);
  assert.ok(full.warnings.includes('zero'));
});

test('open risk: -0.5R at the initial stop, 0 at breakeven, positive once profit is locked', () => {
  near(C.openRiskR(trade(), 500), -0.5);
  near(C.openRiskR(trade({ stop: 100 }), 500), 0);
  near(C.openRiskR(trade({ stop: 110 }), 500), 1);
  near(C.openRiskR(trade({ side: 'short', entry: 100, stop: 105 }), 500), -0.5);
  near(C.openRiskR(trade({ side: 'short', entry: 100, stop: 90 }), 500), 1);
});

test('float R follows the last price and is null without one', () => {
  assert.equal(C.floatR(trade(), 500), null);
  near(C.floatR(trade({ lastPrice: 104 }), 500), 0.4);
  near(C.floatR(trade({ side: 'short', lastPrice: 104 }), 500), -0.4);
});

test('open heat counts only positions still at risk; partial exits reduce it', () => {
  const s = state([trade(), trade({ id: 'b', stop: 110 }), trade({ id: 'c', exits: [{ date: '2026-10-01', price: 100, shares: 25 }] })]);
  near(C.heatR(s), 0.75);
  assert.equal(C.cash(s), 50000 - 5000 - 5000 - 2500);
});

test('trade R uses the R value frozen at entry; fees count', () => {
  near(C.tradeR(trade({ exits: [{ date: '2026-10-01', price: 95, shares: 50 }] })), -0.5);
  near(C.tradeR(trade({ exits: [{ date: '2026-10-01', price: 110, shares: 25 }, { date: '2026-10-02', price: 120, shares: 25 }] })), 1.5);
  near(C.tradeR(trade({ side: 'short', exits: [{ date: '2026-10-01', price: 90, shares: 50 }], fees: 50 })), 0.9);
  assert.equal(C.isClosed(trade({ exits: [{ date: 'd', price: 1, shares: 49 }] })), false);
});

test('stats: totals, win rate, expectancy, drawdown', () => {
  const mk = (r, i) => trade({ id: String(i), exits: [{ date: `2026-10-0${i + 1}`, price: 100 + r * 10, shares: 50 }] });
  const st = C.stats([2, -0.5, -0.5, 1].map(mk));
  near(st.total, 2);
  assert.equal(st.wins, 2);
  near(st.winRate, 0.5);
  near(st.expectancy, 0.5);
  near(st.avgWin, 1.5);
  near(st.avgLoss, -0.5);
  near(st.payoff, 3);
  near(st.maxDd, -1);
  near(st.peak, 2);
  assert.deepEqual(st.cum.map((v) => +v.toFixed(2)), [0, 2, 1.5, 1, 2]);
  const none = C.stats([]);
  assert.equal(none.n, 0);
  assert.equal(none.winRate, 0);
  assert.equal(none.payoff, null);
});

test('weekday parsing and groupings', () => {
  assert.equal(C.weekday('2026-10-01'), 3); // Thursday
  assert.equal(C.weekday('2026-10-05'), 0); // Monday
  assert.equal(C.weekday('2026-10-04'), 6); // Sunday
  const a = trade({ id: 'a', setup: '突破', mistakes: ['FOMO 追入'], exits: [{ date: '2026-10-05', price: 95, shares: 50 }] });
  const b = trade({ id: 'b', setup: '回調', exits: [{ date: '2026-10-05', price: 120, shares: 50 }] });
  const c = trade({ id: 'c', setup: '突破', exits: [{ date: '2026-10-01', price: 110, shares: 50 }] });
  const all = [a, b, c];
  near(C.bySetup(all).find((g) => g.key === '突破').total, 0.5);
  near(C.byWeekday(all)[0].total, 1.5);
  near(C.byWeekday(all)[3].total, 1);
  assert.equal(C.byMistake(all).length, 1);
  near(C.byMistake(all)[0].total, -0.5);
  near(C.byDate(all).find((g) => g.key === '2026-10-05').total, 1.5);
  assert.deepEqual(C.setupWeekdayGrid(all, ['突破', '回調']).map((g) => g.row.map((v) => +v.toFixed(2))), [[-0.5, 0, 0, 1, 0], [2, 0, 0, 0, 0]]);
});

test('colour scale and R formatting', () => {
  assert.equal(C.rColor(-1).fg, 'rgb(240,97,109)');
  assert.equal(C.rColor(-3).fg, 'rgb(240,97,109)');
  assert.equal(C.rColor(1).fg, 'rgb(79,214,156)');
  assert.equal(C.rColor(0).fg, 'rgb(142,153,168)');
  assert.equal(C.fmtR(0.5), '+0.50R');
  assert.equal(C.fmtR(-0.49), '−0.49R');
  assert.equal(C.fmtR(-0.001), '0.00R');
  assert.equal(C.fmtR(1.26, 1), '+1.3R');
});

const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('store persists, stamps edits, and rejects junk imports', () => {
  const storage = memStorage();
  const a = createStore(storage);
  a.update((s) => { s.settings.startCapital = 1234; });
  assert.ok(a.get().updatedAt > 0);
  assert.equal(createStore(storage).get().settings.startCapital, 1234);
  assert.equal(a.replace({ nope: true }), false);
  assert.equal(normalize('x'), null);
  storage.setItem('tradelog.v1', '{broken');
  assert.equal(createStore(storage).get().trades.length, 0);
});

test('demo data is internally consistent', () => {
  const s = demoState();
  assert.equal(C.closedTrades(s).length, 24);
  assert.equal(C.openTrades(s).length, 4);
  const st = C.stats(C.closedTrades(s));
  near(st.total, 7.9, 0.05);
  assert.ok(C.heatR(s) > 0.9 && C.heatR(s) < 1.1);
  for (const t of C.closedTrades(s)) assert.ok(C.weekday(C.closeDate(t)) < 5, 'no weekend trades');
});

function fakeClient(row) {
  const calls = { upserts: [] };
  const session = { user: { id: 'u1', email: 'me@example.com' } };
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => ({}),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row.current, error: null }) }) }),
      upsert: async (v) => { calls.upserts.push(v); row.current = { data: JSON.parse(JSON.stringify(v.data)) }; return { error: null }; },
    }),
  };
}

test('sync: newer cloud copy replaces local, newer local copy is uploaded', async () => {
  const remote = demoState(); remote.updatedAt = 5000;
  const row = { current: { data: remote } };
  const store = createStore(memStorage());
  const sync = createSync(store, fakeClient(row));
  assert.equal(await sync.pull(), 'pulled');
  assert.equal(store.get().trades.length, 28);
  assert.equal(store.get().updatedAt, 5000);

  store.update((s) => { s.settings.heatCapR = 6; });
  const client = fakeClient(row);
  assert.equal(await createSync(store, client).pull(), 'pushed');
  assert.equal(client.calls.upserts[0].data.settings.heatCapR, 6);
  assert.equal(client.calls.upserts[0].user_id, 'u1');
});

test('sync: an empty new device never overwrites the cloud or uploads nothing', async () => {
  const client = fakeClient({ current: null });
  assert.equal(await createSync(createStore(memStorage()), client).pull(), 'same');
  assert.equal(client.calls.upserts.length, 0);
});

test('quotes: parses price, maps errors, updates only open positions', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ c: 123.45 }) });
  assert.equal(await fetchQuote('NVDA', 'k', ok), 123.45);
  await assert.rejects(fetchQuote('ZZZZ', 'k', async () => ({ ok: true, json: async () => ({ c: 0 }) })), /symbol/);
  await assert.rejects(fetchQuote('NVDA', 'k', async () => ({ ok: false, status: 401 })), /key/);
  await assert.rejects(fetchQuote('NVDA', 'k', async () => ({ ok: false, status: 429 })), /limit/);

  const store = createStore(memStorage());
  store.replace(demoState());
  assert.equal((await refreshQuotes(store, C.openTrades(store.get()), ok)).error, 'nokey');
  store.update((s) => { s.settings.finnhubKey = 'k'; });
  const res = await refreshQuotes(store, C.openTrades(store.get()), ok);
  assert.equal(res.updated, 4);
  assert.ok(C.openTrades(store.get()).every((t) => t.lastPrice === 123.45));
  assert.ok(C.closedTrades(store.get()).every((t) => t.lastPrice === null));
});

test('market hours use New York time', () => {
  assert.equal(marketOpen(new Date('2026-11-11T15:00:00Z')), true);  // Wed 10:00 ET
  assert.equal(marketOpen(new Date('2026-11-11T13:00:00Z')), false); // Wed 08:00 ET
  assert.equal(marketOpen(new Date('2026-11-14T16:00:00Z')), false); // Saturday
});

test('prices are stale when missing or older than 10 minutes', () => {
  const now = 1_000_000_000;
  assert.equal(pricesStale([{ lastPrice: null, lastPriceAt: 0 }], now), true);
  assert.equal(pricesStale([{ lastPrice: 10, lastPriceAt: now - 60_000 }], now), false);
  assert.equal(pricesStale([{ lastPrice: 10, lastPriceAt: now - 60_000 }, { lastPrice: 10, lastPriceAt: now - 11 * 60_000 }], now), true);
  assert.equal(pricesStale([], now), false);
});

test('net open risk adds locked profit and remaining risk', () => {
  const s = state([trade(), trade({ id: 'b', stop: 110 })]);
  near(C.openRiskTotal(s), 0.5);
  near(C.heatR(s), 0.5);
});

test('stats start date: filled with today for old records, kept when set, empty for demo', () => {
  assert.equal(normalize({ trades: [], settings: {} }).settings.statsFrom, today());
  assert.equal(normalize({ trades: [], settings: { statsFrom: '2026-01-02' } }).settings.statsFrom, '2026-01-02');
  assert.equal(normalize(demoState()).settings.statsFrom, '');
  const storage = memStorage();
  storage.setItem('tradelog.v1', JSON.stringify({ updatedAt: 42, trades: [], settings: { startCapital: 1 } }));
  const st = createStore(storage);
  assert.equal(st.get().updatedAt, 42, 'filling the date must not look like a new edit to sync');
  assert.equal(JSON.parse(storage.getItem('tradelog.v1')).settings.statsFrom, today());
});
