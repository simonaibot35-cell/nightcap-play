// Live prices from Finnhub (free tier). The API key is entered in Settings and never committed.

export async function fetchQuote(symbol, key, fetchImpl = globalThis.fetch) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'key' : res.status === 429 ? 'limit' : 'http');
  const data = await res.json();
  // Finnhub answers unknown symbols with c: 0 rather than an error.
  if (!data || !(data.c > 0)) throw new Error('symbol');
  return data.c;
}

// Refreshes every open position. Returns { updated, failed, error } without throwing.
export async function refreshQuotes(store, openTrades, fetchImpl = globalThis.fetch) {
  const key = store.get().settings.finnhubKey;
  if (!key) return { updated: 0, failed: 0, error: 'nokey' };
  const symbols = [...new Set(openTrades.map((t) => t.sym))];
  const prices = {};
  let failed = 0, error = null;
  await Promise.all(symbols.map(async (sym) => {
    try { prices[sym] = await fetchQuote(sym, key, fetchImpl); }
    catch (e) { failed += 1; error = e.message; }
  }));
  const updated = Object.keys(prices).length;
  if (updated) {
    store.update((s) => {
      for (const t of s.trades) {
        if (prices[t.sym] != null && t.exits.reduce((n, e) => n + e.shares, 0) < t.shares) {
          t.lastPrice = prices[t.sym];
          t.lastPriceAt = Date.now();
        }
      }
    });
  }
  return { updated, failed, error };
}

// US regular session, Mon-Fri 09:30-16:00 New York time (holidays not considered).
export function marketOpen(now = new Date()) {
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960;
}

// True when any open position has no price yet, or its price is older than maxAgeMs.
// Used to fetch once when the app is opened outside market hours.
export function pricesStale(openTrades, now = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  return openTrades.some((t) => t.lastPrice == null || !(t.lastPriceAt > 0) || now - t.lastPriceAt > maxAgeMs);
}
