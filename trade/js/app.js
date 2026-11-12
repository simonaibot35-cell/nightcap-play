// App shell: routing, rendering, and every user action.
import * as C from './calc.js';
import * as V from './views.js';
import { createStore, demoState, emptyState, uid, today } from './store.js';
import { fetchQuote, refreshQuotes, marketOpen, pricesStale } from './quotes.js';
import { createSync, loadSyncConfig, saveSyncConfig, makeClient } from './sync.js';

const TABS = { dash: '總覽', new: '倉位計算機', log: '交易紀錄', stats: '分析', settings: '設定' };
const store = createStore();
const blankForm = () => ({
  side: 'long', sym: '', entry: '', stop: '', target: '', shares: '',
  riskMult: store.get().settings.defaultRiskMult,
  setup: store.get().settings.setups[0] || '', checks: [], reason: '', conf: 3,
});
const ui = {
  tab: 'dash', form: blankForm(), range: 'all', rot: -32,
  cal: null, // null = follow the month of the latest closed trade
  sheetId: null, quoteNote: '', syncCfg: loadSyncConfig(), syncStatus: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main'), sheet = $('#sheet'), toastEl = $('#toast');
let sync = null, stopSync = null, inAction = false, toastTimer = 0;

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// Run a state change, then redraw once (the store subscriber skips redraws while this runs).
function act(mutator) {
  inAction = true;
  try { store.update(mutator); } finally { inAction = false; }
}

/* ---------- Rendering ---------- */

function render({ animate = false } = {}) {
  const state = store.get();
  const view = { dash: V.dashboard, new: V.calculator, log: V.log, stats: V.analysis, settings: V.settings }[ui.tab];
  main.classList.toggle('anim', animate);
  main.innerHTML = view(state, ui);
  $('#title').textContent = TABS[ui.tab];
  document.querySelectorAll('nav [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  const eye = $('#eye');
  eye.setAttribute('aria-pressed', String(!!state.settings.hideMoney));
  eye.setAttribute('aria-label', state.settings.hideMoney ? '顯示金額' : '隱藏金額');
  if (animate) main.scrollTop = 0;
}

function renderSheet() {
  const t = store.get().trades.find((x) => x.id === ui.sheetId);
  if (!t) { closeSheet(); return; }
  $('#sheet-body').innerHTML = V.tradeSheet(store.get(), t);
}
function openSheet(id) {
  ui.sheetId = id;
  renderSheet();
  if (!sheet.open) sheet.showModal();
}
function closeSheet() {
  ui.sheetId = null;
  if (sheet.open) sheet.close();
}

function go(tab, { animate = true } = {}) {
  ui.tab = TABS[tab] ? tab : 'dash';
  if (location.hash !== `#/${ui.tab}`) history.replaceState(null, '', `#/${ui.tab}`);
  render({ animate });
}

// Numbers tick up from zero the first time the dashboard appears.
function countUp() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || store.get().settings.hideMoney) return;
  const money = V.moneyFmt(store.get());
  const els = [...main.querySelectorAll('[data-count]')];
  const start = performance.now();
  const step = (ts) => {
    const t = Math.min(1, (ts - start) / 1100), e = 1 - (1 - t) ** 3;
    for (const el of els) if (el.isConnected) el.textContent = money(Number(el.dataset.count) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Background changes (live quotes, cloud pull) must not wipe a form the user is typing in.
store.subscribe(() => {
  if (inAction) return;
  if (ui.tab === 'new') { const el = $('#calc-result'); if (el) el.innerHTML = V.calcResult(store.get(), ui.form); }
  else if (ui.tab !== 'settings') render();
  if (ui.sheetId && !sheet.contains(document.activeElement)) renderSheet();
});

/* ---------- Live quotes ---------- */

// mode: 'manual' (button), 'tick' (every 30s while the market is open),
// 'open' (app opened or brought back to the screen: also fetches after hours if prices are stale).
let polling = false;
async function pollQuotes(mode = 'tick') {
  const manual = mode === 'manual';
  const state = store.get(), open = C.openTrades(state);
  if (!state.settings.finnhubKey) { if (manual) toast('未設定 Finnhub API key，去「設定」加入。'); return; }
  if (!open.length) { if (manual) toast('未有持倉要更新。'); return; }
  if (!manual) {
    if (document.visibilityState !== 'visible' || polling) return;
    if (!marketOpen() && !(mode === 'open' && pricesStale(open))) return;
  }
  polling = true;
  try { await doPoll(manual); } finally { polling = false; }
}

async function doPoll(manual) {
  const open = C.openTrades(store.get());
  const res = await refreshQuotes(store, open);
  const time = new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  ui.quoteNote = res.updated ? `已更新 ${time}${res.failed ? `（${res.failed} 隻失敗）` : ''}`
    : { key: 'API key 唔啱', limit: '請求太密，遲啲再試', symbol: '搵唔到代號' }[res.error] || '更新失敗，檢查網絡';
  if (ui.tab === 'dash' || ui.tab === 'settings') render();
  if (manual) toast(ui.quoteNote);
}

/* ---------- Cloud sync ---------- */

async function startSync() {
  if (stopSync) { stopSync(); stopSync = null; }
  sync = null;
  const cfg = ui.syncCfg;
  if (!cfg || !cfg.url || !cfg.anonKey) return false;
  try {
    const client = await makeClient(cfg);
    sync = createSync(store, client, (s) => { ui.syncStatus = s; if (ui.tab === 'settings') render(); });
    stopSync = sync.start();
    return true;
  } catch (e) {
    ui.syncStatus = { state: 'error', error: '連唔到 Supabase，檢查 URL 同網絡' };
    return false;
  }
}

async function syncAuth(mode) {
  const url = $('#sy-url').value.trim(), anonKey = $('#sy-key').value.trim();
  const email = $('#sy-email').value.trim(), pass = $('#sy-pass').value;
  if (mode === 'signout') { if (sync) await sync.signOut(); render(); return; }
  if (!url || !anonKey || !email || !pass) { toast('URL、anon key、email 同密碼都要填。'); return; }
  ui.syncCfg = { url, anonKey, email };
  saveSyncConfig(ui.syncCfg);
  if (!(await startSync())) { render(); return; }
  const ok = mode === 'signup' ? await sync.signUp(email, pass) : await sync.signIn(email, pass);
  toast(ok ? (mode === 'signup' ? '已註冊' : '已登入，資料同步咗') : '登入失敗，睇吓狀態嗰行');
  render();
}

/* ---------- Actions ---------- */

function saveTrade() {
  const f = ui.form, state = store.get();
  const sym = f.sym.trim().toUpperCase();
  const r = V.sizing(state, f);
  if (!sym) { toast('未入股票代號。'); $('#f-sym').focus(); return; }
  if (!r.ok) { toast('入市價同止蝕價未啱，睇吓下面嘅提示。'); return; }
  const shares = f.shares !== '' ? Math.floor(Number(f.shares)) : r.shares;
  if (!(shares > 0)) { toast('股數要大過 0。'); return; }
  const entry = parseFloat(f.entry), stop = parseFloat(f.stop), target = parseFloat(f.target);
  const id = uid();
  act((s) => {
    s.trades.push({
      id, sym, side: f.side, setup: f.setup, checks: [...f.checks], reason: f.reason.trim(), conf: f.conf,
      entryDate: today(), entry, shares, initStop: stop, stop, target: target > 0 ? target : null,
      riskMult: f.riskMult, rValue: C.rUnit(s), exits: [], fees: 0, mistakes: [], notes: '',
      lastPrice: null, lastPriceAt: 0,
    });
  });
  ui.form = blankForm();
  toast(`已記錄 ${sym} ${shares} 股`);
  go('dash');
  pollQuotes('open');
}

function sheetTrade(s) { return s.trades.find((x) => x.id === ui.sheetId); }
// Keep whatever is typed in the notes box when the sheet redraws.
function captureNotes(s) {
  const el = $('#ts-notes'), t = sheetTrade(s);
  if (el && t) t.notes = el.value;
}

const actions = {
  'set-capital'() {
    const v = parseFloat($('#ob-capital').value);
    if (!(v > 0)) { toast('入一個大過 0 嘅本金。'); return; }
    act((s) => { s.settings.startCapital = v; s.settings.statsFrom = today(); });
    render({ animate: true });
  },
  'load-demo'() {
    if (store.get().trades.length && !confirm('會用示範數據蓋過而家嘅資料，確定？')) return;
    inAction = true; store.replace(demoState()); inAction = false;
    ui.form = blankForm();
    go('dash');
    countUp();
  },
  wipe() {
    if (!confirm('會刪除呢部機上面所有交易同設定，冇得還原。確定？')) return;
    inAction = true; store.replace(emptyState()); inAction = false;
    ui.form = blankForm();
    go('dash');
  },
  'open-trade'(el) { openSheet(el.dataset.id); },
  'close-sheet'() { closeSheet(); },
  'refresh-quotes'() { pollQuotes('manual'); },

  side(el) { ui.form.side = el.dataset.v; render(); },
  risk(el) { ui.form.riskMult = Number(el.dataset.v); render(); },
  setup(el) { ui.form.setup = el.dataset.v; render(); },
  conf(el) { ui.form.conf = Number(el.dataset.v); render(); },
  check(el) {
    const v = el.dataset.v, list = ui.form.checks;
    ui.form.checks = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    render();
  },
  'save-trade': saveTrade,

  range(el) { ui.range = el.dataset.v; render(); },
  curve(el) { ui.curveRange = el.dataset.v; render(); },
  'log-more'() { ui.logLimit = (ui.logLimit || V.LOG_PAGE) + V.LOG_PAGE; render(); },
  cal(el) {
    const d = new Date(Number(el.dataset.y), Number(el.dataset.m) + Number(el.dataset.v), 1);
    ui.cal = { y: d.getFullYear(), m: d.getMonth() };
    render();
  },
  rot(el) { setRot(ui.rot + Number(el.dataset.v), true); },

  'save-levels'() {
    const stop = parseFloat($('#ts-stop').value), last = parseFloat($('#ts-last').value);
    if (!(stop > 0)) { toast('止蝕價要大過 0。'); return; }
    act((s) => {
      const t = sheetTrade(s); captureNotes(s);
      t.stop = stop;
      if (last > 0) { t.lastPrice = last; t.lastPriceAt = Date.now(); }
    });
    renderSheet(); render(); toast('已更新');
  },
  'exit-trade'() {
    const px = parseFloat($('#ts-exit').value), n = Math.floor(Number($('#ts-shares').value));
    const fees = parseFloat($('#ts-fees').value) || 0, date = $('#ts-date').value || today();
    const t0 = sheetTrade(store.get()), open = C.openShares(t0);
    if (!(px > 0)) { toast('入平倉價。'); return; }
    if (!(n > 0) || n > open) { toast(`股數要喺 1 至 ${open} 之間。`); return; }
    const all = n === open;
    if (!confirm(`用 $${px.toFixed(2)} 平 ${n} 股 ${t0.sym}？${all ? '\n平晒之後會搬去「交易紀錄」。' : ''}`)) return;
    act((s) => {
      const t = sheetTrade(s); captureNotes(s);
      t.exits.push({ date, price: px, shares: n, fees });
      t.fees = (t.fees || 0) + fees;
      t.lastPrice = px; t.lastPriceAt = Date.now();
    });
    const t = sheetTrade(store.get());
    toast(C.isClosed(t) ? `已平倉：${C.fmtR(C.tradeR(t))}` : `已平 ${n} 股，仲有 ${C.openShares(t)} 股`);
    renderSheet(); render();
  },
  mistake(el) {
    act((s) => {
      const t = sheetTrade(s); captureNotes(s);
      const v = el.dataset.v, list = t.mistakes || [];
      t.mistakes = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    });
    renderSheet(); render();
  },
  'save-notes'() { act((s) => captureNotes(s)); toast('已儲存'); },
  'undo-exit'() {
    const t0 = sheetTrade(store.get());
    const e = t0 && t0.exits[t0.exits.length - 1];
    if (!e) return;
    if (!confirm(`撤銷 ${e.date} 用 $${Number(e.price).toFixed(2)} 平 ${e.shares} 股？\n呢 ${e.shares} 股會返去持倉。`)) return;
    act((s) => { const t = sheetTrade(s); captureNotes(s); C.undoLastExit(t); });
    toast(`已撤銷，${t0.sym} 而家有 ${C.openShares(sheetTrade(store.get()))} 股持倉`);
    renderSheet(); render();
  },
  'delete-trade'() {
    if (!confirm('刪除呢單交易？冇得還原。')) return;
    const id = ui.sheetId;
    act((s) => { s.trades = s.trades.filter((x) => x.id !== id); });
    closeSheet(); render();
  },

  'add-cashflow'() {
    const amount = parseFloat($('#cf-amount').value), date = $('#cf-date').value || today();
    if (!amount) { toast('入金額，出金用負數。'); return; }
    act((s) => { s.cashflows.push({ id: uid(), date, amount }); });
    render();
  },
  'del-cashflow'(el) { act((s) => { s.cashflows = s.cashflows.filter((c) => c.id !== el.dataset.id); }); render(); },

  'sync-signin'() { syncAuth('signin'); },
  'sync-signup'() { syncAuth('signup'); },
  'sync-signout'() { syncAuth('signout'); },

  export() {
    const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `trade-log-${today()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import() { $('#import-file').click(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) { actions[el.dataset.act](el); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { go(tab.dataset.tab); return; }
  if (e.target === sheet) closeSheet(); // click on the backdrop
});
sheet.addEventListener('close', () => { ui.sheetId = null; });

$('#eye').addEventListener('click', () => {
  act((s) => { s.settings.hideMoney = !s.settings.hideMoney; });
  render();
  if (ui.sheetId) renderSheet();
});

// Calculator inputs update the result card only, so the keyboard and cursor stay put.
main.addEventListener('input', (e) => {
  const f = e.target.dataset.f;
  if (!f) return;
  ui.form[f] = f === 'sym' ? e.target.value.toUpperCase() : e.target.value;
  if (f === 'reason' || f === 'sym') return;
  if (f === 'shares') return; // redrawing here would replace the field being typed in
  $('#calc-result').innerHTML = V.calcResult(store.get(), ui.form);
});

main.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.f === 'shares') { $('#calc-result').innerHTML = V.calcResult(store.get(), ui.form); return; }
  if (el.dataset.f === 'sym') {
    // Pre-fill the entry price from a live quote when one is available.
    const key = store.get().settings.finnhubKey, sym = ui.form.sym.trim();
    if (!key || !sym || ui.form.entry) return;
    try {
      const px = await fetchQuote(sym, key);
      if (!ui.form.entry && ui.form.sym.trim() === sym) { ui.form.entry = String(px); if (ui.tab === 'new') render(); }
    } catch { /* leave the field for manual entry */ }
    return;
  }
  if (el.dataset.s) {
    const k = el.dataset.s;
    const text = k === 'finnhubKey' || k === 'statsFrom';
    const v = text ? el.value.trim() : parseFloat(el.value);
    if (!text && !(v > 0)) { toast('要入一個大過 0 嘅數。'); render(); return; }
    act((s) => { s.settings[k] = v; });
    if (k === 'defaultRiskMult') ui.form.riskMult = v;
    render();
    return;
  }
  if (el.id === 'import-file' && el.files[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (!confirm('會用匯入嘅檔案蓋過而家嘅資料，確定？')) return;
      inAction = true; const ok = store.replace(data); inAction = false;
      toast(ok ? '已匯入' : '呢個檔案唔係交易紀錄備份。');
      if (ok) go('dash');
    } catch { toast('讀唔到呢個檔案。'); }
  }
});

/* ---------- 3D chart rotation ---------- */

function setRot(deg, smooth = false) {
  ui.rot = deg;
  const el = $('#rot3d');
  if (!el) return;
  el.style.transition = smooth ? 'transform .35s ease' : 'none';
  el.style.transform = `rotateZ(${deg}deg)`;
}
let drag = null;
main.addEventListener('pointerdown', (e) => {
  const scene = e.target.closest('#scene3d');
  if (!scene) return;
  drag = { x: e.clientX, rot: ui.rot };
  scene.setPointerCapture(e.pointerId);
});
main.addEventListener('pointermove', (e) => { if (drag) setRot(drag.rot - (e.clientX - drag.x) * 0.6); });
const endDrag = () => { drag = null; };
main.addEventListener('pointerup', endDrag);
main.addEventListener('pointercancel', endDrag);

/* ---------- iOS keyboard ---------- */

// When the iOS keyboard closes it can leave the page scrolled, which pushes the tab bar out of place.
// The page itself is never meant to scroll, so snap it back.
function resetPageScroll() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}
document.addEventListener('focusout', () => setTimeout(resetPageScroll, 60));
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resetPageScroll, 60));

/* ---------- Boot ---------- */

window.addEventListener('hashchange', () => {
  const tab = location.hash.replace('#/', '');
  if (tab !== ui.tab) go(tab);
});
go(location.hash.replace('#/', '') || 'dash');
if (ui.tab === 'dash') countUp();
setInterval(() => pollQuotes('tick'), 30000);
pollQuotes('open');
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollQuotes('open'); });
startSync();
