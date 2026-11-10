import * as db from './db.js';
import * as cr from './crypto.js';
import { formatTL, formatPlain, parseAmount, todayISO, isValidISODate, formatDateLabel, formatDateTime, formatMonth, shiftMonth, esc } from './format.js';
import * as sound from './sound.js';

const APP_VERSION = '1.4.0';
const LOCK_AFTER_MS = 60 * 1000;
const BACKUP_REMIND_DAYS = 14;

const DEFAULT_CATEGORIES = {
  income: ['Maaş', 'Satış', 'Diğer'],
  expense: ['Market', 'Fatura', 'Ulaşım', 'Yemek', 'Eğlence', 'Diğer'],
};

/*
 * VERİ MODELİ (tutarlar kuruş cinsinden tam sayı)
 *  account:     { id, name, initialBalance, includeInTotal (yoksa true), order, createdAt, updatedAt }
 *  category:    { id, type: 'income'|'expense', name, order, createdAt }
 *  transaction: { id, type: 'income'|'expense'|'transfer', amount (>0), date: 'YYYY-MM-DD',
 *                 accountId, toAccountId (yalnız transfer), categoryId (transferde null),
 *                 note, recurringId (ileride tekrarlayan işlemler için), createdAt, updatedAt }
 *  recurring:   (ileride) — depo şimdiden mevcut, şu an boş.
 */

const $ = (s, el = document) => el.querySelector(s);

const S = {
  dek: null,
  data: { accounts: [], categories: [], transactions: [], recurring: [] },
  view: 'main',
  accountId: null,
  month: todayISO().slice(0, 7), // Hareketler ekranındaki ay (YYYY-MM)
  filter: 'all',                 // all | income | expense | transfer
  meta: { pinLength: 4, lastBackupAt: null },
};

// ---------------------------------------------------------------- ikonlar
const I = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  xfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// ---------------------------------------------------------------- yardımcılar
const sortedAccounts = () => [...S.data.accounts].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
const categoriesOf = type => S.data.categories.filter(c => c.type === type).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
const accountById = id => S.data.accounts.find(a => a.id === id);
const categoryById = id => S.data.categories.find(c => c.id === id);
const txnById = id => S.data.transactions.find(t => t.id === id);
const accName = id => accountById(id)?.name ?? 'Silinmiş hesap';
/** Hesap toplam bakiyeye ve Hareketler'e dahil mi? (alan yoksa: evet) */
const isCounted = id => accountById(id)?.includeInTotal !== false;
/** Hareketler/aylık özet için: dahil olmayan hesabın işlemleri gizlenir.
 *  Transfer, uçlarından biri dahil hesapsa görünür (toplamı değiştirdiği için). */
const isVisibleTxn = t => (t.type === 'transfer' ? isCounted(t.accountId) || isCounted(t.toAccountId) : isCounted(t.accountId));
const catName = id => categoryById(id)?.name ?? 'Kategorisiz';
const sortTxns = list => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

function computeBalances() {
  const m = new Map(S.data.accounts.map(a => [a.id, a.initialBalance]));
  for (const t of S.data.transactions) {
    if (t.type === 'income') m.has(t.accountId) && m.set(t.accountId, m.get(t.accountId) + t.amount);
    else if (t.type === 'expense') m.has(t.accountId) && m.set(t.accountId, m.get(t.accountId) - t.amount);
    else if (t.type === 'transfer') {
      m.has(t.accountId) && m.set(t.accountId, m.get(t.accountId) - t.amount);
      m.has(t.toAccountId) && m.set(t.toAccountId, m.get(t.toAccountId) + t.amount);
    }
  }
  return m;
}

const signClass = v => (v < 0 ? 'neg' : '');

let toastTimer;
let toastAction = null;
function toast(msg, ms = 2600, action = null) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  el.classList.toggle('has-action', !!action);
  toastAction = action;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  $('#toast').classList.remove('show', 'has-action');
  toastAction = null;
}

function haptic() { try { navigator.vibrate?.(10); } catch { /* yok */ } }

// ---------------------------------------------------------------- kalıcılık (şifreli)
/** puts: { store: [obj] }, dels: { store: [id] } — tek atomik IDB transaction. */
async function commit(puts = {}, dels = {}) {
  if (!S.dek) throw new Error('Kilitli');
  const ops = [];
  for (const [store, objs] of Object.entries(puts)) {
    const recs = await Promise.all(objs.map(o => cr.encryptRecord(S.dek, store, o)));
    for (const r of recs) ops.push({ store, type: 'put', value: r });
  }
  for (const [store, ids] of Object.entries(dels)) for (const id of ids) ops.push({ store, type: 'delete', key: id });
  await db.bulk(ops);
  for (const [store, objs] of Object.entries(puts)) {
    for (const o of objs) {
      const arr = S.data[store];
      const i = arr.findIndex(x => x.id === o.id);
      if (i >= 0) arr[i] = o; else arr.push(o);
    }
  }
  for (const [store, ids] of Object.entries(dels)) {
    const set = new Set(ids);
    S.data[store] = S.data[store].filter(x => !set.has(x.id));
  }
}

async function loadData() {
  for (const store of db.DATA_STORES) {
    const recs = await db.getAll(store);
    S.data[store] = await Promise.all(recs.map(r => cr.decryptRecord(S.dek, store, r)));
  }
}

async function loadMeta() {
  const [pl, lb] = await Promise.all([db.get('meta', 'pinLength'), db.get('meta', 'lastBackupAt')]);
  S.meta.pinLength = pl?.value ?? 4;
  S.meta.lastBackupAt = lb?.value ?? null;
}

const setMeta = (key, value) => db.put('meta', { key, value });

function defaultCategories() {
  const now = Date.now();
  const out = [];
  for (const type of ['income', 'expense']) {
    DEFAULT_CATEGORIES[type].forEach((name, i) => out.push({ id: cr.uuid(), type, name, order: i, createdAt: now + i }));
  }
  return out;
}

// ---------------------------------------------------------------- render
function render() {
  if (!S.dek) return;
  openSwipe = null;
  const app = $('#app');
  if (S.view === 'account' && !accountById(S.accountId)) S.view = 'main';
  if (S.view === 'main') app.innerHTML = viewMain();
  else if (S.view === 'account') app.innerHTML = viewAccount();
  else if (S.view === 'settings') app.innerHTML = viewSettings();
  else if (S.view === 'activity') app.innerHTML = viewActivity();
}

function go(view, accountId = null) {
  if (view === 'activity' && S.view !== 'activity') { S.month = todayISO().slice(0, 7); S.filter = 'all'; }
  S.view = view;
  S.accountId = accountId;
  render();
  window.scrollTo(0, 0);
}

