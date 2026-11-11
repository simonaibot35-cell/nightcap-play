// Screen templates. Each returns an HTML string built from the current state + UI state.
import * as C from './calc.js';
import * as G from './charts.js';
import { today } from './store.js';
import { marketOpen } from './quotes.js';

const { esc } = G;
const price = (n) => `$${Number(n).toFixed(2)}`;
// Local-date string n days back, comparable with stored YYYY-MM-DD dates.
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const num = (v) => (v == null || v === '' ? '' : String(v));

export function moneyFmt(state) {
  return (n, signed = false) => {
    if (state.settings.hideMoney) return '$••••';
    const abs = `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
    return signed ? `${n >= 0 ? '+' : '−'}${abs}` : n < 0 ? `−${abs}` : abs;
  };
}

const chip = (label, on, attrs, extra = '') =>
  `<button type="button" class="chip${on ? ' on' : ''}${extra}" aria-pressed="${on}" ${attrs}>${esc(label)}</button>`;

const tile = (label, value, color = '') =>
  `<div class="tile"><span>${label}</span><b${color ? ` style="color:${color}"` : ''}>${value}</b></div>`;

/* ---------- Dashboard ---------- */

export function dashboard(state, ui) {
  const money = moneyFmt(state);
  if (!state.settings.startCapital && !state.trades.length) return onboarding();

  const cap = C.capital(state), rU = C.rUnit(state), heat = C.heatR(state);
  const heatCap = state.settings.heatCapR, heatPct = heatCap > 0 ? heat / heatCap : 0;
  const heatColor = heatPct >= 1 ? 'var(--red)' : heatPct >= 0.8 ? 'var(--amber)' : 'var(--blue)';
  const leftR = Math.max(0, heatCap - heat), mult = state.settings.defaultRiskMult;
  const closed = C.closedTrades(state);
  const from = state.settings.statsFrom || '';
  const since = C.stats(closed.filter((t) => C.closeDate(t) >= from));
  const netRisk = C.openRiskTotal(state);
  const CURVE = { week: ['週', '本週'], month: ['月', '本月'], year: ['年', '今年'] };
  const cr = CURVE[ui.curveRange] ? ui.curveRange : 'month';
  const curveFrom = C.periodStart(cr);
  const curve = C.stats(closed.filter((t) => C.closeDate(t) >= curveFrom));
  const open = C.openTrades(state);
  const live = !!state.settings.finnhubKey;

  return `<div class="cards">
    <section class="card a-rise">
      <div class="row between end">
        <div class="stack"><span class="label">本金（當前淨值）</span><b class="big" data-count="${cap}" data-money="1">${money(cap)}</b></div>
        <div class="stack right"><span class="label">1R = ${state.settings.riskPct}%</span><b class="mid">${money(rU)}</b></div>
      </div>
      <hr>
      <div class="row between base"><b class="h3">Open heat</b><span class="sub"><b style="color:${heatColor}">${heat.toFixed(2)}R</b> / ${heatCap}R 上限</span></div>
      <div class="track"><i class="a-grow-x" style="width:${Math.min(100, heatPct * 100).toFixed(1)}%;background:${heatColor}"></i></div>
      <span class="hint">仲可以再開 ${Math.floor(leftR / mult + 1e-9)} 單 ${mult}R · 可用現金 ${money(C.cash(state))}</span>
    </section>

    <section class="tiles a-rise" style="animation-delay:80ms">
      ${tile('Open risk', open.length ? C.fmtR(netRisk) : '—', open.length ? C.rColor(netRisk).fg : '')}
      ${tile('勝率', since.n ? `${Math.round(since.winRate * 100)}%` : '—')}
      ${tile('每單期望', since.n ? C.fmtR(since.expectancy) : '—')}
    </section>
    <span class="hint span2 tiles-note">Open risk = 全部持倉而家打中止蝕會賺蝕幾多 R · 勝率同期望${from ? `由 ${from} 開始計` : '計晒全部交易'}（${since.n} 單）</span>

    <section class="card a-rise span2" style="animation-delay:160ms">
      <div class="row between mid-align">
        <div class="stack"><b class="h3">資金曲線（累積 R）</b><span class="hint">只計已平倉 · ${curve.n} 單 · 總 <b style="color:${C.rColor(curve.total).fg}">${C.fmtR(curve.total, 1)}</b></span></div>
        <div class="row gap6">${Object.entries(CURVE).map(([k, [l]]) => chip(l, cr === k, `data-act="curve" data-v="${k}" aria-label="${CURVE[k][1]}"`, ' sm')).join('')}</div>
      </div>
      ${G.equityCurve(curve.cum, { empty: `${CURVE[cr][1]}未有平倉嘅交易。` })}
      ${curve.n ? `<div class="row between hint"><span>${curveFrom}</span><span>${today()}</span></div>` : ''}
    </section>

    <div class="row between base span2 section-head">
      <h2>未平倉（${open.length}）</h2>
      <button type="button" class="link" data-act="refresh-quotes"><i class="dot${live ? ' live' : ''}"></i>${live ? esc(ui.quoteNote || (marketOpen() ? '即時 · 每 30 秒' : '已收市 · 打開時更新')) : '未設定即時報價'}</button>
    </div>
    <div class="scale span2"><i></i><div><span>−1R 會蝕</span><span>0R 打和</span><span>+1R 鎖利</span></div></div>
    ${open.length ? open.map((t, i) => positionCard(t, rU, money, i)).join('') : `<div class="empty span2">未有持倉。去「新交易」計好倉位再記錄。</div>`}
  </div>`;
}

function onboarding() {
  return `<div class="cards"><section class="card a-rise span2">
    <h2>開始之前</h2>
    <p class="body">入你而家戶口嘅本金（USD）。之後 1R 同倉位大細都會跟住呢個數計，每次平倉會自動更新。</p>
    <label class="field">起始本金<input id="ob-capital" type="number" inputmode="decimal" placeholder="例如 50000"></label>
    <button type="button" class="primary" data-act="set-capital">開始用</button>
    <button type="button" class="ghost" data-act="load-demo">先用示範數據睇吓</button>
  </section></div>`;
}

function positionCard(t, rU, money, i) {
  const init = C.initRiskR(t, rU), risk = C.openRiskR(t, rU), fl = C.floatR(t, rU), pnl = C.floatPnl(t);
  const ratio = C.stopRatio(t), pct = C.pricePct(t);
  const ic = C.rColor(init), rc = C.rColor(risk), fc = C.rColor(fl || 0), qc = C.rColor(ratio || 0);
  const sign = (v) => (v > 0.005 ? '+' : v < -0.005 ? '−' : '');
  const ratioText = ratio == null ? '—' : `1 : ${sign(ratio)}${Math.abs(ratio).toFixed(1)}`;
  const pctText = pct == null ? '' : ` · ${sign(pct)}${Math.abs(pct).toFixed(1)}%`;
  return `<button type="button" class="card pos a-rise" style="animation-delay:${240 + i * 70}ms" data-act="open-trade" data-id="${esc(t.id)}">
    <div class="row between">
      <div class="stack">
        <div class="row gap8 mid-align"><span class="num-badge" aria-label="第 ${i + 1} 隻">${i + 1}</span><b class="sym">${esc(t.sym)}</b><span class="tag">${esc(t.setup || '')}</span>${t.side === 'short' ? '<span class="tag red">做淡</span>' : ''}</div>
        <span class="hint">${C.openShares(t)} 股 · 入 ${price(t.entry)} · 止蝕 ${price(t.stop)}</span>
      </div>
      <div class="stack right">
        <b class="sym">${t.lastPrice != null ? price(t.lastPrice) : '—'}</b>
        <span class="hint" style="color:${pnl != null ? fc.fg : 'var(--muted)'}">${pnl != null ? `${money(pnl, true)}${pctText}` : '未有價錢'}</span>
      </div>
    </div>
    <div class="three">
      <div class="badge" style="background:${ic.bg}"><span>原始止蝕</span><b style="color:${ic.fg}">${C.fmtR(init)}</b></div>
      <div class="badge" style="background:${rc.bg}"><span>而家止蝕</span><b style="color:${rc.fg}">${C.fmtR(risk)}</b></div>
      <div class="badge" style="background:${ratio != null ? qc.bg : 'var(--inset)'}"><span>比例</span><b style="color:${ratio != null ? qc.fg : 'var(--muted)'}">${ratioText}</b></div>
    </div>
  </button>`;
}

/* ---------- New trade / position calculator ---------- */

export function sizing(state, form) {
  const heatLeftR = Math.max(0, state.settings.heatCapR - C.heatR(state));
  return C.sizePosition({
    entry: parseFloat(form.entry), stop: parseFloat(form.stop), target: parseFloat(form.target), side: form.side,
    riskMult: form.riskMult, rU: C.rUnit(state), heatLeftR, cashAvail: C.cash(state), cap: C.capital(state),
  });
}

export function calculator(state, ui) {
  const f = ui.form, s = state.settings;
  const risks = [...new Set([0.25, 0.5, 1, s.defaultRiskMult])].sort((a, b) => a - b);
  return `<div class="cards">
    <div class="seg span2">
      <button type="button" class="${f.side === 'long' ? 'on long' : ''}" data-act="side" data-v="long" aria-pressed="${f.side === 'long'}">做好 Long</button>
      <button type="button" class="${f.side === 'short' ? 'on short' : ''}" data-act="side" data-v="short" aria-pressed="${f.side === 'short'}">做淡 Short</button>
    </div>

    <section class="card">
      <label class="field">股票代號<input id="f-sym" data-f="sym" type="text" autocapitalize="characters" autocomplete="off" placeholder="例如 NVDA" value="${esc(f.sym)}"></label>
      <div class="three">
        <label class="field">入市價<input data-f="entry" type="number" inputmode="decimal" step="any" value="${esc(num(f.entry))}"></label>
        <label class="field">止蝕價<input class="stop" data-f="stop" type="number" inputmode="decimal" step="any" value="${esc(num(f.stop))}"></label>
        <label class="field">目標價<input class="target" data-f="target" type="number" inputmode="decimal" step="any" value="${esc(num(f.target))}"></label>
      </div>
      <span class="label">今單冒幾多風險</span>
      <div class="three">${risks.map((m) => chip(`${m}R${m === s.defaultRiskMult ? ' 預設' : ''}`, f.riskMult === m, `data-act="risk" data-v="${m}"`, ' block')).join('')}</div>
    </section>

    <section class="card">
      <h2>點解入呢單</h2>
      <span class="label">策略 Setup</span>
      <div class="row wrap gap8">${s.setups.map((t) => chip(t, f.setup === t, `data-act="setup" data-v="${esc(t)}"`)).join('')}</div>
      <span class="label">入市條件（撳嚟剔）</span>
      <div class="two">${s.checks.map((c) => `<button type="button" class="check${f.checks.includes(c) ? ' on' : ''}" aria-pressed="${f.checks.includes(c)}" data-act="check" data-v="${esc(c)}"><i></i>${esc(c)}</button>`).join('')}</div>
      <label class="field">入市理由<textarea data-f="reason" rows="3" placeholder="例如：日線突破 $180 阻力，成交量係 20 日平均 2 倍">${esc(f.reason)}</textarea></label>
      <span class="label">信心</span>
      <div class="five">${[1, 2, 3, 4, 5].map((n) => chip(String(n), f.conf === n, `data-act="conf" data-v="${n}" aria-label="信心 ${n} 分"`, ' block')).join('')}</div>
    </section>

    <section class="card result span2" id="calc-result">${calcResult(state, f)}</section>
    <button type="button" class="primary span2" data-act="save-trade">記錄呢單交易</button>
  </div>`;
}

const WARN = {
  lowRR: ['warn', () => 'R:R 低過 2:1，諗清楚值唔值得入。'],
  targetSide: ['warn', (r, f) => (f.side === 'short' ? '做淡嘅話，目標價要低過入市價。' : '做好嘅話，目標價要高過入市價。')],
  heat: ['bad', (r, f, ctx) => `Open heat 得返 ${ctx.leftR.toFixed(2)}R 位，已經自動減細到 ${r.shares} 股。`],
  zero: ['bad', () => '計出嚟係 0 股：風險預算唔夠買一股，或者 open heat 已經爆滿。'],
  cash: ['bad', (r, f, ctx) => `需要 ${ctx.money(r.cost)}，但可用現金得 ${ctx.money(ctx.cash)}。`],
  concentration: ['warn', (r) => `呢單佔本金 ${(r.costPct * 100).toFixed(0)}%，止蝕好窄，小心集中風險。`],
};

export function calcResult(state, f) {
  const money = moneyFmt(state), rU = C.rUnit(state), heat = C.heatR(state);
  const r = sizing(state, f);
  const msgs = [];
  if (!r.ok) {
    msgs.push(r.error === 'missing' ? ['warn', '入咗入市價同止蝕價就會計到。']
      : r.error === 'noCapital' ? ['bad', '未設定本金，去「設定」入咗先。']
      : ['bad', f.side === 'short' ? '做淡嘅話，止蝕價要高過入市價。' : '做好嘅話，止蝕價要低過入市價。']);
  } else {
    const ctx = { money, cash: C.cash(state), leftR: Math.max(0, state.settings.heatCapR - heat) };
    for (const w of r.warnings) msgs.push([WARN[w][0], WARN[w][1](r, f, ctx)]);
    if (!msgs.length) msgs.push(['ok', '全部檢查通過，可以入單。']);
  }
  const shares = r.ok ? (f.shares !== '' && f.shares != null ? Number(f.shares) : r.shares) : null;
  const riskAmt = r.ok ? shares * r.per : 0;
  return `<div class="row between end">
      <div class="stack"><span class="label">建議買入</span><b class="huge">${r.ok ? `${r.shares} 股` : '—'}</b></div>
      <div class="stack right"><span class="label">R : R</span><b class="rr">${r.ok && r.rr ? `${r.rr.toFixed(1)} : 1` : '—'}</b></div>
    </div>
    <div class="two">
      <div class="cell"><span>風險金額</span><b>${r.ok ? `${money(riskAmt)} · ${(riskAmt / rU).toFixed(2)}R` : '—'}</b></div>
      <div class="cell"><span>每股風險</span><b>${r.ok ? price(r.per) : '—'}</b></div>
      <div class="cell"><span>需要資金</span><b>${r.ok ? `${money(shares * parseFloat(f.entry))} · ${((shares * parseFloat(f.entry)) / C.capital(state) * 100).toFixed(0)}%` : '—'}</b></div>
      <div class="cell"><span>開單後 open heat</span><b>${r.ok ? `${(heat + riskAmt / rU).toFixed(2)}R / ${state.settings.heatCapR}R` : '—'}</b></div>
    </div>
    <label class="field">實際買入股數（唔填就用建議股數）<input data-f="shares" type="number" inputmode="numeric" step="1" min="1" placeholder="${r.ok ? r.shares : ''}" value="${esc(num(f.shares))}"></label>
    ${msgs.map(([tone, text]) => `<div class="note ${tone}">${esc(text)}</div>`).join('')}`;
}

/* ---------- Trade log ---------- */

export function log(state) {
  const closed = C.closedTrades(state), st = C.stats(closed);
  if (!closed.length) return `<div class="cards"><div class="empty span2">未有已平倉嘅交易。喺總覽撳一個持倉就可以平倉。</div></div>`;
  return `<div class="cards">
    <section class="tiles two-up span2">
      ${tile('平均贏', C.fmtR(st.avgWin), 'var(--green)')}
      ${tile('平均輸', C.fmtR(st.avgLoss), 'var(--red)')}
    </section>
    ${closed.slice().reverse().map((t) => {
      const r = C.tradeR(t), c = C.rColor(r);
      const note = (t.mistakes || []).length ? t.mistakes.join('、') : '跟足計劃';
      return `<button type="button" class="card logrow" data-act="open-trade" data-id="${esc(t.id)}">
        <div class="stack"><div class="row gap8 mid-align"><b>${esc(t.sym)}</b><span class="tag">${esc(t.setup || '')}</span></div>
          <span class="hint${(t.mistakes || []).length ? ' amber' : ''}">${esc(C.closeDate(t))} · ${esc(note)}</span></div>
        <b class="rbadge" style="background:${c.bg};color:${c.fg}">${C.fmtR(r)}</b>
      </button>`;
    }).join('')}
  </div>`;
}

/* ---------- Analysis ---------- */

export function analysis(state, ui) {
  let closed = C.closedTrades(state);
  if (ui.range === 'month') closed = closed.filter((t) => C.closeDate(t).startsWith(today().slice(0, 7)));
  if (ui.range === '90') closed = closed.filter((t) => C.closeDate(t) >= daysAgo(90));
  const st = C.stats(closed);
  const ranges = [['month', '本月'], ['90', '90 日'], ['all', '全部']];
  const head = `<div class="row gap8 span2">${ranges.map(([k, l]) => chip(l, ui.range === k, `data-act="range" data-v="${k}"`)).join('')}</div>`;
  if (!closed.length) return `<div class="cards">${head}<div class="empty span2">呢段時間未有已平倉嘅交易。</div></div>`;

  const setups = [...new Set(closed.map((t) => t.setup || '未分類'))];
  const dates = new Map(C.byDate(closed).map((g) => [g.key, g.total]));
  const allDates = new Map(C.byDate(C.closedTrades(state)).map((g) => [g.key, g.total]));
  const mistakes = C.byMistake(closed).sort((a, b) => a.total - b.total);
  const lastDate = C.closeDate(C.closedTrades(state).slice(-1)[0] || {}) || today();
  const { y, m } = ui.cal || { y: Number(lastDate.slice(0, 4)), m: Number(lastDate.slice(5, 7)) - 1 };

  return `<div class="cards">${head}
    <section class="card a-rise span2">
      <div class="row between mid-align">
        <div class="stack"><h2>策略 × 信心</h2><span class="hint">信心 1 至 5 分 · 柱越高，嗰個組合賺蝕越多 R · 左右掃可以轉</span></div>
        <div class="row gap6"><button type="button" class="round" data-act="rot" data-v="30" aria-label="向左轉">‹</button><button type="button" class="round" data-act="rot" data-v="-30" aria-label="向右轉">›</button></div>
      </div>
      ${G.chart3d(C.setupConfGrid(closed, setups), ui.rot)}
    </section>

    <section class="card a-rise" style="animation-delay:80ms">
      <div class="row between base"><h2>資金曲線同回撤</h2><span class="hint">最大回撤 <b style="color:var(--red)">${C.fmtR(st.maxDd, 1)}</b></span></div>
      ${G.equityCurve(st.cum, { height: 110, color: 'var(--green)' })}
      ${G.drawdownChart(st.dd, st.maxDd)}
      <span class="hint center">上面：累積 R · 下面：由高位跌幾多</span>
    </section>

    <section class="card a-rise donut-card" style="animation-delay:140ms">
      ${G.donut(st.winRate)}
      <div class="kv">
        <div><span>贏 / 輸</span><b>${st.wins} / ${st.losses}</b></div>
        <div><span>平均贏</span><b style="color:var(--green)">${C.fmtR(st.avgWin)}</b></div>
        <div><span>平均輸</span><b style="color:var(--red)">${C.fmtR(st.avgLoss)}</b></div>
        <div><span>每單期望</span><b>${C.fmtR(st.expectancy)}</b></div>
        <div><span>贏輸比</span><b>${st.payoff != null ? `${st.payoff.toFixed(1)}×` : '—'}</b></div>
      </div>
    </section>

    <section class="card a-rise" style="animation-delay:200ms">
      <div class="row between base"><h2>每單 R 值</h2><span class="hint">贏大輸細先係好形狀</span></div>
      ${G.tradeBars(st.rs)}
    </section>

    <section class="card a-rise" style="animation-delay:260ms">
      <div class="row between mid-align"><h2>月曆</h2>
        <div class="row gap6 mid-align"><button type="button" class="round sm" data-act="cal" data-v="-1" data-y="${y}" data-m="${m}" aria-label="上個月">‹</button><span class="sub">${y} 年 ${m + 1} 月</span><button type="button" class="round sm" data-act="cal" data-v="1" data-y="${y}" data-m="${m}" aria-label="下個月">›</button></div>
      </div>
      ${G.calendar(y, m, allDates)}
    </section>

    <section class="card a-rise" style="animation-delay:320ms"><h2>按策略分</h2>${G.hBars(C.bySetup(closed).sort((a, b) => b.total - a.total))}</section>
    <section class="card a-rise" style="animation-delay:440ms">
      <div class="row between base"><h2>犯錯成本</h2><span class="hint">每個壞習慣令你蝕幾多</span></div>
      ${mistakes.length ? G.hBars(mistakes, { color: 'var(--amber)' }) : G.emptyChart('呢段時間冇標記犯錯，好嘢。')}
    </section>
  </div>`;
}

/* ---------- Settings ---------- */

export function settings(state, ui) {
  const s = state.settings, money = moneyFmt(state), cfg = ui.syncCfg || {}, ss = ui.syncStatus || {};
  const syncText = { idle: '未連接', signedOut: '未登入', syncing: '同步緊…', synced: `已同步${ss.user ? `（${ss.user}）` : ''}`, confirm: '已註冊，請去 email 撳確認連結，之後返嚟登入', error: `出錯：${ss.error || ''}` }[ss.state || 'idle'];
  return `<div class="cards">
    <section class="card">
      <h2>本金同風險</h2>
      <div class="row between base"><span class="label">當前本金</span><b>${money(C.capital(state))}</b></div>
      <label class="field">起始本金（USD）<input data-s="startCapital" type="number" inputmode="decimal" value="${esc(num(s.startCapital || ''))}"></label>
      <div class="two">
        <label class="field">每單預設風險（R）<input data-s="defaultRiskMult" type="number" inputmode="decimal" step="0.05" min="0.05" value="${s.defaultRiskMult}"></label>
        <label class="field">Open heat 上限（R）<input data-s="heatCapR" type="number" inputmode="decimal" step="0.5" min="0.5" value="${s.heatCapR}"></label>
      </div>
      <span class="hint">1R = 當前本金嘅 ${s.riskPct}%。本金 = 起始本金 + 入金出金 + 已平倉盈虧。</span>
      <label class="field">總覽嘅勝率同期望由幾時開始計<input data-s="statsFrom" type="date" value="${esc(s.statsFrom || '')}"></label>
      <span class="hint">清空日期就計晒全部交易。</span>
    </section>

    <section class="card">
      <h2>入金 / 出金</h2>
      <div class="two">
        <label class="field">金額（出金用負數）<input id="cf-amount" type="number" inputmode="decimal" placeholder="例如 5000 或 -2000"></label>
        <label class="field">日期<input id="cf-date" type="date" value="${today()}"></label>
      </div>
      <button type="button" class="ghost" data-act="add-cashflow">加入</button>
      ${state.cashflows.map((c) => `<div class="row between mid-align listrow"><span>${esc(c.date)}</span><b style="color:${c.amount >= 0 ? 'var(--green)' : 'var(--red)'}">${money(c.amount, true)}</b><button type="button" class="link" data-act="del-cashflow" data-id="${esc(c.id)}">刪除</button></div>`).join('')}
    </section>

    <section class="card">
      <h2>即時報價（Finnhub）</h2>
      <p class="body">去 finnhub.io 免費註冊，將 API key 貼喺度。持倉會每 30 秒更新一次現價。</p>
      <label class="field">API key<input data-s="finnhubKey" type="password" autocomplete="off" value="${esc(s.finnhubKey)}"></label>
      <button type="button" class="ghost" data-act="refresh-quotes">即刻更新一次</button>
      ${ui.quoteNote ? `<span class="hint">${esc(ui.quoteNote)}</span>` : ''}
    </section>

    <section class="card">
      <h2>雲端同步（手機同電腦共用）</h2>
      <p class="body">用 Supabase 免費帳戶同步。設定方法睇 README。唔設定嘅話，資料只會存喺呢部機嘅瀏覽器。</p>
      <label class="field">Project URL<input id="sy-url" type="url" placeholder="https://xxxx.supabase.co" value="${esc(cfg.url || '')}"></label>
      <label class="field">Anon key<input id="sy-key" type="password" autocomplete="off" value="${esc(cfg.anonKey || '')}"></label>
      <div class="two">
        <label class="field">Email<input id="sy-email" type="email" autocomplete="username" value="${esc(cfg.email || '')}"></label>
        <label class="field">密碼<input id="sy-pass" type="password" autocomplete="current-password"></label>
      </div>
      <div class="three"><button type="button" class="ghost" data-act="sync-signin">登入</button><button type="button" class="ghost" data-act="sync-signup">註冊</button><button type="button" class="ghost" data-act="sync-signout">登出</button></div>
      <span class="hint">狀態：${esc(syncText)}</span>
    </section>

    <section class="card">
      <h2>備份</h2>
      <div class="two"><button type="button" class="ghost" data-act="export">匯出 JSON</button><button type="button" class="ghost" data-act="import">匯入 JSON</button></div>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
      <div class="two"><button type="button" class="ghost" data-act="load-demo">載入示範數據</button><button type="button" class="ghost danger" data-act="wipe">清除全部資料</button></div>
    </section>
  </div>`;
}

/* ---------- Trade detail sheet ---------- */

export function tradeSheet(state, t) {
  const money = moneyFmt(state), rU = C.rUnit(state), open = C.openShares(t), closed = C.isClosed(t);
  const mistakes = state.settings.mistakes.map((m) => chip(m, (t.mistakes || []).includes(m), `data-act="mistake" data-v="${esc(m)}"`)).join('');
  const head = `<div class="row between mid-align">
      <div class="row gap8 mid-align"><h2>${esc(t.sym)}</h2><span class="tag">${esc(t.setup || '')}</span><span class="tag">${t.side === 'short' ? '做淡' : '做好'}</span></div>
      <button type="button" class="round" data-act="close-sheet" aria-label="關閉">×</button>
    </div>
    <span class="hint">${esc(t.entryDate)} 入市 · ${t.shares} 股 @ ${price(t.entry)} · 原本止蝕 ${price(t.initStop)}${t.target ? ` · 目標 ${price(t.target)}` : ''}</span>
    ${t.reason || (t.checks || []).length ? `<div class="reason"><div class="row wrap gap6">${(t.checks || []).map((c) => `<span class="pill">${esc(c)}</span>`).join('')}<span class="pill grey">信心 ${t.conf || '—'}/5</span></div>${t.reason ? `<p>${esc(t.reason)}</p>` : ''}</div>` : ''}`;
  const exits = (t.exits || []).length ? `<span class="label">平倉紀錄</span>${t.exits.map((e) => `<div class="row between listrow"><span>${esc(e.date)}</span><span>${e.shares} 股 @ ${price(e.price)}</span></div>`).join('')}` : '';
  const tail = `<span class="label">犯錯標籤</span><div class="row wrap gap8">${mistakes}</div>
    <label class="field">備註<textarea id="ts-notes" rows="2" placeholder="做得好同做得唔好嘅地方">${esc(t.notes || '')}</textarea></label>
    <div class="two"><button type="button" class="ghost" data-act="save-notes">儲存備註</button><button type="button" class="ghost danger" data-act="delete-trade">刪除呢單</button></div>`;

  if (closed) {
    const r = C.tradeR(t), c = C.rColor(r);
    return `${head}
      <div class="two"><div class="badge" style="background:${c.bg}"><span>結果</span><b style="color:${c.fg}">${C.fmtR(r)}</b></div>
      <div class="badge" style="background:var(--inset)"><span>盈虧</span><b>${money(C.realizedPnl(t), true)}</b></div></div>
      ${exits}${tail}`;
  }
  const risk = C.openRiskR(t, rU), fl = C.floatR(t, rU), rc = C.rColor(risk), fc = C.rColor(fl || 0);
  return `${head}
    <div class="two"><div class="badge" style="background:${rc.bg}"><span>Open risk</span><b style="color:${rc.fg}">${C.fmtR(risk)}</b></div>
    <div class="badge" style="background:${fl != null ? fc.bg : 'var(--inset)'}"><span>浮動 R</span><b style="color:${fl != null ? fc.fg : 'var(--muted)'}">${fl != null ? C.fmtR(fl) : '—'}</b></div></div>
    <div class="two">
      <label class="field">止蝕價<input id="ts-stop" type="number" inputmode="decimal" step="any" value="${t.stop}"></label>
      <label class="field">現價<input id="ts-last" type="number" inputmode="decimal" step="any" value="${esc(num(t.lastPrice))}"></label>
    </div>
    <button type="button" class="ghost" data-act="save-levels">更新止蝕同現價</button>
    <hr>
    <h3>平倉</h3>
    <div class="three">
      <label class="field">平倉價<input id="ts-exit" type="number" inputmode="decimal" step="any" value="${esc(num(t.lastPrice))}"></label>
      <label class="field">股數<input id="ts-shares" type="number" inputmode="numeric" step="1" min="1" max="${open}" value="${open}"></label>
      <label class="field">手續費<input id="ts-fees" type="number" inputmode="decimal" step="any" placeholder="0"></label>
    </div>
    <label class="field">日期<input id="ts-date" type="date" value="${today()}"></label>
    <button type="button" class="primary" data-act="exit-trade">確認平倉（仲有 ${open} 股）</button>
    ${exits}<hr>${tail}`;
}
