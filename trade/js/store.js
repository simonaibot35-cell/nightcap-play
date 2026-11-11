// App state: one JSON document kept in localStorage (and optionally mirrored to the cloud by sync.js).

export const STORAGE_KEY = 'tradelog.v1';

export const DEFAULT_SETTINGS = {
  startCapital: 0,
  statsFrom: null,       // YYYY-MM-DD: win rate and expectancy on the dashboard count from here ('' = all)
  riskPct: 1,            // 1R = 1% of current capital
  defaultRiskMult: 0.5,  // default risk per trade, in R
  heatCapR: 5,           // max total open risk, in R
  finnhubKey: '',
  hideMoney: false,
  setups: ['突破', '回調', '趨勢', '財報', '反轉'],
  checks: ['趨勢向上', '成交量確認', '守住支持位', '大市配合', '板塊強勢', '跟足計劃'],
  mistakes: ['FOMO 追入', '郁咗止蝕', '太早走', '落注過大', '冇跟計劃'],
};

export function emptyState() {
  return { v: 1, updatedAt: 0, settings: { ...DEFAULT_SETTINGS }, cashflows: [], trades: [] };
}

// Accepts anything parsed from storage/import and returns a well-formed state, or null if unusable.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.trades)) return null;
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  // Records made before this setting existed start counting from the day it first loads.
  if (settings.statsFrom == null) settings.statsFrom = today();
  return {
    v: 1,
    updatedAt: Number(raw.updatedAt) || 0,
    settings,
    cashflows: Array.isArray(raw.cashflows) ? raw.cashflows : [],
    trades: raw.trades,
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createStore(storage = globalThis.localStorage) {
  let state = normalize(emptyState());
  let fillDate = false;
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY));
    fillDate = !!raw && raw.settings && raw.settings.statsFrom == null;
    state = normalize(raw) || state;
  } catch { /* corrupt or missing: start empty */ }

  const listeners = new Set();
  const persist = () => {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  };
  const emit = (origin) => listeners.forEach((fn) => fn(state, origin));
  // Save the filled-in start date without touching updatedAt, so sync still treats the cloud copy fairly.
  if (fillDate) persist();

  return {
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Local edit: stamps updatedAt so sync can tell which copy is newer.
    update(mutator) {
      mutator(state);
      state.updatedAt = Date.now();
      persist();
      emit('local');
    },
    // Replace everything (cloud pull or backup import). keepStamp preserves the incoming updatedAt.
    replace(next, { keepStamp = false, origin = 'local' } = {}) {
      const clean = normalize(next);
      if (!clean) return false;
      state = clean;
      if (!keepStamp) state.updatedAt = Date.now();
      persist();
      emit(origin);
      return true;
    },
  };
}

// 24 closed trades on the most recent weekdays plus 4 open positions, for trying the app out.
export function demoState() {
  const weekdays = [];
  for (let back = 1; weekdays.length < 24; back++) {
    const d = new Date(); d.setDate(d.getDate() - back);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      weekdays.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  }
  const rows = [
    ['UBER', '趨勢', 1.4, []], ['AMD', '回調', -0.2, ['郁咗止蝕']], ['COIN', '突破', -0.5, []], ['SHOP', '回調', 0.6, []],
    ['CRWD', '突破', -0.5, ['FOMO 追入']], ['MSFT', '趨勢', 1.1, []], ['NFLX', '回調', -0.3, ['太早走']], ['AVGO', '突破', 2.4, []],
    ['AMZN', '趨勢', -0.5, []], ['META', '突破', 0.9, []], ['TSLA', '回調', -0.5, []], ['NVDA', '突破', 1.8, []],
    ['GOOGL', '趨勢', 0.7, []], ['SNOW', '財報', -0.5, ['FOMO 追入']], ['ORCL', '回調', 0.4, ['太早走']], ['PANW', '突破', -0.5, []],
    ['LLY', '趨勢', 1.2, []], ['DDOG', '財報', -0.4, ['郁咗止蝕']], ['NOW', '突破', 1.5, []], ['ABNB', '回調', -0.5, []],
    ['ANET', '趨勢', 0.8, []], ['MU', '財報', -0.5, []], ['RBLX', '突破', -0.5, ['FOMO 追入']], ['V', '回調', 0.5, []],
  ];
  const state = emptyState();
  state.settings.startCapital = 50000;
  state.settings.statsFrom = '';
  let cap = 50000;
  const confs = [4, 2, 3, 3, 1, 5, 2, 5, 3, 4, 2, 5, 4, 1, 3, 2, 4, 2, 5, 3, 4, 2, 1, 3];
  rows.forEach(([sym, setup, r, mistakes], i) => {
    const date = weekdays[i];
    const rValue = cap * 0.01;
    const entry = 100, stop = 95;
    const shares = Math.floor((rValue * 0.5) / (entry - stop));
    const pnl = r * rValue;
    const exit = entry + pnl / shares;
    cap += pnl;
    state.trades.push({
      id: `demo${i}`, sym, side: 'long', setup, checks: ['趨勢向上'], reason: '示範交易', conf: confs[i],
      entryDate: date, entry, shares, initStop: stop, stop, target: 115, riskMult: 0.5, rValue,
      exits: [{ date, price: exit, shares }], fees: 0, mistakes, notes: '', lastPrice: null, lastPriceAt: 0,
    });
  });
  const rValue = cap * 0.01;
  const open = [
    ['NVDA', '突破', 182, 176, 176, 188.4, 4, ['趨勢向上', '成交量確認'], '日線突破 $180 阻力，成交量係 20 日平均 2 倍。'],
    ['AAPL', '回調', 228, 223, 230, 241, 3, ['趨勢向上', '守住支持位'], '回調到 20 天線企穩，出現錘頭 K。'],
    ['AMD', '突破', 165, 158, 158, 161.2, 2, ['成交量確認'], '突破三角形，但大市偏弱，所以信心一般。'],
    ['PLTR', '趨勢', 172, 167, 182, 197, 5, ['趨勢向上', '大市配合', '板塊強勢'], '強勢股創新高，板塊資金流入。'],
  ];
  open.forEach(([sym, setup, entry, initStop, stop, last, conf, checks, reason], i) => {
    state.trades.push({
      id: `demoOpen${i}`, sym, side: 'long', setup, checks, reason, conf,
      entryDate: today(), entry, shares: Math.floor((rValue * 0.5) / (entry - initStop)), initStop, stop, target: null,
      riskMult: 0.5, rValue, exits: [], fees: 0, mistakes: [], notes: '', lastPrice: last, lastPriceAt: Date.now(),
    });
  });
  return state;
}