function viewMain() {
  const bal = computeBalances();
  const accs = sortedAccounts();
  const total = accs.filter(a => isCounted(a.id)).reduce((s, a) => s + (bal.get(a.id) || 0), 0);
  const hasData = S.data.transactions.length > 0 || accs.length > 0;
  const days = S.meta.lastBackupAt ? (Date.now() - S.meta.lastBackupAt) / 864e5 : Infinity;
  const banner = hasData && days > BACKUP_REMIND_DAYS
    ? `<div class="banner"><span>${S.meta.lastBackupAt ? `Son yedek ${Math.floor(days)} gün önce.` : 'Henüz yedek almadın.'}</span><button data-action="export">Yedekle</button></div>`
    : '';

  // Ana ekran sırası: toplama dahil hesaplar bakiyeye göre çoktan aza (eşitse elle verilen sıra),
  // dahil olmayanlar altta, Ayarlar'daki elle sırada.
  const counted = accs.filter(a => isCounted(a.id))
    .sort((a, b) => (bal.get(b.id) || 0) - (bal.get(a.id) || 0)); // Array.sort kararlı: eşitlikte elle sıra korunur
  const excluded = accs.filter(a => !isCounted(a.id));

  const card = a => {
    const b = bal.get(a.id) || 0;
    const counted = isCounted(a.id);
    return `<div class="card ${counted ? '' : 'excluded'}" data-action="open-account" data-id="${a.id}">
      <div class="card-info">
        <div class="card-name">${esc(a.name)}</div>
        <div class="card-bal num ${signClass(b)}">${formatTL(b)}</div>
      </div>
      <div class="card-btns">
        <button class="round-btn minus" data-action="add-expense" data-id="${a.id}" aria-label="${esc(a.name)} gider ekle">−</button>
        <button class="round-btn plus" data-action="add-income" data-id="${a.id}" aria-label="${esc(a.name)} gelir ekle">+</button>
      </div>
    </div>`;
  };
  const cards = counted.map(card).join('')
    + (excluded.length ? `<div class="cards-sep">Toplama dahil olmayanlar</div>${excluded.map(card).join('')}` : '');

  return `
    <header class="topbar">
      <div class="side">
        <button class="icon-btn" data-action="lock" aria-label="Kilitle">${I.lock}</button>
        <button class="icon-btn" data-action="activity" aria-label="Hareketler">${I.list}</button>
      </div>
      <h1></h1>
      <div class="side right">
        <button class="icon-btn" data-action="transfer" aria-label="Transfer">${I.xfer}</button>
        <button class="icon-btn" data-action="settings" aria-label="Ayarlar">${I.gear}</button>
      </div>
    </header>
    <section class="total">
      <div class="label">Toplam Para</div>
      <div class="amount num ${signClass(total)}">${formatTL(total)}</div>
      ${monthPill()}
    </section>
    ${banner}
    ${accs.length
      ? `<div class="cards">${cards}</div><button class="add-row" data-action="new-account">+ Hesap ekle</button>`
      : `<div class="empty"><p>Henüz hesap yok.<br>Ziraat, Garanti, Papara, Nakit… ne kullanıyorsan ekle.</p>
         <button class="btn btn-primary" data-action="new-account">+ İlk hesabı ekle</button></div>`}
  `;
}

function txnRow(t, perspectiveId) {
  let icon, cls, title, sub, amt, amtCls;
  if (t.type === 'transfer') {
    cls = 'transfer';
    icon = I.xfer;
    const outgoing = perspectiveId ? t.accountId === perspectiveId : true;
    title = perspectiveId
      ? (outgoing ? `Transfer → ${esc(accName(t.toAccountId))}` : `Transfer ← ${esc(accName(t.accountId))}`)
      : `${esc(accName(t.accountId))} → ${esc(accName(t.toAccountId))}`;
    amt = (outgoing ? '−' : '+') + formatTL(t.amount);
    amtCls = perspectiveId ? (outgoing ? 'neg' : 'pos') : '';
  } else {
    const inc = t.type === 'income';
    cls = t.type;
    icon = inc ? '+' : '−';
    title = esc(catName(t.categoryId));
    amt = (inc ? '+' : '−') + formatTL(t.amount);
    amtCls = inc ? 'pos' : 'neg';
  }
  sub = t.note ? esc(t.note) : '';
  return swipeWrap(t.id, `<button class="row" data-action="edit-txn" data-id="${t.id}">
    <div class="row-icon ${cls}">${icon}</div>
    <div class="row-main"><div class="row-title">${title}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>
    <div class="row-amt num ${amtCls}">${amt}</div>
  </button>`);
}

/** Sağdan sola kaydırınca arkadaki kırmızı ✕ (hızlı sil) görünür. */
function swipeWrap(id, rowHtml) {
  return `<div class="swipe" data-id="${id}">
    <button class="swipe-del" data-action="swipe-delete" data-id="${id}" aria-label="İşlemi sil" tabindex="-1">${I.close}</button>
    ${rowHtml}
  </div>`;
}

function viewAccount() {
  const a = accountById(S.accountId);
  const bal = computeBalances().get(a.id) || 0;
  const txns = sortTxns(S.data.transactions.filter(t => t.accountId === a.id || t.toAccountId === a.id));

  let list = '';
  let curDate = null;
  let buf = [];
  const flush = () => { if (buf.length) list += `<div class="group-label">${formatDateLabel(curDate)}</div><div class="list">${buf.join('')}</div>`; buf = []; };
  for (const t of txns) {
    if (t.date !== curDate) { flush(); curDate = t.date; }
    buf.push(txnRow(t, a.id));
  }
  flush();

  return `
    <header class="topbar">
      <div class="side"><button class="icon-btn" data-action="home" aria-label="Geri">${I.back}</button></div>
      <h1>${esc(a.name)}</h1>
      <div class="side right"><button class="icon-btn" data-action="edit-account" data-id="${a.id}" aria-label="Hesabı düzenle">${I.edit}</button></div>
    </header>
    <section class="acc-head">
      <div class="amount num ${signClass(bal)}">${formatTL(bal)}</div>
      <div class="sub">Başlangıç: ${formatTL(a.initialBalance)} · ${txns.length} işlem${isCounted(a.id) ? '' : ' · Toplama dahil değil'}</div>
      <div class="acc-actions">
        <div class="act"><button class="round-btn minus" data-action="add-expense" data-id="${a.id}" aria-label="Gider">−</button>Gider</div>
        <div class="act"><button class="round-btn xfer" data-action="transfer" data-id="${a.id}" aria-label="Transfer">${I.xfer}</button>Transfer</div>
        <div class="act"><button class="round-btn plus" data-action="add-income" data-id="${a.id}" aria-label="Gelir">+</button>Gelir</div>
      </div>
    </section>
    ${txns.length ? list : '<div class="empty"><p>Bu hesapta henüz işlem yok.</p></div>'}
  `;
}

function monthTotals(ym) {
  let income = 0, expense = 0;
  for (const t of S.data.transactions) {
    if (!t.date.startsWith(ym) || !isVisibleTxn(t)) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense };
}

function monthPill() {
  const ym = todayISO().slice(0, 7);
  const { income, expense } = monthTotals(ym);
  return `<button class="month-pill" data-action="activity">
    <span class="muted">Bu ay</span>
    <span class="pos num">+${formatTL(income)}</span>
    <span class="neg num">−${formatTL(expense)}</span>
    <span class="chev">${I.next}</span>
  </button>`;
}

/** Hareketler satırı: nereden → nereye */
function activityRow(t) {
  let icon, cls, from, to, amt, amtCls;
  if (t.type === 'income') {
    cls = 'income'; icon = '+';
    from = catName(t.categoryId); to = accName(t.accountId);
    amt = '+' + formatTL(t.amount); amtCls = 'pos';
  } else if (t.type === 'expense') {
    cls = 'expense'; icon = '−';
    from = accName(t.accountId); to = catName(t.categoryId);
    amt = '−' + formatTL(t.amount); amtCls = 'neg';
  } else {
    cls = 'transfer'; icon = I.xfer;
    from = accName(t.accountId); to = accName(t.toAccountId);
    amt = formatTL(t.amount); amtCls = 'muted';
  }
  return swipeWrap(t.id, `<button class="row" data-action="edit-txn" data-id="${t.id}">
    <div class="row-icon ${cls}">${icon}</div>
    <div class="row-main">
      <div class="row-title flow"><span>${esc(from)}</span><span class="arrow">→</span><span>${esc(to)}</span></div>
      ${t.note ? `<div class="row-sub">${esc(t.note)}</div>` : ''}
    </div>
    <div class="row-amt num ${amtCls}">${amt}</div>
  </button>`);
}

