// IndexedDB için ince Promise sarmalayıcı.
// Tüm veri kayıtları { id, iv, ct } biçiminde ŞİFRELİ saklanır; düz metin yalnızca "meta" deposunda
// (tuz, sarılmış anahtar, PIN uzunluğu, deneme sayacı, son yedek zamanı) bulunur.

const DB_NAME = 'para-takip';
const DB_VERSION = 1;

// "recurring" deposu ileride eklenecek tekrarlayan işlemler için şimdiden oluşturuluyor.
export const DATA_STORES = ['accounts', 'categories', 'transactions', 'recurring'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      for (const s of DATA_STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Veritabanı başka bir sekmede açık.'));
  });
  return dbPromise;
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = t => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error('İşlem iptal edildi'));
});

export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, value) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).put(value);
  return txDone(t);
}

export async function del(store, key) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  return txDone(t);
}

/**
 * Birden çok işlemi TEK bir atomik transaction içinde uygular.
 * ops: [{ store, type: 'put'|'delete'|'clear', value?, key? }]
 * Not: Şifreleme gibi async işler bu çağrıdan ÖNCE yapılmalı (IDB transaction'ı await'te kapanır).
 */
export async function bulk(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map(o => o.store))];
  const t = db.transaction(stores, 'readwrite');
  for (const op of ops) {
    const os = t.objectStore(op.store);
    if (op.type === 'put') os.put(op.value);
    else if (op.type === 'delete') os.delete(op.key);
    else if (op.type === 'clear') os.clear();
  }
  return txDone(t);
}

/** Uygulamayı sıfırlamak için tüm depoları temizler. */
export async function wipeAll() {
  await bulk(['meta', ...DATA_STORES].map(store => ({ store, type: 'clear' })));
}
