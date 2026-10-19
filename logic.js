/* 訂閱管理 核心邏輯：日期、換算、統計、預測、行事曆匯出。純函式，瀏覽器與 Node 共用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = [
    { id: 'ai', label: 'AI' },
    { id: 'video', label: '影音' },
    { id: 'music', label: '音樂' },
    { id: 'cloud', label: '雲端' },
    { id: 'work', label: '生產力' },
    { id: 'learn', label: '學習' },
    { id: 'game', label: '遊戲' },
    { id: 'other', label: '其他' },
  ];

  const PRESETS = [
    ['ChatGPT', 'ai'], ['Claude', 'ai'], ['Gemini', 'ai'], ['Perplexity', 'ai'], ['Cursor', 'ai'],
    ['GitHub Copilot', 'ai'], ['Midjourney', 'ai'],
    ['Netflix', 'video'], ['Disney+', 'video'], ['YouTube Premium', 'video'], ['HBO Max', 'video'],
    ['Prime Video', 'video'], ['Apple TV+', 'video'], ['Twitch', 'video'],
    ['Spotify', 'music'], ['Apple Music', 'music'], ['KKBOX', 'music'], ['YouTube Music', 'music'],
    ['iCloud+', 'cloud'], ['Google One', 'cloud'], ['Dropbox', 'cloud'], ['OneDrive', 'cloud'],
    ['Apple One', 'cloud'],
    ['Notion', 'work'], ['Microsoft 365', 'work'], ['Adobe Creative Cloud', 'work'], ['Canva', 'work'],
    ['Evernote', 'work'], ['Todoist', 'work'], ['Figma', 'work'],
    ['Duolingo', 'learn'], ['Coursera', 'learn'], ['Udemy', 'learn'], ['Kindle Unlimited', 'learn'],
    ['Nintendo Switch Online', 'game'], ['PlayStation Plus', 'game'], ['Xbox Game Pass', 'game'],
    ['Apple Arcade', 'game'],
  ].map(([name, category]) => ({ name, category }));

  const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'HKD', 'KRW', 'AUD', 'CAD', 'SGD'];
  const SYMBOLS = {
    TWD: 'NT$', USD: 'US$', JPY: '¥', EUR: '€', GBP: '£', CNY: 'CN¥', HKD: 'HK$',
    KRW: '₩', AUD: 'A$', CAD: 'C$', SGD: 'S$',
  };
  // 初始匯率（1 單位外幣 = 幾元台幣），連上網後會被自動更新取代
  const DEFAULT_RATES = {
    USD: 32.45, JPY: 0.2053, EUR: 36.39, GBP: 43.19, CNY: 4.838,
    HKD: 4.13, KRW: 0.02432, AUD: 22.6, CAD: 22.92, SGD: 25.32,
  };

  const CYCLES = {
    weekly: { days: 7, label: '每週' },
    monthly: { months: 1, label: '每月' },
    quarterly: { months: 3, label: '每季' },
    yearly: { months: 12, label: '每年' },
  };
  const MONTHLY_FACTOR = { weekly: 365.25 / 7 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

  function defaultSettings() {
    return {
      baseCurrency: 'TWD',
      remindDays: 3,
      rates: Object.assign({}, DEFAULT_RATES),
      ratesSource: 'default', // default | auto | manual
      ratesAt: null,
    };
  }

  // ---------- 日期（一律用 YYYY-MM-DD 字串，避開時區問題） ----------
  const pad = (n) => String(n).padStart(2, '0');
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseDate(s) {
    const m = DATE_RE.exec(s || '');
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function isDate(s) {
    const p = parseDate(s);
    return !!p && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
  }
  function fmtDate(p) { return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function toDays(s) {
    const p = parseDate(s);
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }
  function daysBetween(a, b) { return toDays(b) - toDays(a); }
  function addDays(s, n) {
    const dt = new Date((toDays(s) + n) * 86400000);
    return fmtDate({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  }
  // 月底自動夾住：1/31 + 1 個月 = 2/28（或 2/29）
  function addMonths(s, n) {
    const p = parseDate(s);
    const total = p.y * 12 + (p.m - 1) + n;
    const y = Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12 + 1;
    return fmtDate({ y, m, d: Math.min(p.d, daysInMonth(y, m)) });
  }
  function todayLocal(now) {
    const d = now || new Date();
    return fmtDate({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
  }

  // 第 n 次扣款日，永遠從基準日算，日期才不會逐月漂移
  function occurrence(anchor, cycle, n) {
    const c = CYCLES[cycle];
    return c.days ? addDays(anchor, c.days * n) : addMonths(anchor, c.months * n);
  }
  function firstOccurrence(anchor, cycle, from) {
    if (anchor >= from) return { date: anchor, n: 0 };
    const c = CYCLES[cycle];
    let n;
    if (c.days) n = Math.ceil(daysBetween(anchor, from) / c.days);
    else {
      const a = parseDate(anchor), f = parseDate(from);
      n = Math.max(0, Math.floor(((f.y - a.y) * 12 + (f.m - a.m)) / c.months));
    }
    let date = occurrence(anchor, cycle, n);
    while (date < from) { n++; date = occurrence(anchor, cycle, n); }
    while (n > 0) {
      const prev = occurrence(anchor, cycle, n - 1);
      if (prev >= from) { n--; date = prev; } else break;
    }
    return { date, n };
  }

  // ---------- 訂閱狀態 ----------
  function isTrial(sub, today) { return !!sub.trialEnd && sub.trialEnd >= today; }
  function nextCharge(sub, today) {
    const from = sub.trialEnd && sub.trialEnd > today ? sub.trialEnd : today;
    return firstOccurrence(sub.nextDate, sub.cycle, from).date;
  }
  function remindOf(sub, settings) {
    return Number.isFinite(sub.remindDays) ? sub.remindDays : settings.remindDays;
  }
  function isValidSub(s) {
    return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' &&
      Number.isFinite(s.price) && s.price >= 0 && !!CYCLES[s.cycle] && isDate(s.nextDate) &&
      ['trialEnd', 'startDate', 'addedAt', 'endedAt'].every((k) => !s[k] || isDate(s[k]));
  }

  // ---------- 金額 ----------
  function toBase(amount, currency, settings) {
    if (currency === settings.baseCurrency) return amount;
    const r = settings.rates && settings.rates[currency];
    return typeof r === 'number' && r > 0 ? amount * r : null;
  }
  function monthlyBase(sub, settings) {
    const b = toBase(sub.price, sub.currency, settings);
    return b === null ? null : b * MONTHLY_FACTOR[sub.cycle];
  }
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  function fmtMoney(amount, currency) {
    const n = Math.abs(amount - Math.round(amount)) < 0.005 ? Math.round(amount) : amount;
    return (SYMBOLS[currency] || currency + ' ') + nf.format(n);
  }
  function fmtBase(amount) { return 'NT$' + nf.format(Math.round(amount)); }
  function compact(n) {
    if (n < 1000) return String(Math.round(n));
    return (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'K';
  }

  // ---------- 統計 ----------
  function totals(subs, settings, today) {
    let monthly = 0, activeCount = 0, trialCount = 0, trialMonthly = 0, endedCount = 0;
    const cat = {};
    const missing = new Set();
    for (const s of subs) {
      if (s.status === 'ended') { endedCount++; continue; }
      const m = monthlyBase(s, settings);
      if (isTrial(s, today)) {
        trialCount++;
        if (m === null) missing.add(s.currency); else trialMonthly += m;
        continue;
      }
      activeCount++;
      if (m === null) { missing.add(s.currency); continue; }
      monthly += m;
      cat[s.category] = (cat[s.category] || 0) + m;
    }
    const byCategory = Object.entries(cat)
      .map(([category, v]) => ({ category, monthly: v }))
      .sort((a, b) => b.monthly - a.monthly);
    return {
      monthly, yearly: monthly * 12, activeCount, trialCount, trialMonthly, endedCount,
      byCategory, missing: [...missing],
    };
  }

  // 本月起 N 個月，每月實際會被扣多少（年繳會集中在某個月）
  function forecast(subs, settings, today, months) {
    months = months || 12;
    const p = parseDate(today);
    const first = fmtDate({ y: p.y, m: p.m, d: 1 });
    const buckets = [];
    for (let i = 0; i < months; i++) {
      const f = addMonths(first, i);
      const q = parseDate(f);
      buckets.push({ key: f.slice(0, 7), year: q.y, month: q.m, total: 0, items: [] });
    }
    const index = {};
    buckets.forEach((b, i) => { index[b.key] = i; });
    const end = addMonths(first, months);
    for (const s of subs) {
      if (s.status === 'ended') continue;
      const amount = toBase(s.price, s.currency, settings);
      if (amount === null) continue;
      const from = s.trialEnd && s.trialEnd > today ? s.trialEnd : today;
      let { date, n } = firstOccurrence(s.nextDate, s.cycle, from);
      while (date < end) {
        const b = buckets[index[date.slice(0, 7)]];
        b.total += amount;
        b.items.push({ id: s.id, name: s.name, plan: s.plan, date, amount });
        n++;
        date = occurrence(s.nextDate, s.cycle, n);
      }
    }
    buckets.forEach((b) => b.items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)));
    return buckets;
  }

  // 基準日往前或往後，落在 [from, to] 之間的所有扣款日
  function occurrencesInRange(anchor, cycle, from, to) {
    if (from > to) return [];
    const c = CYCLES[cycle];
    let n;
    if (c.days) n = Math.floor(daysBetween(anchor, from) / c.days);
    else {
      const a = parseDate(anchor), f = parseDate(from);
      n = Math.floor(((f.y - a.y) * 12 + (f.m - a.m)) / c.months);
    }
    while (occurrence(anchor, cycle, n) < from) n++;
    while (occurrence(anchor, cycle, n - 1) >= from) n--;
    const out = [];
    for (let d = occurrence(anchor, cycle, n); d <= to && out.length < 5000; d = occurrence(anchor, cycle, ++n)) out.push(d);
    return out;
  }

  // 這筆訂閱「已經扣過款」的日期範圍：開始訂閱日（沒填就用加入 APP 的日子）起，到今天或取消前一天
  function chargeWindow(sub, today) {
    const start = sub.startDate || sub.addedAt;
    if (!start) return null;
    let from = start;
    if (sub.trialEnd && sub.trialEnd > from) from = sub.trialEnd; // 試用期間免費，第一次扣款在試用結束日
    let to = today;
    if (sub.status === 'ended' && sub.endedAt) {
      const before = addDays(sub.endedAt, -1);
      if (before < to) to = before;
    }
    return { from, to };
  }

  // 過去 N 個月（含本月到今天為止）每月實際扣款，用現在的價格與匯率回推
  function history(subs, settings, today, months) {
    months = months || 12;
    const p = parseDate(today);
    const startMonth = addMonths(fmtDate({ y: p.y, m: p.m, d: 1 }), -(months - 1));
    const buckets = [];
    const index = {};
    for (let i = 0; i < months; i++) {
      const f = addMonths(startMonth, i);
      const q = parseDate(f);
      index[f.slice(0, 7)] = i;
      buckets.push({ key: f.slice(0, 7), year: q.y, month: q.m, total: 0, items: [] });
    }
    for (const s of subs) {
      const w = chargeWindow(s, today);
      if (!w) continue;
      const amount = toBase(s.price, s.currency, settings);
      if (amount === null) continue;
      const from = w.from > startMonth ? w.from : startMonth;
      for (const date of occurrencesInRange(s.nextDate, s.cycle, from, w.to)) {
        const b = buckets[index[date.slice(0, 7)]];
        b.total += amount;
        b.items.push({ id: s.id, name: s.name, plan: s.plan, date, amount });
      }
    }
    buckets.forEach((b) => b.items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)));
    return buckets;
  }

  // 落在提醒天數內的扣款／試用結束
  function upcoming(subs, settings, today) {
    const out = [];
    for (const s of subs) {
      if (s.status === 'ended') continue;
      const lead = remindOf(s, settings);
      if (isTrial(s, today)) {
        const left = daysBetween(today, s.trialEnd);
        if (left <= lead) out.push({ type: 'trial', sub: s, date: s.trialEnd, daysLeft: left });
      } else {
        const date = nextCharge(s, today);
        const left = daysBetween(today, date);
        if (left <= lead) out.push({ type: 'charge', sub: s, date, daysLeft: left });
      }
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft || a.sub.name.localeCompare(b.sub.name));
  }

  // ---------- 行事曆 (.ics) ----------
  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  // RFC 5545：每行最多 75 位元組，超過就折行（不可切在多位元組字元中間）
  function foldLine(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  const compactDate = (s) => s.replace(/-/g, '');

  // 全天事件的 00:00 為基準；提前 N 天的早上 9 點提醒
  function alarmTrigger(days) {
    if (days <= 0) return 'PT9H';
    return days === 1 ? '-PT15H' : `-P${days - 1}DT15H`;
  }
  function alarm(days, text) {
    return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(text)}`, `TRIGGER:${alarmTrigger(days)}`, 'END:VALARM'];
  }
  function rrule(cycle, date) {
    if (cycle === 'weekly') return 'RRULE:FREQ=WEEKLY';
    if (cycle === 'yearly') return 'RRULE:FREQ=YEARLY';
    const interval = cycle === 'quarterly' ? ';INTERVAL=3' : '';
    const d = parseDate(date).d;
    if (d >= 29) { // 29~31 日：沒有那一天的月份就落在月底
      const days = [];
      for (let i = 28; i <= d; i++) days.push(i);
      return `RRULE:FREQ=MONTHLY${interval};BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
    }
    return `RRULE:FREQ=MONTHLY${interval}`;
  }
  function title(sub) { return sub.plan ? `${sub.name} ${sub.plan}` : sub.name; }

  function buildICS(subs, settings, today, stamp) {
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SubTracker//ZH-TW//', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-CALNAME:訂閱扣款提醒',
    ];
    const event = (uid, date, summary, desc, days, repeat) => {
      lines.push('BEGIN:VEVENT', `UID:${uid}@subtracker`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compactDate(date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(date, 1))}`);
      if (repeat) lines.push(repeat);
      lines.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc)}`, 'TRANSP:TRANSPARENT');
      lines.push(...alarm(days, summary), 'END:VEVENT');
    };
    for (const s of subs) {
      if (s.status === 'ended') continue;
      const days = remindOf(s, settings);
      const price = fmtMoney(s.price, s.currency);
      const per = CYCLES[s.cycle].label;
      if (isTrial(s, today)) {
        event(`${s.id}-trial`, s.trialEnd, `${title(s)} 試用即將結束`,
          `試用結束日，之後${per} ${price}`, days);
      }
      const next = nextCharge(s, today);
      event(`${s.id}-charge`, next, `${title(s)} 扣款 ${price}`,
        `${per} ${price}`, days, rrule(s.cycle, next));
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  return {
    CATEGORIES, PRESETS, CURRENCIES, SYMBOLS, DEFAULT_RATES, CYCLES, MONTHLY_FACTOR,
    defaultSettings, parseDate, isDate, fmtDate, daysInMonth, daysBetween, addDays, addMonths,
    todayLocal, occurrence, firstOccurrence, isTrial, nextCharge, remindOf, isValidSub,
    toBase, monthlyBase, fmtMoney, fmtBase, compact, totals, forecast, upcoming,
    occurrencesInRange, chargeWindow, history,
    icsEscape, foldLine, alarmTrigger, rrule, buildICS,
  };
});