function viewActivity() {
  const ym = S.month;
  const inMonth = S.data.transactions.filter(t => t.date.startsWith(ym) && isVisibleTxn(t));
  const { income, expense } = monthTotals(ym);
  const net = income - expense;
  const shown = sortTxns(inMonth.filter(t => S.filter === 'all' || t.type === S.filter));

  // Günlere göre grupla; gün başlığında o günün toplam girişi / çıkışı (transferler hariç).
  let list = '';
  for (let i = 0; i < shown.length;) {
    const date = shown[i].date;
    const rows = [];
    let dIn = 0, dOut = 0;
    while (i < shown.length && shown[i].date === date) {
      const t = shown[i++];
      if (t.type === 'income') dIn += t.amount;
      else if (t.type === 'expense') dOut += t.amount;
      rows.push(activityRow(t));
    }
    list += `<div class="day-head"><span>${formatDateLabel(date)}</span><span class="day-sum num">
      ${dIn ? `<span class="pos">+${formatTL(dIn)}</span>` : ''}${dOut ? `<span class="neg">−${formatTL(dOut)}</span>` : ''}</span></div>
      <div class="list">${rows.join('')}</div>`;
  }

  const chip = (key, label) => `<button class="filter-chip ${S.filter === key ? 'on' : ''}" data-action="filter" data-f="${key}">${label}</button>`;
  const isCurrent = ym >= todayISO().slice(0, 7);

  return `
    <header class="topbar">
      <div class="side"><button class="icon-btn" data-action="home" aria-label="Geri">${I.back}</button></div>
      <h1>Hareketler</h1>
      <div class="side right"></div>
    </header>
    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-d="-1" aria-label="Önceki ay">${I.back}</button>
      <div class="month-label">${formatMonth(ym)}</div>
      <button class="icon-btn" data-action="month" data-d="1" aria-label="Sonraki ay" ${isCurrent ? 'disabled' : ''}>${I.next}</button>
    </div>
    <div class="summary">
      <div><div class="s-label">Gelen</div><div class="s-val pos num">+${formatTL(income)}</div></div>
      <div><div class="s-label">Giden</div><div class="s-val neg num">−${formatTL(expense)}</div></div>
      <div><div class="s-label">Net</div><div class="s-val num ${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${net > 0 ? '+' : ''}${formatTL(net)}</div></div>
    </div>
    <div class="filters">${chip('all', 'Tümü')}${chip('income', 'Gelen')}${chip('expense', 'Giden')}${chip('transfer', 'Transfer')}</div>
    ${shown.length ? list : `<div class="empty"><p>${inMonth.length ? 'Bu filtrede işlem yok.' : `${formatMonth(ym)} için işlem yok.`}</p></div>`}
  `;
}

