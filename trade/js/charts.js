// Chart builders. Each returns an HTML string; all numbers come from calc.js.
import { fmtR, rColor } from './calc.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const signColor = (v) => (v > 0.005 ? 'var(--green)' : v < -0.005 ? 'var(--red)' : 'var(--muted)');
const WEEKDAYS = ['一', '二', '三', '四', '五'];

function curveGeometry(vals, W, H) {
  const mn = Math.min(...vals), mx = Math.max(...vals), pad = 10;
  const yOf = (v) => pad + (1 - (v - mn) / (mx - mn || 1)) * (H - pad * 2);
  const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * (W - 20) + 10, yOf(v)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return { line, area: `${line} L${last[0].toFixed(1)} ${H} L10 ${H} Z`, zeroY: yOf(0).toFixed(1), last };
}

export function equityCurve(cum, { height = 130, color = 'var(--blue)', label = '累積 R 資金曲線', empty = '平倉咗第一單之後，呢度就會有資金曲線。' } = {}) {
  if (cum.length < 2) return emptyChart(empty);
  const W = 324, g = curveGeometry(cum, W, height);
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}">
    <line x1="0" y1="${g.zeroY}" x2="${W}" y2="${g.zeroY}" stroke="var(--line-strong)" stroke-dasharray="3 4"/>
    <path class="a-fade" d="${g.area}" fill="${color}" fill-opacity="0.14"/>
    <path class="a-draw" pathLength="1" d="${g.line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle class="a-fade" cx="${g.last[0].toFixed(1)}" cy="${g.last[1].toFixed(1)}" r="9" fill="${color}" fill-opacity="0.22"/>
    <circle class="a-fade" cx="${g.last[0].toFixed(1)}" cy="${g.last[1].toFixed(1)}" r="4" fill="${color}"/>
  </svg>`;
}

export function drawdownChart(dd, maxDd) {
  if (dd.length < 2) return '';
  const W = 324, H = 44;
  const pts = dd.map((v, i) => `L${((i / (dd.length - 1)) * (W - 20) + 10).toFixed(1)} ${(1 + (maxDd < 0 ? v / maxDd : 0) * (H - 6)).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="回撤圖，由高位跌咗幾多 R">
    <line x1="0" y1="1" x2="${W}" y2="1" stroke="var(--line-strong)"/>
    <path class="a-fade" d="M10 1 ${pts} L${W - 10} 1 Z" fill="var(--red)" fill-opacity="0.35" stroke="var(--red)" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

export function donut(winRate) {
  const C = 2 * Math.PI * 42;
  return `<div class="donut">
    <svg viewBox="0 0 108 108" role="img" aria-label="勝率 ${Math.round(winRate * 100)}%">
      <circle cx="54" cy="54" r="42" fill="none" stroke="var(--red)" stroke-opacity="0.45" stroke-width="12"/>
      <circle class="a-fade" cx="54" cy="54" r="42" fill="none" stroke="var(--green)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${(winRate * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 54 54)"/>
    </svg>
    <div class="donut-label"><b>${Math.round(winRate * 100)}%</b><span>勝率</span></div>
  </div>`;
}

// Shared vertical scale for win/loss columns so a 1R win and a 1R loss are the same length.
function barScale(values, budget = 90) {
  const maxPos = Math.max(0, ...values), maxNeg = Math.max(0, ...values.map((v) => -v));
  const px = budget / (maxPos + maxNeg || 1);
  return { up: Math.max(2, maxPos * px), down: maxNeg * px, px };
}
const column = (v, sc, delay = 0) => `<div class="tb-up" style="height:${sc.up.toFixed(1)}px"><i class="a-grow-y" style="height:${(Math.max(0, v) * sc.px).toFixed(1)}px;animation-delay:${delay}ms"></i></div>
      <div class="tb-base"></div>
      <div class="tb-down" style="height:${sc.down.toFixed(1)}px"><i class="a-grow-yd" style="height:${(Math.max(0, -v) * sc.px).toFixed(1)}px;animation-delay:${delay}ms"></i></div>`;

// One column per trade: wins rise above the baseline, losses hang below it.
export function tradeBars(rs) {
  if (!rs.length) return emptyChart('未有已平倉嘅交易。');
  const shown = rs.slice(-40), sc = barScale(shown);
  const cols = shown.map((r, i) => `<div class="tb-col">${column(r, sc, i * 20)}</div>`).join('');
  return `<div class="trade-bars" style="grid-template-columns:repeat(${shown.length},minmax(0,1fr))" role="img" aria-label="每單交易嘅 R 值柱狀圖">${cols}</div>`;
}

export function hBars(groups, { color } = {}) {
  if (!groups.length) return emptyChart('未有數據。');
  const max = Math.max(...groups.map((g) => Math.abs(g.total)), 0.01);
  return groups.map((g) => `<div class="hbar">
      <div class="hbar-head"><span>${esc(g.key)} <em>· ${g.count} 單</em></span><b style="color:${signColor(g.total)}">${fmtR(g.total, 1)}</b></div>
      <div class="hbar-track"><i class="a-grow-x" style="width:${Math.max(2, (Math.abs(g.total) / max) * 100).toFixed(0)}%;background:${color || signColor(g.total)}"></i></div>
    </div>`).join('');
}

// Month grid, Monday to Friday only.
export function calendar(year, month, totalsByDate) {
  const cells = [];
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  // A month starting on a weekend begins on the following Monday, so it needs no leading blanks.
  for (let i = 0; i < (lead >= 5 ? 0 : lead); i++) cells.push('<div class="cal-cell blank"></div>');
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const wd = new Date(year, month, d).getDay();
    if (wd === 0 || wd === 6) continue;
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const v = totalsByDate.get(key);
    if (v == null) { cells.push(`<div class="cal-cell"><span>${d}</span><b>·</b></div>`); continue; }
    const c = rColor(v);
    cells.push(`<div class="cal-cell" style="background:${c.bg}"><span>${d}</span><b style="color:${c.fg}">${fmtR(v, 1).replace('R', '')}</b></div>`);
  }
  return `<div class="cal-head">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>`;
}

