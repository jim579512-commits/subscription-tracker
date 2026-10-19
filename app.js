(function () {
  'use strict';
  const L = window.SubLogic;
  const KEY = 'subtracker.v1';
  const UNIT = { weekly: '週', monthly: '月', quarterly: '季', yearly: '年' };
  const PLAN_CHIPS = ['Pro', 'Premium', 'Plus', 'Max', 'Family', 'Standard'];
  const REMIND_OPTIONS = [[0, '當天'], [1, '1 天前'], [2, '2 天前'], [3, '3 天前'], [5, '5 天前'], [7, '7 天前'], [14, '14 天前']];
  const RATES_URL = 'https://open.er-api.com/v6/latest/TWD';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const catLabel = (id) => (L.CATEGORIES.find((c) => c.id === id) || { label: '其他' }).label;
  const title = (s) => (s.plan ? `${s.name} ${s.plan}` : s.name);
  const md = (d) => { const p = L.parseDate(d); return `${p.m}/${p.d}`; };
  const rel = (n) => (n <= 0 ? '今天' : n === 1 ? '明天' : `${n} 天後`);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const remindLabel = (n) => (REMIND_OPTIONS.find((o) => o[0] === n) || [0, `${n} 天前`])[1];

  const ICON_BELL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // ---------- 資料 ----------
  function normalize(o) {
    o = o && typeof o === 'object' ? o : {};
    const st = Object.assign(L.defaultSettings(), o.settings || {});
    st.rates = Object.assign({}, L.DEFAULT_RATES, (o.settings && o.settings.rates) || {});
    if (!Number.isFinite(st.remindDays)) st.remindDays = 3;
    return { subs: (Array.isArray(o.subs) ? o.subs : []).filter(L.isValidSub), settings: st };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* 讀不到就用空資料 */ }
    return normalize({});
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('無法儲存，瀏覽器封鎖了儲存空間'); }
  }
  let state = load();
  const ui = { sheet: null, showEnded: false, mode: 'future', sel: { future: 0, past: 11 } };

  // ---------- 畫面 ----------
  const main = $('#main');
  const sheetRoot = $('#sheet-root');

  function render() {
    const today = L.todayLocal();
    const t = L.totals(state.subs, state.settings, today);
    const alerts = L.upcoming(state.subs, state.settings, today);
    const active = state.subs.filter((s) => s.status !== 'ended')
      .sort((a, b) => (L.nextCharge(a, today) < L.nextCharge(b, today) ? -1 : 1));
    const ended = state.subs.filter((s) => s.status === 'ended');

    let html = heroHTML(t) + alertsHTML(alerts);
    if (!state.subs.length) {
      html += '<section class="empty">還沒有訂閱，點右下角的 + 新增第一筆</section>';
    } else {
      html += `<section><h2 class="section-title">訂閱清單</h2><div class="list">${active.map((s) => cardHTML(s, today)).join('')}</div>`;
      if (ended.length) {
        html += `<details class="ended-box"${ui.showEnded ? ' open' : ''}><summary>已取消（${ended.length}）</summary><div class="list">${ended.map((s) => cardHTML(s, today)).join('')}</div></details>`;
      }
      html += '</section>';
      if (t.activeCount || t.trialCount || L.history(state.subs, state.settings, today, 12).some((b) => b.total > 0)) {
        html += catChartHTML(t) + `<section><h2 class="section-title">每月扣款</h2><div class="chart-card" id="fc">${monthChartHTML()}</div></section>`;
      }
    }
    main.innerHTML = html;
  }

  function heroHTML(t) {
    const stat = (label, value) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
    let html = `<section class="hero"><div class="hero-label">每月花費</div><div class="hero-value">${L.fmtBase(t.monthly)}</div><div class="stats">`;
    html += stat('每年', L.fmtBase(t.yearly)) + stat('訂閱', `${t.activeCount} 項`);
    if (t.trialCount) html += stat('試用中', `${t.trialCount} 項`);
    html += '</div>';
    if (t.trialCount && t.trialMonthly > 0) html += `<div class="hero-note">試用轉為付費後，每月增加 ${L.fmtBase(t.trialMonthly)}</div>`;
    if (t.missing.length) html += `<button class="warn-line" data-act="settings">缺少 ${esc(t.missing.join('、'))} 的匯率，這些訂閱還沒計入</button>`;
    return html + '</section>';
  }

  function alertsHTML(list) {
    if (!list.length) return '';
    const rows = list.map((a) => {
      const s = a.sub;
      const price = L.fmtMoney(s.price, s.currency);
      if (a.type === 'trial') {
        return `<div class="alert">${ICON_BELL}<span><b>${esc(title(s))}</b> 試用將在${rel(a.daysLeft)}結束，之後${L.CYCLES[s.cycle].label} ${price}</span></div>`;
      }
      return `<div class="alert">${ICON_BELL}<span><b>${esc(title(s))}</b> ${rel(a.daysLeft)}（${md(a.date)}）扣款 ${price}</span></div>`;
    }).join('');
    return `<section class="alerts" role="status" aria-label="即將扣款">${rows}</section>`;
  }

  function cardHTML(s, today) {
    const ended = s.status === 'ended';
    const trial = !ended && L.isTrial(s, today);
    const m = L.monthlyBase(s, state.settings);
    const showOrig = s.currency !== 'TWD' || s.cycle !== 'monthly';
    let when;
    if (ended) when = '已取消';
    else if (trial) when = `試用到 ${md(s.trialEnd)} · ${rel(L.daysBetween(today, s.trialEnd))}結束`;
    else { const d = L.nextCharge(s, today); when = `${md(d)} 扣款 · ${rel(L.daysBetween(today, d))}`; }
    return `<button class="card${ended ? ' ended' : ''}" data-id="${esc(s.id)}">
      <span class="dot cat-${esc(s.category)}"></span>
      <span class="card-main">
        <span class="card-title"><span class="name">${esc(s.name)}</span>${s.plan ? `<span class="pill">${esc(s.plan)}</span>` : ''}${trial ? '<span class="pill trial">試用中</span>' : ''}</span>
        ${showOrig ? `<span class="card-sub" style="display:block">${L.fmtMoney(s.price, s.currency)} / ${UNIT[s.cycle]}</span>` : ''}
        <span class="card-next" style="display:block">${when}</span>
      </span>
      <span class="card-cost"><b>${m === null ? '—' : L.fmtBase(m)}</b><span>/月</span></span>
    </button>`;
  }

  function catChartHTML(t) {
    if (!t.byCategory.length) return '';
    const max = t.byCategory[0].monthly || 1;
    const rows = t.byCategory.map((c) => {
      const pct = Math.max(2, (c.monthly / max) * 66);
      return `<div class="bar-row"><span class="bar-label">${esc(catLabel(c.category))}</span><div class="bar-area"><div class="bar cat-${esc(c.category)}" style="width:${pct.toFixed(1)}%"></div><span class="bar-val">${L.fmtBase(c.monthly)}</span></div></div>`;
    }).join('');
    return `<section><h2 class="section-title">分類花費（每月）</h2><div class="chart-card">${rows}</div></section>`;
  }

  function niceCeil(v) {
    if (v <= 0) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
    return 10 * mag;
  }
  function colPath(x, y, w, h) {
    const r = Math.min(4, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function monthData(mode) {
    const today = L.todayLocal();
    return mode === 'past' ? L.history(state.subs, state.settings, today, 12) : L.forecast(state.subs, state.settings, today, 12);
  }
  function monthChartHTML() {
    const mode = ui.mode;
    const data = monthData(mode);
    if (!(ui.sel[mode] >= 0 && ui.sel[mode] < data.length)) ui.sel[mode] = mode === 'past' ? data.length - 1 : 0;
    const tabs = [['past', '過去'], ['future', '未來']].map(([k, label]) =>
      `<button type="button" role="tab" aria-selected="${k === mode}" class="${k === mode ? 'on' : ''}" data-mode="${k}">${label}</button>`).join('');
    return `<div class="tabs" role="tablist">${tabs}</div>${barsHTML(data, ui.sel[mode], mode)}`;
  }
  function barsHTML(fc, selIdx, mode) {
    const W = 340, H = 160, padL = 36, padR = 6, padT = 18, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB, base = padT + plotH;
    const max = Math.max(...fc.map((b) => b.total));
    const top = niceCeil(max) || 1;
    const slot = plotW / fc.length, bw = Math.min(18, slot - 6);
    const peak = max > 0 ? fc.findIndex((b) => b.total === max) : -1;
    let svg = `<svg class="fc-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    for (const f of [0, 0.5, 1]) {
      const y = base - f * plotH;
      svg += `<line class="${f === 0 ? 'base' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      svg += `<text class="ax" x="${padL - 6}" y="${y + 3}" text-anchor="end">${L.compact(top * f)}</text>`;
    }
    svg += `<text class="ax" x="${padL - 6}" y="${base + 15}" text-anchor="end">月</text>`;
    fc.forEach((b, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      const cx = padL + i * slot + slot / 2;
      const h = (b.total / top) * plotH;
      if (b.total > 0) svg += `<path class="col${i === selIdx ? '' : ' dim'}" d="${colPath(x, base - h, bw, h)}"/>`;
      if (i === peak) svg += `<text class="peak" x="${cx}" y="${base - h - 5}" text-anchor="middle">${L.compact(b.total)}</text>`;
      svg += `<text class="ax${i === selIdx ? ' sel' : ''}" x="${cx}" y="${base + 15}" text-anchor="middle">${b.month}</text>`;
      svg += `<rect class="hit" data-month="${i}" x="${padL + i * slot}" y="${padT - 14}" width="${slot}" height="${plotH + padB + 14}"/>`;
    });
    svg += '</svg>';

    const sel = fc[selIdx];
    const items = sel.items.length
      ? `<ul>${sel.items.map((it) => `<li><span>${esc(title(it))}</span><span>${md(it.date)} · ${L.fmtBase(it.amount)}</span></li>`).join('')}</ul>`
      : '<ul><li><span>這個月沒有扣款</span></li></ul>';
    const suffix = mode === 'past' ? (selIdx === fc.length - 1 ? '（至今）' : '') : (selIdx === 0 ? '（剩餘）' : '');
    const detail = mode === 'past' && fc.every((b) => b.total === 0)
      ? '<div class="fc-detail"><div class="fc-head"><span>還沒有過去的扣款紀錄</span></div></div>'
      : `<div class="fc-detail"><div class="fc-head"><span>${sel.year} 年 ${sel.month} 月${suffix}</span><span>${L.fmtBase(sel.total)}</span></div>${items}</div>`;
    const table = `<table class="sr-only"><caption>${mode === 'past' ? '過去 12 個月扣款' : '未來 12 個月預計扣款'}</caption><tbody>${fc.map((b) => `<tr><th>${b.year} 年 ${b.month} 月</th><td>${L.fmtBase(b.total)}</td></tr>`).join('')}</tbody></table>`;
    return svg + detail + table;
  }

  // ---------- 面板 ----------
  function openSheet(html) {
    sheetRoot.innerHTML = html;
    document.body.style.overflow = 'hidden';
    const sheet = $('.sheet', sheetRoot);
    if (sheet) sheet.scrollTop = 0;
  }
  function closeSheet() {
    sheetRoot.innerHTML = '';
    document.body.style.overflow = '';
    ui.sheet = null;
  }

  function optionList(items, selected) {
    return items.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function openEdit(id) {
    const today = L.todayLocal();
    const s = id ? state.subs.find((x) => x.id === id) : null;
    const v = s
      ? Object.assign({}, s, { nextDate: L.nextCharge(s, today) })
      : { name: '', plan: '', category: 'other', price: '', currency: 'TWD', cycle: 'monthly', nextDate: '', trialEnd: '', remindDays: null };
    ui.sheet = { type: 'edit', id: id || null };
    const cycles = [['monthly', '每月'], ['yearly', '每年'], ['quarterly', '每季'], ['weekly', '每週']];
    const cur = Number.isFinite(v.remindDays) ? v.remindDays : '';
    openSheet(`
      <div class="overlay" data-act="close"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${s ? '編輯訂閱' : '新增訂閱'}">
        <div class="sheet-head"><h2>${s ? '編輯訂閱' : '新增訂閱'}</h2><button class="icon-btn" data-act="close" aria-label="關閉">${ICON_X}</button></div>
        <form id="sub-form" novalidate data-sub="${s ? esc(s.id) : ''}" data-initial-next="${esc(v.nextDate)}">
          <label class="field"><span>服務名稱</span><input type="text" name="name" list="presets" autocomplete="off" value="${esc(v.name)}"></label>
          <datalist id="presets">${L.PRESETS.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
          <div class="field"><span>方案</span><input type="text" name="plan" aria-label="方案" autocomplete="off" value="${esc(v.plan || '')}">
            <div class="chips">${PLAN_CHIPS.map((p) => `<button type="button" class="chip" data-plan="${p}">${p}</button>`).join('')}</div></div>
          <div class="row2">
            <label class="field"><span>價格</span><input type="number" name="price" step="any" min="0" inputmode="decimal" value="${esc(v.price)}"></label>
            <label class="field"><span>幣別</span><select name="currency">${optionList(L.CURRENCIES.map((c) => [c, c]), v.currency)}</select></label>
          </div>
          <div class="seg" role="radiogroup" aria-label="扣款週期">${cycles.map(([k, label]) =>
            `<label><input type="radio" name="cycle" value="${k}"${k === v.cycle ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
          <label class="field"><span>下次扣款日</span><input type="date" name="nextDate" value="${esc(v.nextDate)}"></label>
          <label class="field"><span>分類</span><select name="category">${optionList(L.CATEGORIES.map((c) => [c.id, c.label]), v.category)}</select></label>
          <label class="field"><span>開始訂閱日（選填）</span><input type="date" name="startDate" value="${esc(v.startDate || '')}"></label>
          <label class="field"><span>試用結束日（選填）</span><input type="date" name="trialEnd" value="${esc(v.trialEnd || '')}"></label>
          ${s && s.status === 'ended' ? `<label class="field"><span>取消日期</span><input type="date" name="endedAt" value="${esc(s.endedAt || '')}"></label>` : ''}
          <label class="field"><span>提前提醒</span><select name="remindDays"><option value=""${cur === '' ? ' selected' : ''}>預設（${remindLabel(state.settings.remindDays)}）</option>${optionList(REMIND_OPTIONS, cur)}</select></label>
          <div class="err" id="form-err" role="alert"></div>
          <div class="actions">
            ${s ? '<button type="button" class="btn danger" data-act="delete">刪除</button>' : ''}
            ${s ? `<button type="button" class="btn" data-act="toggle-ended">${s.status === 'ended' ? '恢復訂閱' : '標記已取消'}</button>` : ''}
            <button type="submit" class="btn primary">儲存</button>
          </div>
        </form>
      </div>`);
  }

  function saveForm(form) {
    const f = new FormData(form);
    const name = String(f.get('name')).trim();
    const plan = String(f.get('plan')).trim();
    const price = parseFloat(String(f.get('price')).replace(/,/g, ''));
    const cycle = String(f.get('cycle'));
    const nextIn = String(f.get('nextDate') || '');
    const trialEnd = String(f.get('trialEnd') || '');
    const startDate = String(f.get('startDate') || '');
    const existing = form.dataset.sub ? state.subs.find((x) => x.id === form.dataset.sub) : null;
    const endedAt = existing && existing.status === 'ended' ? String(f.get('endedAt') || '') : '';
    let err = '';
    if (!name) err = '請輸入服務名稱';
    else if (!(price >= 0)) err = '請輸入價格';
    else if (!L.isDate(nextIn)) err = '請選擇下次扣款日';
    if (err) { $('#form-err').textContent = err; return; }
    // 沒改日期也沒改週期時保留原基準日，避免 31 號的訂閱被滾成 28 號後就再也回不去
    const keepAnchor = existing && nextIn === form.dataset.initialNext && cycle === existing.cycle;
    const rd = String(f.get('remindDays'));
    const sub = {
      id: existing ? existing.id : uid(),
      name, plan, price, cycle,
      category: String(f.get('category')),
      currency: String(f.get('currency')),
      nextDate: keepAnchor ? existing.nextDate : nextIn,
      trialEnd, startDate, endedAt,
      addedAt: existing ? existing.addedAt || '' : L.todayLocal(),
      remindDays: rd === '' ? null : Number(rd),
      status: existing ? existing.status : 'active',
    };
    if (existing) state.subs[state.subs.indexOf(existing)] = sub; else state.subs.push(sub);
    save(); closeSheet(); render(); toast('已儲存');
  }

  function openSettings() {
    const st = state.settings;
    ui.sheet = { type: 'settings' };
    const used = ['USD'];
    state.subs.forEach((s) => { if (s.currency !== 'TWD' && !used.includes(s.currency)) used.push(s.currency); });
    const rows = used.map((c) => `<div class="rate-row"><label for="r-${c}">${c}</label><input id="r-${c}" type="number" step="any" min="0" inputmode="decimal" data-rate="${c}" value="${st.rates[c] === undefined ? '' : st.rates[c]}"></div>`).join('');
    const src = st.ratesSource === 'auto' ? `已自動更新（${st.ratesAt}）` : st.ratesSource === 'manual' ? '手動設定' : '初始值';
    openSheet(`
      <div class="overlay" data-act="close"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="設定">
        <div class="sheet-head"><h2>設定</h2><button class="icon-btn" data-act="close" aria-label="關閉">${ICON_X}</button></div>
        <label class="field"><span>預設提前提醒</span><select id="set-remind">${optionList(REMIND_OPTIONS, st.remindDays)}</select></label>
        <div class="group"><h3>匯率（1 單位 = 幾元台幣）</h3>${rows}
          <div class="inline"><button type="button" class="btn" data-act="refresh-rates">更新匯率</button><span class="rate-src" id="rate-src">${src}</span></div></div>
        <div class="group"><h3>iPhone 行事曆提醒</h3>
          <button type="button" class="btn primary" data-act="export-ics"${state.subs.some((s) => s.status !== 'ended') ? '' : ' disabled'}>匯出行事曆提醒</button></div>
        <div class="group"><h3>備份</h3>
          <div class="actions"><button type="button" class="btn" data-act="export-json">匯出備份</button><button type="button" class="btn" data-act="import-json">匯入備份</button></div>
          <input type="file" id="import-file" accept="application/json,.json" hidden></div>
        <div class="group"><button type="button" class="btn danger" data-act="wipe" style="width:100%">清除所有資料</button></div>
      </div>`);
  }

  // ---------- 動作 ----------
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  async function refreshRates(silent) {
    try {
      const res = await fetch(RATES_URL, { cache: 'no-store' });
      const j = await res.json();
      if (j.result !== 'success') throw new Error('bad response');
      let n = 0;
      for (const c of L.CURRENCIES) {
        if (c === 'TWD' || !(j.rates[c] > 0)) continue;
        state.settings.rates[c] = Number((1 / j.rates[c]).toPrecision(5));
        n++;
      }
      if (!n) throw new Error('no rates');
      state.settings.ratesSource = 'auto';
      state.settings.ratesAt = L.todayLocal();
      save(); render();
      if (ui.sheet && ui.sheet.type === 'settings') openSettings();
      if (!silent) toast('匯率已更新');
    } catch (e) {
      if (!silent) toast('無法連線，沿用目前的匯率');
    }
  }

  function currentFileStamp() { return L.todayLocal(); }

  const actions = {
    add: () => openEdit(null),
    settings: openSettings,
    close: closeSheet,
    delete() {
      const id = $('#sub-form').dataset.sub;
      const s = state.subs.find((x) => x.id === id);
      if (!s || !confirm(`刪除「${title(s)}」？`)) return;
      state.subs = state.subs.filter((x) => x.id !== id);
      save(); closeSheet(); render(); toast('已刪除');
    },
    'toggle-ended'() {
      const s = state.subs.find((x) => x.id === $('#sub-form').dataset.sub);
      if (!s) return;
      s.status = s.status === 'ended' ? 'active' : 'ended';
      s.endedAt = s.status === 'ended' ? L.todayLocal() : '';
      if (s.status === 'ended') ui.showEnded = true;
      save(); closeSheet(); render(); toast(s.status === 'ended' ? '已標記為取消' : '已恢復訂閱');
    },
    'refresh-rates': () => refreshRates(false),
    'export-ics'() {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      download('訂閱扣款提醒.ics', L.buildICS(state.subs, state.settings, L.todayLocal(), stamp), 'text/calendar;charset=utf-8');
    },
    'export-json': () => download(`訂閱備份-${currentFileStamp()}.json`, JSON.stringify(state, null, 2), 'application/json'),
    'import-json': () => $('#import-file').click(),
    wipe() {
      if (!confirm('清除所有訂閱與設定？此動作無法復原。')) return;
      state = normalize({});
      save(); closeSheet(); render(); toast('已清除');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-id],[data-plan],[data-month],[data-mode]');
    if (!el) return;
    if (el.dataset.act) { if (actions[el.dataset.act]) actions[el.dataset.act](); return; }
    if (el.dataset.plan) {
      const input = $('#sub-form input[name="plan"]');
      input.value = el.dataset.plan;
      return;
    }
    if (el.dataset.mode || el.dataset.month !== undefined) {
      if (el.dataset.mode) ui.mode = el.dataset.mode;
      else ui.sel[ui.mode] = Number(el.dataset.month);
      const fcBox = $('#fc');
      if (fcBox) fcBox.innerHTML = monthChartHTML();
      return;
    }
    if (el.dataset.id) openEdit(el.dataset.id);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'sub-form') { e.preventDefault(); saveForm(e.target); }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'name' && t.form && t.form.id === 'sub-form' && !t.form.dataset.catTouched) {
      const p = L.PRESETS.find((x) => x.name.toLowerCase() === t.value.trim().toLowerCase());
      if (p) t.form.elements.category.value = p.category;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'category' && t.form) t.form.dataset.catTouched = '1';
    if (t.name === 'trialEnd' && t.form && t.value) t.form.elements.nextDate.value = t.value;
    if (t.id === 'set-remind') { state.settings.remindDays = Number(t.value); save(); render(); }
    if (t.dataset && t.dataset.rate) {
      const v = parseFloat(t.value);
      if (v > 0) {
        state.settings.rates[t.dataset.rate] = v;
        state.settings.ratesSource = 'manual';
        save(); render();
        const src = $('#rate-src'); if (src) src.textContent = '手動設定';
      }
    }
    if (t.id === 'import-file' && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!parsed || !Array.isArray(parsed.subs)) throw new Error('format');
          const next = normalize(parsed);
          if (!confirm(`匯入 ${next.subs.length} 筆訂閱，並取代目前所有資料？`)) return;
          state = next; save(); closeSheet(); render(); toast('已匯入');
        } catch (err) { toast('備份檔格式不正確'); }
      };
      reader.readAsText(t.files[0]);
      t.value = '';
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !ui.sheet) render(); });

  // ---------- 啟動 ----------
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const stale = state.settings.ratesSource !== 'manual' && state.settings.ratesAt !== L.todayLocal();
  if (stale && navigator.onLine !== false) refreshRates(true);
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