function viewSettings() {
  const accs = sortedAccounts();
  const accRows = accs.map((a, i) => `
    <div class="set-row">
      <div class="grow">${esc(a.name)}${isCounted(a.id) ? '' : '<span class="tag">Dahil değil</span>'}</div>
      <button class="icon-btn" data-action="move-account" data-id="${a.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Yukarı taşı">${I.up}</button>
      <button class="icon-btn" data-action="move-account" data-id="${a.id}" data-dir="1" ${i === accs.length - 1 ? 'disabled' : ''} aria-label="Aşağı taşı">${I.down}</button>
      <button class="icon-btn" data-action="edit-account" data-id="${a.id}" aria-label="Düzenle">${I.edit}</button>
    </div>`).join('');

  const catBox = (type, label) => `
    <div class="section-title">${label}</div>
    <div class="cat-box">
      <div class="chips">${categoriesOf(type).map(c => `<span class="chip">${esc(c.name)}<button class="x" data-action="del-category" data-id="${c.id}" aria-label="${esc(c.name)} sil">×</button></span>`).join('')}</div>
      <form class="inline-add" data-form="add-category" data-type="${type}">
        <input class="input" name="name" maxlength="40" placeholder="Yeni kategori" autocomplete="off" enterkeyhint="done">
        <button class="btn btn-small" type="submit">Ekle</button>
      </form>
    </div>`;

  const lb = S.meta.lastBackupAt ? formatDateTime(S.meta.lastBackupAt) : 'Hiç';
  const standalone = isStandalone();

  return `
    <header class="topbar">
      <div class="side"><button class="icon-btn" data-action="home" aria-label="Geri">${I.back}</button></div>
      <h1>Ayarlar</h1>
      <div class="side right"></div>
    </header>

    <div class="section-title">Hesaplar</div>
    <div class="list">
      ${accRows}
      <button class="set-btn accent" data-action="new-account">+ Hesap ekle</button>
    </div>

    ${catBox('income', 'Gelir kategorileri')}
    ${catBox('expense', 'Gider kategorileri')}

    <div class="section-title">Yedekleme</div>
    <div class="list">
      <button class="set-btn accent" data-action="export">Dışa aktar (JSON) <span class="val">Son: ${lb}</span></button>
      <button class="set-btn accent" data-action="import">İçe aktar (JSON)</button>
    </div>
    <div class="section-note">Yedek dosyası <b>şifresizdir</b>; güvenli bir yerde (ör. iCloud Drive'da kişisel bir klasör) sakla. İçe aktarma mevcut tüm verilerin yerine geçer.</div>
    <input type="file" id="import-file" accept="application/json,.json" class="hidden">

    <div class="section-title">Güvenlik</div>
    <div class="list">
      <button class="set-btn" data-action="toggle-sound">Sesler <span class="val">${sound.isEnabled() ? 'Açık' : 'Kapalı'}</span></button>
      ${sound.isEnabled() ? `<button class="set-btn" data-action="cycle-expense-sound">Harcama sesi <span class="val">${sound.EXPENSE_STYLES.find(([k]) => k === sound.getExpenseStyle())[1]} ›</span></button>` : ''}
      <button class="set-btn" data-action="change-pin">PIN değiştir</button>
      <button class="set-btn" data-action="lock">Şimdi kilitle</button>
    </div>
    <div class="section-note">Harcama sesine dokundukça seçenekler arasında geçer ve çalar. Sesler iPhone sessiz moddayken duyulmaz. Uygulama her açılışta ve 1 dakikadan uzun arka planda kalınca PIN sorar. Veriler PBKDF2 (${cr.PBKDF2_ITERATIONS.toLocaleString('tr-TR')} tur) + AES-256-GCM ile şifrelenir.</div>

    <div class="section-title">Uygulama</div>
    <div class="list">
      <div class="set-row"><div class="grow">Sürüm</div><span class="muted pr">${APP_VERSION}</span></div>
      <div class="set-row"><div class="grow">Ana ekran uygulaması</div><span class="muted pr">${standalone ? 'Evet' : 'Hayır (Safari)'}</span></div>
      <div class="set-row"><div class="grow">İşlem sayısı</div><span class="muted pr">${S.data.transactions.length}</span></div>
      <button class="set-btn danger" data-action="wipe">Tüm verileri sil</button>
    </div>
    ${standalone ? '' : `<div class="section-note">iPhone'da Safari → Paylaş → <b>Ana Ekrana Ekle</b> ile tam ekran kullan. Not: Safari ile ana ekran uygulamasının verileri <b>ayrıdır</b>; geçerken JSON yedeğiyle taşı.</div>`}
  `;
}

// ---------------------------------------------------------------- alt panel
let sheetOnClose = null;
function openSheet(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  sheet.scrollTop = 0;
  sheet.classList.add('open');
  $('#sheet-backdrop').classList.add('open');
  return sheet;
}
function closeSheet() {
  const sheet = $('#sheet');
  if (!sheet.classList.contains('open')) return;
  document.activeElement?.blur?.();
  sheet.classList.remove('open');
  $('#sheet-backdrop').classList.remove('open');
  setTimeout(() => { if (!sheet.classList.contains('open')) sheet.innerHTML = ''; }, 300);
  sheetOnClose?.();
  sheetOnClose = null;
}
const sheetHead = title => `<div class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-action="close-sheet" aria-label="Kapat">${I.close}</button></div>`;
const setFormError = msg => { const el = $('#sheet .form-error'); if (el) el.textContent = msg || ''; };

function accountOptions(selectedId, excludeId) {
  return sortedAccounts().filter(a => a.id !== excludeId)
    .map(a => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function lastCategoryFor(type) {
  try { return localStorage.getItem(`lastCat:${type}`); } catch { return null; }
}
function rememberCategory(type, id) {
  try { localStorage.setItem(`lastCat:${type}`, id); } catch { /* yok */ }
}

/** Gelir/gider paneli. txn verilirse düzenleme modu. */
function openTxnSheet(type, accountId, txn = null) {
  const cats = categoriesOf(type);
  const inc = type === 'income';
  let selCat = txn ? txn.categoryId : lastCategoryFor(type);
  if (!cats.some(c => c.id === selCat)) selCat = txn && txn.categoryId ? txn.categoryId : cats[0]?.id;
  const orphan = txn && txn.categoryId && !categoryById(txn.categoryId);

  const sheet = openSheet(`
    ${sheetHead(txn ? (inc ? 'Geliri düzenle' : 'Gideri düzenle') : (inc ? 'Gelir ekle' : 'Gider ekle'))}
    <form data-form="txn" data-type="${type}" ${txn ? `data-id="${txn.id}"` : ''} novalidate>
      <div class="field">
        <div class="amount-field ${type}">
          <span class="cur">${inc ? '+' : '−'}₺</span>
          <input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" enterkeyhint="done"
            value="${txn ? formatPlain(txn.amount) : ''}" aria-label="Tutar">
        </div>
      </div>
      <div class="field">
        <label for="f-account">Hesap</label>
        <select id="f-account" name="accountId" class="input">${accountOptions(txn ? txn.accountId : accountId)}</select>
      </div>
      <div class="field">
        <span class="field-label">Kategori</span>
        <div class="cat-pick ${type}">
          ${cats.map(c => `<input type="radio" name="categoryId" id="c-${c.id}" value="${c.id}" ${c.id === selCat ? 'checked' : ''}><label for="c-${c.id}">${esc(c.name)}</label>`).join('')}
          ${orphan ? `<input type="radio" name="categoryId" id="c-orphan" value="${txn.categoryId}" checked><label for="c-orphan">Kategorisiz</label>` : ''}
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-note">Not (isteğe bağlı)</label>
          <input id="f-note" name="note" class="input" maxlength="200" autocomplete="off" value="${esc(txn?.note ?? '')}" enterkeyhint="done">
        </div>
        <div class="field field-date">
          <label for="f-date">Tarih</label>
          <input id="f-date" name="date" type="date" class="input" value="${txn ? txn.date : todayISO()}" required>
        </div>
      </div>
      <div class="form-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">Kaydet</button>
        ${txn ? `<button class="btn btn-danger btn-block" type="button" data-action="delete-txn" data-id="${txn.id}">İşlemi sil</button>` : ''}
      </div>
    </form>`);
  // iOS: klavyenin açılması için focus, kullanıcı dokunuşuyla aynı senkron akışta olmalı.
  if (!txn) $('#f-amount', sheet).focus();
}

function openTransferSheet(fromId, txn = null) {
  const accs = sortedAccounts();
  if (accs.length < 2) { toast('Transfer için en az 2 hesap gerekli.'); return; }
  const from = txn ? txn.accountId : (fromId || accs[0].id);
  const to = txn ? txn.toAccountId : accs.find(a => a.id !== from).id;
  const sheet = openSheet(`
    ${sheetHead(txn ? 'Transferi düzenle' : 'Transfer')}
    <form data-form="transfer" ${txn ? `data-id="${txn.id}"` : ''} novalidate>
      <div class="field">
        <div class="amount-field">
          <span class="cur">₺</span>
          <input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" enterkeyhint="done"
            value="${txn ? formatPlain(txn.amount) : ''}" aria-label="Tutar">
        </div>
      </div>
      <div class="field">
        <label for="f-from">Nereden</label>
        <select id="f-from" name="accountId" class="input">${accountOptions(from)}</select>
      </div>
      <div class="field">
        <label for="f-to">Nereye</label>
        <select id="f-to" name="toAccountId" class="input">${accountOptions(to)}</select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-note">Not (isteğe bağlı)</label>
          <input id="f-note" name="note" class="input" maxlength="200" autocomplete="off" value="${esc(txn?.note ?? '')}" enterkeyhint="done">
        </div>
        <div class="field field-date">
          <label for="f-date">Tarih</label>
          <input id="f-date" name="date" type="date" class="input" value="${txn ? txn.date : todayISO()}" required>
        </div>
      </div>
      <div class="section-note">Transfer gelir/gider sayılmaz; toplam parayı değiştirmez.</div>
      <div class="form-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">Kaydet</button>
        ${txn ? `<button class="btn btn-danger btn-block" type="button" data-action="delete-txn" data-id="${txn.id}">Transferi sil</button>` : ''}
      </div>
    </form>`);
  if (!txn) $('#f-amount', sheet).focus();
}

function openAccountSheet(acc = null) {
  const neg = acc ? acc.initialBalance < 0 : false;
  const sheet = openSheet(`
    ${sheetHead(acc ? 'Hesabı düzenle' : 'Yeni hesap')}
    <form data-form="account" ${acc ? `data-id="${acc.id}"` : ''} novalidate>
      <div class="field">
        <label for="f-name">Hesap adı</label>
        <input id="f-name" name="name" class="input" maxlength="40" autocomplete="off" placeholder="ör. Ziraat, Papara, Nakit" value="${esc(acc?.name ?? '')}" enterkeyhint="next">
      </div>
      <div class="field">
        <label for="f-amount">Başlangıç bakiyesi</label>
        <div class="amount-field">
          <button type="button" class="sign-btn" data-action="toggle-sign" aria-label="İşareti değiştir">${neg ? '−' : '+'}</button>
          <span class="cur">₺</span>
          <input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" enterkeyhint="done"
            value="${acc ? formatPlain(acc.initialBalance) : ''}">
        </div>
      </div>
      <input type="hidden" name="sign" value="${neg ? '-1' : '1'}">
      <div class="section-note">Kredi kartı borcu gibi eksi bakiye için işareti − yap.${acc ? ' Başlangıç bakiyesini değiştirmek güncel bakiyeyi aynı miktarda değiştirir.' : ''}</div>
      <label class="switch-row">
        <span class="switch-text">
          <span>Toplam bakiyeye dahil</span>
          <span class="switch-note">Kapalıysa toplam paraya ve Hareketler'e yansımaz; işlemleri yalnızca hesaba dokununca görünür.</span>
        </span>
        <span class="switch">
          <input type="checkbox" name="include" ${acc?.includeInTotal === false ? '' : 'checked'}>
          <span class="slider"></span>
        </span>
      </label>
      <div class="form-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">Kaydet</button>
        ${acc ? `<button class="btn btn-danger btn-block" type="button" data-action="delete-account" data-id="${acc.id}">Hesabı sil</button>` : ''}
      </div>
    </form>`);
  if (!acc) $('#f-name', sheet).focus();
}

// ---------------------------------------------------------------- onay penceresi
function confirmDialog({ title, message = '', ok = 'Tamam', cancel = 'Vazgeç', danger = false }) {
  return new Promise(resolve => {
    const dlg = $('#dialog');
    const bd = $('#dialog-backdrop');
    dlg.innerHTML = `<h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}
      <div class="btns">${cancel ? `<button class="btn" data-r="0">${esc(cancel)}</button>` : ''}
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(ok)}</button></div>`;
    const done = r => {
      dlg.classList.remove('open'); bd.classList.remove('open');
      dlg.onclick = null; bd.onclick = null;
      resolve(r);
    };
    dlg.onclick = e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); };
    bd.onclick = () => done(false);
    dlg.classList.add('open'); bd.classList.add('open');
    dlg.querySelector('[data-r="1"]').focus();
  });
}
function closeDialog() {
  $('#dialog').classList.remove('open');
  $('#dialog-backdrop').classList.remove('open');
}

// ---------------------------------------------------------------- form kaydetme
async function submitTxn(form) {
  const f = new FormData(form);
  const type = form.dataset.type;
  const amount = parseAmount(f.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) return setFormError('Geçerli bir tutar gir (ör. 1250,50).');
  const accountId = f.get('accountId');
  if (!accountById(accountId)) return setFormError('Hesap seç.');
  const categoryId = f.get('categoryId');
  if (!categoryId) return setFormError('Kategori seç.');
  const date = f.get('date');
  if (!isValidISODate(date)) return setFormError('Geçerli bir tarih seç.');
  const note = String(f.get('note') || '').trim().slice(0, 200);
  const now = Date.now();
  const old = form.dataset.id ? txnById(form.dataset.id) : null;
  const txn = old
    ? { ...old, amount, accountId, categoryId, note, date, updatedAt: now }
    : { id: cr.uuid(), type, amount, accountId, toAccountId: null, categoryId, note, date, recurringId: null, createdAt: now, updatedAt: now };
  await commit({ transactions: [txn] });
  if (!old) (type === 'income' ? sound.playIncome : sound.playExpense)();
  rememberCategory(type, categoryId);
  haptic();
  closeSheet();
  render();
  toast(old ? 'İşlem güncellendi' : `${type === 'income' ? '+' : '−'}${formatTL(amount)} · ${accName(accountId)}`);
}

async function submitTransfer(form) {
  const f = new FormData(form);
  const amount = parseAmount(f.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) return setFormError('Geçerli bir tutar gir.');
  const accountId = f.get('accountId');
  const toAccountId = f.get('toAccountId');
  if (!accountById(accountId) || !accountById(toAccountId)) return setFormError('Hesapları seç.');
  if (accountId === toAccountId) return setFormError('Kaynak ve hedef hesap aynı olamaz.');
  const date = f.get('date');
  if (!isValidISODate(date)) return setFormError('Geçerli bir tarih seç.');
  const note = String(f.get('note') || '').trim().slice(0, 200);
  const now = Date.now();
  const old = form.dataset.id ? txnById(form.dataset.id) : null;
  const txn = old
    ? { ...old, amount, accountId, toAccountId, note, date, updatedAt: now }
    : { id: cr.uuid(), type: 'transfer', amount, accountId, toAccountId, categoryId: null, note, date, recurringId: null, createdAt: now, updatedAt: now };
  await commit({ transactions: [txn] });
  haptic();
  closeSheet();
  render();
  toast(old ? 'Transfer güncellendi' : `${accName(accountId)} → ${accName(toAccountId)}: ${formatTL(amount)}`);
}

async function submitAccount(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim().slice(0, 40);
  if (!name) return setFormError('Hesap adı gir.');
  const raw = String(f.get('amount') || '').trim();
  let amount = raw ? parseAmount(raw) : 0;
  if (!Number.isFinite(amount)) return setFormError('Geçerli bir bakiye gir.');
  amount = Math.abs(amount) * (f.get('sign') === '-1' ? -1 : 1);
  if (raw.startsWith('-')) amount = -Math.abs(amount);
  const now = Date.now();
  const old = form.dataset.id ? accountById(form.dataset.id) : null;
  const maxOrder = S.data.accounts.reduce((m, a) => Math.max(m, a.order), -1);
  const includeInTotal = !!form.elements.include?.checked;
  const acc = old
    ? { ...old, name, initialBalance: amount, includeInTotal, updatedAt: now }
    : { id: cr.uuid(), name, initialBalance: amount, includeInTotal, order: maxOrder + 1, createdAt: now, updatedAt: now };
  await commit({ accounts: [acc] });
  closeSheet();
  render();
  toast(old ? 'Hesap güncellendi' : `${name} eklendi`);
}

async function addCategory(form) {
  const input = form.elements.name;
  const name = input.value.trim().slice(0, 40);
  const type = form.dataset.type;
  if (!name) return;
  if (categoriesOf(type).some(c => c.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { toast('Bu kategori zaten var.'); return; }
  const order = categoriesOf(type).reduce((m, c) => Math.max(m, c.order), -1) + 1;
  await commit({ categories: [{ id: cr.uuid(), type, name, order, createdAt: Date.now() }] });
  render();
  toast(`${name} eklendi`);
}

async function deleteCategory(id) {
  const c = categoryById(id);
  if (!c) return;
  if (categoriesOf(c.type).length <= 1) { toast('Her türde en az bir kategori kalmalı.'); return; }
  const used = S.data.transactions.filter(t => t.categoryId === id).length;
  const ok = await confirmDialog({
    title: `“${c.name}” silinsin mi?`,
    message: used ? `${used} işlemde kullanılıyor. Bu işlemler silinmez, “Kategorisiz” görünür.` : '',
    ok: 'Sil', danger: true,
  });
  if (!ok) return;
  await commit({}, { categories: [id] });
  render();
}

async function deleteTxn(id) {
  const t = txnById(id);
  if (!t) return;
  const ok = await confirmDialog({ title: 'İşlem silinsin mi?', message: formatTL(t.amount), ok: 'Sil', danger: true });
  if (!ok) return;
  await commit({}, { transactions: [id] });
  closeSheet();
  render();
  toast('İşlem silindi');
}

/** Kaydırarak silme: onay sormadan siler, birkaç saniye "Geri al" sunar. */
async function quickDeleteTxn(id) {
  const t = txnById(id);
  if (!t) return;
  const row = document.querySelector(`.swipe[data-id="${id}"]`);
  if (row) { row.classList.add('removing'); await new Promise(r => setTimeout(r, 180)); }
  await commit({}, { transactions: [id] });
  render();
  toast('İşlem silindi', 5000, {
    label: 'Geri al',
    run: async () => { await commit({ transactions: [t] }); render(); toast('Geri alındı'); },
  });
}

async function deleteAccount(id) {
  const a = accountById(id);
  if (!a) return;
  const related = S.data.transactions.filter(t => t.accountId === id || t.toAccountId === id);
  const ok = await confirmDialog({
    title: `“${a.name}” silinsin mi?`,
    message: related.length ? `Bu hesaba ait ${related.length} işlem (transferler dahil) de silinecek. Geri alınamaz.` : 'Geri alınamaz.',
    ok: 'Sil', danger: true,
  });
  if (!ok) return;
  await commit({}, { accounts: [id], transactions: related.map(t => t.id) });
  closeSheet();
  if (S.view === 'account') S.view = 'main';
  render();
  toast('Hesap silindi');
}

async function moveAccount(id, dir) {
  const accs = sortedAccounts();
  const i = accs.findIndex(a => a.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= accs.length) return;
  [accs[i], accs[j]] = [accs[j], accs[i]];
  const changed = accs.map((a, k) => (a.order === k ? null : { ...a, order: k })).filter(Boolean);
  await commit({ accounts: changed });
  render();
}

// ---------------------------------------------------------------- yedekleme
function buildBackup() {
  return {
    app: 'para-takip',
    format: 1,
    exportedAt: new Date().toISOString(),
    accounts: S.data.accounts,
    categories: S.data.categories,
    transactions: S.data.transactions,
    recurring: S.data.recurring,
  };
}

function exportBackup() {
  const json = JSON.stringify(buildBackup(), null, 2);
  const name = `para-takip-yedek-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const markDone = async () => {
    S.meta.lastBackupAt = Date.now();
    await setMeta('lastBackupAt', S.meta.lastBackupAt);
    render();
    toast('Yedek hazır');
  };
  // iOS: Paylaş sayfası → "Dosyalara Kaydet". share() kullanıcı dokunuşu içinde, await'siz çağrılmalı.
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).then(markDone).catch(err => {
      if (err?.name !== 'AbortError') downloadFile(file, name).then(markDone);
    });
  } else {
    downloadFile(file, name).then(markDone);
  }
}

