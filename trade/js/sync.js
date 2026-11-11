// Optional cloud sync through Supabase so phone and desktop share one record.
// The whole state is stored as a single JSON row per user (table `trade_state`, see README for the SQL).
// Conflict rule: the copy with the newer updatedAt wins.

export const SYNC_CFG_KEY = 'tradelog.sync';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export function loadSyncConfig(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(SYNC_CFG_KEY)) || null; } catch { return null; }
}
export function saveSyncConfig(cfg, storage = globalThis.localStorage) {
  if (cfg) storage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
  else storage.removeItem(SYNC_CFG_KEY);
}

export async function makeClient(cfg) {
  const { createClient } = await import(SUPABASE_CDN);
  return createClient(cfg.url, cfg.anonKey);
}

/**
 * createSync(store, client) -> { status(), signIn, signUp, signOut, pull, push, start }
 * `client` is a supabase-js client (or a test double with the same surface).
 */
export function createSync(store, client, onStatus = () => {}) {
  let status = { state: 'idle', user: null, error: null, at: 0 };
  let timer = null;
  const set = (patch) => { status = { ...status, ...patch }; onStatus(status); };

  async function user() {
    const { data } = await client.auth.getSession();
    return data && data.session ? data.session.user : null;
  }

  // Take the cloud copy if it is newer; otherwise upload ours.
  async function pull() {
    const u = await user();
    if (!u) { set({ state: 'signedOut', user: null }); return 'signedOut'; }
    set({ state: 'syncing', user: u.email, error: null });
    const { data, error } = await client.from('trade_state').select('data, updated_at').eq('user_id', u.id).maybeSingle();
    if (error) { set({ state: 'error', error: error.message }); return 'error'; }
    const local = store.get();
    const remoteStamp = data && data.data ? Number(data.data.updatedAt) || 0 : -1;
    if (data && data.data && remoteStamp > local.updatedAt) {
      store.replace(data.data, { keepStamp: true, origin: 'remote' });
      set({ state: 'synced', at: Date.now() });
      return 'pulled';
    }
    if (local.updatedAt > remoteStamp && (local.trades.length || local.settings.startCapital)) return push();
    set({ state: 'synced', at: Date.now() });
    return 'same';
  }

  async function push() {
    const u = await user();
    if (!u) { set({ state: 'signedOut', user: null }); return 'signedOut'; }
    set({ state: 'syncing', user: u.email, error: null });
    const local = store.get();
    const { error } = await client.from('trade_state')
      .upsert({ user_id: u.id, data: local, updated_at: new Date(local.updatedAt || Date.now()).toISOString() });
    if (error) { set({ state: 'error', error: error.message }); return 'error'; }
    set({ state: 'synced', at: Date.now() });
    return 'pushed';
  }

  function schedulePush() {
    clearTimeout(timer);
    timer = setTimeout(() => { push().catch((e) => set({ state: 'error', error: e.message })); }, 1500);
  }

  return {
    status: () => status,
    pull, push,
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) { set({ state: 'error', error: error.message }); return false; }
      await pull();
      return true;
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) { set({ state: 'error', error: error.message }); return false; }
      if (!data.session) { set({ state: 'confirm', user: email }); return true; }
      await pull();
      return true;
    },
    async signOut() {
      await client.auth.signOut();
      set({ state: 'signedOut', user: null, error: null });
    },
    // Pull once, then upload after every local edit and re-pull when the tab becomes visible again.
    start() {
      const run = (fn) => fn().catch((e) => set({ state: 'error', error: e.message }));
      run(pull);
      const unsub = store.subscribe((_s, origin) => { if (origin === 'local') schedulePush(); });
      const onVis = () => { if (globalThis.document && document.visibilityState === 'visible') run(pull); };
      if (globalThis.document) document.addEventListener('visibilitychange', onVis);
      return () => { unsub(); clearTimeout(timer); if (globalThis.document) document.removeEventListener('visibilitychange', onVis); };
    },
  };
}
