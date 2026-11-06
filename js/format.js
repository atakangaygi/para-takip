// Para birimi ve tarih yardımcıları. Tutarlar her yerde kuruş cinsinden tam sayıdır.

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** 1245000 -> "₺12.450,00" */
export function formatTL(kurus) {
  const n = Math.round(Number(kurus) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const lira = Math.floor(abs / 100);
  const k = abs % 100;
  const grouped = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + '₺' + grouped + ',' + String(k).padStart(2, '0');
}

/** Düzenleme alanı için: 125050 -> "1250,50", 120000 -> "1200" */
export function formatPlain(kurus) {
  const n = Math.abs(Math.round(Number(kurus) || 0));
  const lira = Math.floor(n / 100);
  const k = n % 100;
  return k ? `${lira},${String(k).padStart(2, '0')}` : String(lira);
}

/**
 * Kullanıcı girdisini kuruşa çevirir. Geçersizse NaN.
 * Kabul edilenler: "1250", "1250,5", "1.250,50", "1250.50", "1,250.50", "₺1.250"
 * Tek nokta + tam 3 hane ("1.250") binlik ayırıcı kabul edilir (TR alışkanlığı).
 */
export function parseAmount(input) {
  let s = String(input ?? '').trim().replace(/[₺\s]/g, '');
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!s) return NaN;

  const lastC = s.lastIndexOf(',');
  const lastD = s.lastIndexOf('.');
  let intPart = s;
  let decPart = '';

  if (lastC >= 0 && lastD >= 0) {
    const sep = lastC > lastD ? ',' : '.';
    const other = sep === ',' ? '.' : ',';
    const i = s.lastIndexOf(sep);
    intPart = s.slice(0, i);
    decPart = s.slice(i + 1);
    if (intPart.includes(sep)) return NaN;
    const groups = intPart.split(other);
    if (groups.length > 1 && groups.slice(1).some(g => g.length !== 3)) return NaN;
    intPart = groups.join('');
  } else if (lastC >= 0) {
    if (s.indexOf(',') !== lastC) return NaN;
    intPart = s.slice(0, lastC);
    decPart = s.slice(lastC + 1);
  } else if (lastD >= 0) {
    const parts = s.split('.');
    if (parts.length > 2 || parts[1].length === 3) {
      if (parts.slice(1).some(g => g.length !== 3) || !parts[0]) return NaN;
      intPart = parts.join('');
    } else {
      intPart = parts[0];
      decPart = parts[1];
    }
  }

  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return NaN;
  if (intPart === '' && decPart === '') return NaN;
  if (intPart.length > 13) return NaN;
  const v = parseInt(intPart || '0', 10) * 100 + parseInt((decPart + '00').slice(0, 2), 10);
  return neg ? -v : v;
}

const pad = n => String(n).padStart(2, '0');

/** Yerel saat diliminde YYYY-MM-DD */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() { return isoDate(new Date()); }

export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** "2026-11-06" -> "Bugün" | "Dün" | "6 Kasım 2026, Cuma" */
export function formatDateLabel(iso) {
  const today = new Date();
  const yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (iso === isoDate(today)) return 'Bugün';
  if (iso === isoDate(yest)) return 'Dün';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const yearPart = y === today.getFullYear() ? '' : ` ${y}`;
  return `${d} ${MONTHS[m - 1]}${yearPart}, ${DAYS[dt.getDay()]}`;
}

export function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