async function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'para-takip') throw new Error('Bu bir Para Takip yedeği değil.');
  if (obj.format !== 1) throw new Error(`Desteklenmeyen yedek sürümü: ${obj.format}`);
  const str = (v, max) => String(v ?? '').slice(0, max);
  const int = v => (Number.isSafeInteger(v) ? v : NaN);
  const now = Date.now();

  const accounts = (obj.accounts || []).map((a, i) => {
    const r = { id: str(a.id, 64), name: str(a.name, 40).trim(), initialBalance: int(a.initialBalance), includeInTotal: a.includeInTotal !== false, order: Number.isFinite(a.order) ? a.order : i, createdAt: a.createdAt || now, updatedAt: a.updatedAt || now };
    if (!r.id || !r.name || Number.isNaN(r.initialBalance)) throw new Error(`Hatalı hesap kaydı (#${i + 1}).`);
    return r;
  });
  const accIds = new Set(accounts.map(a => a.id));
  const categories = (obj.categories || []).map((c, i) => {
    const r = { id: str(c.id, 64), type: c.type, name: str(c.name, 40).trim(), order: Number.isFinite(c.order) ? c.order : i, createdAt: c.createdAt || now };
    if (!r.id || !r.name || !['income', 'expense'].includes(r.type)) throw new Error(`Hatalı kategori kaydı (#${i + 1}).`);
    return r;
  });
  const transactions = (obj.transactions || []).map((t, i) => {
    const r = {
      id: str(t.id, 64), type: t.type, amount: int(t.amount), date: t.date,
      accountId: str(t.accountId, 64), toAccountId: t.type === 'transfer' ? str(t.toAccountId, 64) : null,
      categoryId: t.type === 'transfer' ? null : (t.categoryId ? str(t.categoryId, 64) : null),
      note: str(t.note, 200), recurringId: t.recurringId ?? null,
      createdAt: t.createdAt || now, updatedAt: t.updatedAt || now,
    };
    const bad = !r.id || !['income', 'expense', 'transfer'].includes(r.type) || !(r.amount > 0) || !isValidISODate(r.date)
      || !accIds.has(r.accountId) || (r.type === 'transfer' && (!accIds.has(r.toAccountId) || r.toAccountId === r.accountId));
    if (bad) throw new Error(`Hatalı işlem kaydı (#${i + 1}).`);
    return r;
  });
  const recurring = Array.isArray(obj.recurring) ? obj.recurring.filter(x => x && x.id) : [];
  for (const type of ['income', 'expense']) {
    if (!categories.some(c => c.type === type)) {
      DEFAULT_CATEGORIES[type].forEach((name, i) => categories.push({ id: cr.uuid(), type, name, order: i, createdAt: now + i }));
    }
  }
  return { accounts, categories, transactions, recurring };
}

