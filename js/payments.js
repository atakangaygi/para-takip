// Ödemeler için saf tarih/durum mantığı. DOM ve import yok.
// period = 'YYYY-MM'; tarihler 'YYYY-MM-DD' (yerel takvim günü).

export const DEFAULT_WARN_DAYS = 7;

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const pad = n => String(n).padStart(2, '0');

// Son ödeme tarihi; gün ayın son gününe kırpılır.
export function dueDateOf(period, dueDay) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${pad(Math.min(dueDay, last))}`;
}

// Period'u delta ay kaydırır.
export function shiftPeriod(period, delta) {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

// Takvim günü farkı (to - from); yaz saatinden etkilenmez.
export function daysBetween(fromISO, toISO) {
  const u = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(toISO) - u(fromISO)) / 86400000);
}

// Son ödeme tarihi today'e eşit veya sonra olan en erken period.
export function firstPeriodFor(dueDay, today) {
  const p = today.slice(0, 7);
  return dueDateOf(p, dueDay) >= today ? p : shiftPeriod(p, 1);
}

// Ödenmiş en büyük period ya da null.
export function lastPaidPeriod(item) {
  const keys = Object.keys(item.paid || {});
  return keys.length ? keys.sort().pop() : null;
}

// Ödenmemiş sıradaki period.
export function nextPeriod(item, today) {
  const last = lastPaidPeriod(item);
  if (last) return shiftPeriod(last, 1);
  return item.firstPeriod || firstPeriodFor(item.dueDay, today);
}

// Sıradaki ödemenin durumu.
export function dueStatus(item, today) {
  const period = nextPeriod(item, today);
  const dueDate = dueDateOf(period, item.dueDay);
  const days = daysBetween(today, dueDate);
  const warn = item.warnDays ?? DEFAULT_WARN_DAYS;
  const p = lastPaidPeriod(item);
  const lastPaid = p ? { period: p, ...item.paid[p] } : null;
  let level;
  if (days < 0) level = 'overdue';
  else if (days > warn) level = lastPaid ? 'paid' : 'upcoming';
  else if (days <= 3) level = 'urgent';
  else level = 'warn';
  return { period, dueDate, days, level, lastPaid };
}

// Kalan güne göre kısa metin.
export function dueText(days) {
  if (days < 0) return `${-days} gün gecikti`;
  if (days === 0) return 'Bugün son gün';
  if (days === 1) return 'Yarın son gün';
  return `${days} gün kaldı`;
}

// '2026-12-12' -> '12 Aralık'
export function formatDayMonth(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