// CSS 3D bar grid: setups down, confidence 1-5 across. Rotated by dragging (see app.js).
export function chart3d(grid, rot) {
  const rows = grid.length;
  if (!rows) return emptyChart('未有數據。');
  const CW = 44, CD = 45, B = 26, W = CW * 5, D = CD * rows;
  const max = Math.max(...grid.flatMap((g) => g.row.map(Math.abs)), 0.01);
  let best = null;
  const bars = grid.flatMap((g, si) => g.row.map((v, wi) => {
    if (!best || v > best.v) best = { v, setup: g.setup, wi };
    const pos = v > 0.005, neg = v < -0.005;
    const h = pos || neg ? Math.max(6, (Math.abs(v) / max) * 96) : 2;
    const top = pos ? '#5FE0A8' : neg ? '#F57A84' : '#3A4552';
    const a = pos ? '#2FA676' : neg ? '#C24A55' : '#2A323D';
    const b = pos ? '#24825C' : neg ? '#9A3A44' : '#232A34';
    const x = wi * CW + (CW - B) / 2, y = si * CD + (CD - B) / 2;
    return `<div class="b3 a-rise3d" style="left:${x}px;top:${y}px;animation-delay:${300 + (si * 5 + wi) * 35}ms">
      <i style="width:${B}px;height:${h}px;top:0;transform-origin:top;transform:rotateX(90deg);background:${a}"></i>
      <i style="width:${B}px;height:${h}px;top:${B}px;transform-origin:top;transform:rotateX(90deg);background:${a}"></i>
      <i style="width:${h}px;height:${B}px;left:0;transform-origin:left;transform:rotateY(-90deg);background:${b}"></i>
      <i style="width:${h}px;height:${B}px;left:${B}px;transform-origin:left;transform:rotateY(-90deg);background:${b}"></i>
      <i style="width:${B}px;height:${B}px;transform:translateZ(${h}px);background:${top}"></i>
    </div>`;
  })).join('');
  const bestLabel = best && best.v > 0.005 ? `最賺：${esc(best.setup)} × 信心 ${best.wi + 1} ${fmtR(best.v, 1)}` : '未有賺錢嘅組合';
  return `<div class="scene3d" id="scene3d" role="img" aria-label="${bestLabel}">
    <div class="tilt3d"><div class="a-spin3d p3d"><div class="p3d" id="rot3d" style="transform:rotateZ(${rot}deg)">
      <div class="floor3d" style="left:${-W / 2}px;top:${-D / 2}px;width:${W}px;height:${D}px;background-size:${CW}px ${CD}px">
        ${bars}
        <div class="ax3-x" style="top:${D + 6}px;width:${W}px">${[1, 2, 3, 4, 5].map((n) => `<span>${n}</span>`).join('')}</div>
        <div class="ax3-t" style="top:${D + 24}px;width:${W}px">信心</div>
        <div class="ax3-y" style="height:${D}px;grid-template-rows:repeat(${rows},minmax(0,1fr))">${grid.map((g) => `<span>${esc(g.setup)}</span>`).join('')}</div>
      </div>
    </div></div></div>
  </div>
  <div class="legend3d"><span>${bestLabel}</span><span><i style="background:var(--green)"></i>賺 <i style="background:var(--red)"></i>蝕</span></div>`;
}

export const emptyChart = (text) => `<div class="empty">${esc(text)}</div>`;