async function importBackup(file) {
  let data;
  try {
    if (file.size > 50 * 1024 * 1024) throw new Error('Dosya çok büyük.');
    data = validateBackup(JSON.parse(await file.text()));
  } catch (e) {
    await confirmDialog({ title: 'İçe aktarılamadı', message: e instanceof SyntaxError ? 'Dosya geçerli JSON değil.' : e.message, cancel: null });
    return;
  }
  const ok = await confirmDialog({
    title: 'Yedek yüklensin mi?',
    message: `Yedekte ${data.accounts.length} hesap ve ${data.transactions.length} işlem var.\nMevcut TÜM veriler silinip yedekle değiştirilecek.`,
    ok: 'Yükle', danger: true,
  });
  if (!ok) return;
  // Önce şifrele, sonra tek transaction'da temizle + yaz (atomik).
  const ops = db.DATA_STORES.map(store => ({ store, type: 'clear' }));
  for (const store of db.DATA_STORES) {
    const recs = await Promise.all(data[store].map(o => cr.encryptRecord(S.dek, store, o)));
    for (const r of recs) ops.push({ store, type: 'put', value: r });
  }
  await db.bulk(ops);
  S.data = data;
  go('main');
  toast('Yedek yüklendi');
}

async function wipeEverything() {
  const ok = await confirmDialog({ title: 'Tüm veriler silinsin mi?', message: 'Hesaplar, işlemler, kategoriler ve PIN silinir. Geri alınamaz.', ok: 'Devam', danger: true });
  if (!ok) return false;
  const ok2 = await confirmDialog({ title: 'Emin misin?', message: 'Bu işlem geri alınamaz.', ok: 'Hepsini sil', danger: true });
  if (!ok2) return false;
  await db.wipeAll();
  try { localStorage.clear(); } catch { /* yok */ }
  location.reload();
  return true;
}

// ---------------------------------------------------------------- PIN / kilit
const Lock = {
  mode: null, // intro | setup1 | setup2 | unlock | change-old | change-new1 | change-new2
  buf: '',
  first: '',
  busy: false,
};

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function showLock(mode, msg = '') {
  Lock.mode = mode;
  Lock.buf = '';
  if (mode === 'setup1' || mode === 'change-new1') Lock.first = '';
  const lock = $('#lock');
  lock.classList.remove('hidden');
  const intro = mode === 'intro';
  $('#lock-intro').classList.toggle('hidden', !intro);
  $('#lock-pin').classList.toggle('hidden', intro);
  const T = {
    setup1: ['PIN belirle', '4–6 haneli bir PIN gir, ✓ ile onayla'],
    setup2: ['PIN\'i tekrar gir', 'Onaylamak için aynı PIN\'i gir'],
    unlock: ['PIN\'i Gir', 'Para Takip'],
    'change-old': ['PIN değiştir', 'Mevcut PIN\'ini gir'],
    'change-new1': ['Yeni PIN', '4–6 haneli yeni PIN'],
    'change-new2': ['Yeni PIN\'i tekrar gir', 'Onaylamak için tekrar gir'],
  }[mode];
  if (T) { $('#lock-title').textContent = T[0]; $('#lock-sub').textContent = T[1]; }
  $('#lock-forgot').classList.toggle('hidden', mode !== 'unlock');
  setLockMsg(msg);
  renderDots();
}

function hideLock() {
  $('#lock').classList.add('hidden');
  Lock.mode = null;
  Lock.buf = '';
  Lock.first = '';
}

function expectedLen() {
  if (Lock.mode === 'unlock' || Lock.mode === 'change-old') return S.meta.pinLength;
  if (Lock.mode === 'setup2' || Lock.mode === 'change-new2') return Lock.first.length || null;
  return null;
}

/** iPhone kilit ekranı gibi: alt sıradaki metin tuşları duruma göre görünür. */
function renderKeyLabels() {
  const ok = $('#key-ok');
  const back = $('#key-back');
  const free = Lock.mode === 'setup1' || Lock.mode === 'change-new1';
  ok.classList.toggle('invisible', !(free && Lock.buf.length >= 4 && Lock.buf.length < 6));
  const canCancel = Lock.mode?.startsWith('change');
  back.textContent = Lock.buf.length ? 'Sil' : 'Vazgeç';
  back.classList.toggle('invisible', !Lock.buf.length && !canCancel);
}

function renderDots() {
  const exp = expectedLen();
  const n = exp ?? Math.min(6, Math.max(4, Lock.buf.length));
  $('#lock-dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="dot ${i < Lock.buf.length ? 'on' : ''}"></span>`).join('');
  renderKeyLabels();
}

function setLockMsg(msg, info = false) {
  const el = $('#lock-msg');
  el.textContent = msg || '';
  el.classList.toggle('info', info);
}

function shake() {
  const d = $('#lock-dots');
  d.classList.remove('shake');
  void d.offsetWidth;
  d.classList.add('shake');
  try { navigator.vibrate?.([30, 40, 30]); } catch { /* yok */ }
}

function setBusy(b, msg) {
  Lock.busy = b;
  $('#keypad').classList.toggle('busy', b);
  if (b) setLockMsg(msg || 'Açılıyor…', true);
}

async function getLockout() {
  return (await db.get('meta', 'lockout'))?.value ?? { fails: 0, until: 0 };
}

let lockoutTimer;
function showLockoutCountdown(until) {
  clearInterval(lockoutTimer);
  const tick = () => {
    const s = Math.ceil((until - Date.now()) / 1000);
    if (s <= 0) { clearInterval(lockoutTimer); setBusy(false); setLockMsg(''); return; }
    Lock.busy = true;
    $('#keypad').classList.add('busy');
    setLockMsg(`Çok fazla hatalı deneme. ${s} sn bekle.`);
  };
  tick();
  lockoutTimer = setInterval(tick, 1000);
}

function pinKey(k) {
  if (Lock.busy || !Lock.mode || Lock.mode === 'intro') return;
  if (k === 'back') {
    if (!Lock.buf && Lock.mode.startsWith('change')) { hideLock(); return; }
    Lock.buf = Lock.buf.slice(0, -1); renderDots(); return;
  }
  if (k === 'ok') { pinSubmit(); return; }
  if (!/^\d$/.test(k) || Lock.buf.length >= 6) return;
  Lock.buf += k;
  if (Lock.buf.length === 1) setLockMsg('');
  renderDots();
  const exp = expectedLen();
  if ((exp && Lock.buf.length === exp) || (!exp && Lock.buf.length === 6)) setTimeout(pinSubmit, 120);
}

async function pinSubmit() {
  if (Lock.busy) return;
  const pin = Lock.buf;
  const mode = Lock.mode;

  if (mode === 'setup1' || mode === 'change-new1') {
    if (pin.length < 4) { setLockMsg('PIN en az 4 haneli olmalı.'); shake(); return; }
    Lock.first = pin;
    const keepFirst = pin;
    showLock(mode === 'setup1' ? 'setup2' : 'change-new2');
    Lock.first = keepFirst;
    return;
  }

  if (mode === 'setup2' || mode === 'change-new2') {
    if (pin !== Lock.first) {
      shake();
      showLock(mode === 'setup2' ? 'setup1' : 'change-new1', 'PIN\'ler eşleşmedi, tekrar dene.');
      return;
    }
    if (mode === 'setup2') {
      setBusy(true, 'Şifreleme anahtarı oluşturuluyor…');
      try {
        const { dek, keyring } = await cr.createKeyring(pin);
        S.dek = dek;
        await db.bulk([
          { store: 'meta', type: 'put', value: { key: 'keyring', value: keyring } },
          { store: 'meta', type: 'put', value: { key: 'pinLength', value: pin.length } },
        ]);
        S.meta.pinLength = pin.length;
        S.data = { accounts: [], categories: [], transactions: [], recurring: [] };
        await commit({ categories: defaultCategories() });
        setBusy(false);
        enterApp();
        await confirmDialog({
          title: 'Kurulum tamam',
          message: 'Hatırlatma: PIN\'i unutursan veriler kurtarılamaz. Hesaplarını ekledikten sonra Ayarlar → Yedekleme\'den JSON yedeği al.',
          ok: 'Tamam', cancel: null,
        });
      } catch (e) {
        console.error(e);
        setBusy(false);
        showLock('setup1', 'Kurulum başarısız: ' + (e.message || e));
      }
    } else {
      setBusy(true, 'PIN güncelleniyor…');
      try {
        const keyring = await cr.rewrapKeyring(S.dek, pin);
        await db.bulk([
          { store: 'meta', type: 'put', value: { key: 'keyring', value: keyring } },
          { store: 'meta', type: 'put', value: { key: 'pinLength', value: pin.length } },
        ]);
        S.meta.pinLength = pin.length;
        setBusy(false);
        hideLock();
        toast('PIN değiştirildi');
      } catch (e) {
        console.error(e);
        setBusy(false);
        showLock('change-new1', 'PIN değiştirilemedi.');
      }
    }
    return;
  }

  if (mode === 'unlock' || mode === 'change-old') {
    if (pin.length < 4) { setLockMsg('PIN en az 4 haneli.'); shake(); return; }
    const lo = await getLockout();
    if (lo.until > Date.now()) { Lock.buf = ''; renderDots(); showLockoutCountdown(lo.until); return; }
    setBusy(true, mode === 'unlock' ? 'Açılıyor…' : 'Doğrulanıyor…');
    try {
      const keyring = (await db.get('meta', 'keyring'))?.value;
      const dek = await cr.openKeyring(pin, keyring);
      await setMeta('lockout', { fails: 0, until: 0 });
      if (mode === 'unlock') {
        S.dek = dek;
        await loadData();
        setBusy(false);
        enterApp();
      } else {
        setBusy(false);
        showLock('change-new1');
      }
    } catch (e) {
      if (e?.name !== 'OperationError') console.error(e);
      setBusy(false);
      const fails = lo.fails + 1;
      const until = fails >= 5 ? Date.now() + Math.min(15 * 60, 30 * 2 ** (fails - 5)) * 1000 : 0;
      await setMeta('lockout', { fails, until });
      Lock.buf = '';
      renderDots();
      shake();
      if (until) showLockoutCountdown(until);
      else setLockMsg(e?.name === 'OperationError' ? `Yanlış PIN${fails >= 3 ? ` (${fails}/5)` : ''}` : 'Veriler açılamadı: ' + (e.message || e));
    }
  }
}

function enterApp() {
  hideLock();
  S.view = 'main';
  S.accountId = null;
  render();
}

function lockApp() {
  closeSheet();
  closeDialog();
  S.dek = null;
  S.data = { accounts: [], categories: [], transactions: [], recurring: [] };
  $('#app').innerHTML = '';
  showLock('unlock');
}

// ---------------------------------------------------------------- olaylar
function bindEvents() {
  // Kilit ekranı
  $('#keypad').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (b) { haptic(); pinKey(b.dataset.key); }
  });
  $('#lock').addEventListener('click', async e => {
    const b = e.target.closest('[data-lock]');
    if (!b) return;
    const a = b.dataset.lock;
    if (a === 'intro-ok') showLock('setup1');
    else if (a === 'cancel') hideLock();
    else if (a === 'forgot') {
      const ok = await confirmDialog({
        title: 'PIN\'ini mi unuttun?',
        message: 'Veriler PIN olmadan çözülemez. Tek seçenek tüm verileri silip baştan kurmak; sonra JSON yedeğin varsa içe aktarabilirsin.',
        ok: 'Sıfırla…', danger: true,
      });
      if (ok) await wipeEverything();
    }
  });
  document.addEventListener('keydown', e => {
    if (!Lock.mode || Lock.mode === 'intro' || $('#dialog').classList.contains('open')) return;
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('back');
    else if (e.key === 'Enter') pinKey('ok');
    else if (e.key === 'Escape' && Lock.mode.startsWith('change')) hideLock();
  });

  // iOS: ses motoru ancak dokunuş sırasında açılabilir.
  for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });

  // Uygulama + panel tıklamaları (event delegation)
  document.addEventListener('click', e => {
    if (!S.dek) return;
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    const run = fn => Promise.resolve().then(fn).catch(err => { console.error(err); toast('Hata: ' + (err.message || err)); });
    switch (action) {
      case 'open-account': go('account', id); break;
      case 'home': go('main'); break;
      case 'settings': go('settings'); break;
      case 'activity': go('activity'); break;
      case 'month': S.month = shiftMonth(S.month, Number(el.dataset.d)); render(); break;
      case 'filter': S.filter = el.dataset.f; render(); break;
      case 'toggle-sound': {
        sound.setEnabled(!sound.isEnabled());
        if (sound.isEnabled()) { sound.unlock(); sound.playIncome(); }
        render();
        break;
      }
      case 'add-income': openTxnSheet('income', id); break;
      case 'add-expense': openTxnSheet('expense', id); break;
      case 'transfer': openTransferSheet(id); break;
      case 'new-account': openAccountSheet(); break;
      case 'edit-account': openAccountSheet(accountById(id)); break;
      case 'delete-account': run(() => deleteAccount(id)); break;
      case 'move-account': run(() => moveAccount(id, Number(el.dataset.dir))); break;
      case 'edit-txn': {
        const t = txnById(id);
        if (!t) break;
        if (t.type === 'transfer') openTransferSheet(null, t); else openTxnSheet(t.type, t.accountId, t);
        break;
      }
      case 'delete-txn': run(() => deleteTxn(id)); break;
      case 'swipe-delete': run(() => quickDeleteTxn(id)); break;
      case 'cycle-expense-sound': {
        const list = sound.EXPENSE_STYLES.map(([k]) => k);
        const next = list[(list.indexOf(sound.getExpenseStyle()) + 1) % list.length];
        sound.setExpenseStyle(next);
        sound.playExpense(next);
        render();
        break;
      }
      case 'del-category': run(() => deleteCategory(id)); break;
      case 'close-sheet': closeSheet(); break;
      case 'toggle-sign': {
        const form = el.closest('form');
        const neg = form.elements.sign.value !== '-1';
        form.elements.sign.value = neg ? '-1' : '1';
        el.textContent = neg ? '−' : '+';
        break;
      }
      case 'export': exportBackup(); break;
      case 'import': $('#import-file')?.click(); break;
      case 'change-pin': showLock('change-old'); break;
      case 'lock': lockApp(); break;
      case 'wipe': run(wipeEverything); break;
    }
  });

  document.addEventListener('submit', e => {
    const form = e.target;
    const kind = form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    if (!S.dek) return;
    const btn = form.querySelector('[type="submit"]');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    const fn = { txn: submitTxn, transfer: submitTransfer, account: submitAccount, 'add-category': addCategory }[kind];
    Promise.resolve(fn?.(form))
      .catch(err => { console.error(err); setFormError('Kaydedilemedi: ' + (err.message || err)); })
      .finally(() => { if (btn) btn.disabled = false; });
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'import-file' && e.target.files?.[0]) {
      const f = e.target.files[0];
      e.target.value = '';
      importBackup(f).catch(err => { console.error(err); toast('İçe aktarma hatası: ' + err.message); });
    }
  });

  $('#sheet-backdrop').addEventListener('click', closeSheet);

  $('#toast').addEventListener('click', e => {
    if (!e.target.closest('.toast-btn') || !toastAction) return;
    const a = toastAction;
    hideToast();
    Promise.resolve(a.run()).catch(err => { console.error(err); toast('Hata: ' + (err.message || err)); });
  });

  bindSwipe();

  // Arka plan kilidi: 1 dakikadan uzun arka planda kalınca kilitle.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      document.body.classList.add('privacy-on');
    } else {
      if (S.dek && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lockApp();
      hiddenAt = 0;
      document.body.classList.remove('privacy-on');
    }
  });
  // iOS bazen visibilitychange yerine pagehide/pageshow tetikler (bfcache).
  window.addEventListener('pageshow', e => {
    if (e.persisted && S.dek && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lockApp();
    document.body.classList.remove('privacy-on');
  });

  // Klavye açıkken alt paneli klavyenin üstünde tut (iOS'ta fixed öğeler klavyenin altında kalır).
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const upd = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
  }
}

// ---------------------------------------------------------------- kaydırarak silme
const SWIPE_W = 84;      // açıkken görünen ✕ alanı genişliği
let openSwipe = null;    // açık duran satır (.swipe)

function setSwipeX(sw, x) {
  sw.querySelector('.row').style.transform = x ? `translateX(${x}px)` : '';
  sw.querySelector('.swipe-del').style.width = `${Math.max(SWIPE_W, -x)}px`;
}
function closeSwipe(sw = openSwipe) {
  if (!sw) return;
  sw.classList.remove('open');
  setSwipeX(sw, 0);
  if (openSwipe === sw) openSwipe = null;
}

function bindSwipe() {
  let drag = null;           // { sw, x0, y0, base, dx, active }
  let suppressClick = false;

  document.addEventListener('pointerdown', e => {
    suppressClick = false;
    const sw = e.target.closest('.swipe');
    const onDel = !!e.target.closest('.swipe-del');
    if (openSwipe && openSwipe !== sw) { closeSwipe(); suppressClick = true; }
    if (!sw || onDel || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const wasOpen = sw === openSwipe;
    drag = { sw, x0: e.clientX, y0: e.clientY, base: wasOpen ? -SWIPE_W : 0, dx: 0, active: false, closeOnTap: wasOpen };
  });

  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // dikey kaydırma
      if (Math.abs(dx) < 8) return;
      drag.active = true;
      drag.sw.classList.add('dragging');
    }
    let x = drag.base + dx;
    if (x > 0) x = x / 4;                       // sağa doğru direnç
    const w = drag.sw.offsetWidth;
    if (x < -w * 0.85) x = -w * 0.85;
    drag.dx = x;
    drag.sw.classList.toggle('full', x < -w * 0.55);
    setSwipeX(drag.sw, x);
  });

  const end = () => {
    if (!drag) return;
    const { sw, active, dx, closeOnTap } = drag;
    drag = null;
    if (!active) {
      if (closeOnTap) { closeSwipe(sw); suppressClick = true; } // açık satıra dokunmak onu kapatır
      return;
    }
    suppressClick = true;
    sw.classList.remove('dragging');
    const full = sw.classList.contains('full');
    sw.classList.remove('full');
    if (full) { haptic(); quickDeleteTxn(sw.dataset.id).catch(err => toast('Hata: ' + err.message)); return; }
    if (dx < -SWIPE_W / 2) {
      if (openSwipe && openSwipe !== sw) closeSwipe();
      sw.classList.add('open');
      setSwipeX(sw, -SWIPE_W);
      openSwipe = sw;
    } else closeSwipe(sw);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => {
    if (drag?.active) { drag.sw.classList.remove('dragging', 'full'); closeSwipe(drag.sw); }
    drag = null;
  });

  // Kaydırma veya açık satırı kapatma hareketinden sonra gelen "click" düzenleme panelini açmasın.
  document.addEventListener('click', e => {
    if (!suppressClick) return;
    suppressClick = false;
    if (e.target.closest('.swipe-del')) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // Görünüm yeniden çizilince açık satır referansı geçersizleşir.
  window.addEventListener('scroll', () => closeSwipe(), { passive: true });
}

// ---------------------------------------------------------------- açılış
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Güncelleme yüklendi; uygulamayı yeniden açınca geçerli olur.', 4000);
        }
      });
    });
  }).catch(err => console.warn('SW kaydı başarısız', err));
}

async function boot() {
  bindEvents();
  registerSW();
  if (!cr.isSupported() || !window.indexedDB) {
    $('#lock-pin').innerHTML = '<h1>Desteklenmiyor</h1><p class="lock-sub">Bu tarayıcı Web Crypto / IndexedDB desteklemiyor ya da sayfa HTTPS üzerinden açılmadı.</p>';
    return;
  }
  try {
    navigator.storage?.persist?.();
    const keyring = await db.get('meta', 'keyring');
    await loadMeta();
    if (!keyring) { showLock('intro'); return; }
    showLock('unlock');
    const lo = await getLockout();
    if (lo.until > Date.now()) showLockoutCountdown(lo.until);
  } catch (e) {
    console.error(e);
    $('#lock-pin').innerHTML = `<h1>Hata</h1><p class="lock-sub">${esc(e.message || e)}</p>`;
  }
}

boot();
