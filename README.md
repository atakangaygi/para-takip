# Para Takip

iPhone için kişisel, tamamen cihazda çalışan ve verileri şifreli saklayan para takip PWA'sı.
HTML + CSS + vanilla JS; framework ve build adımı yok.

## Kurulum (GitHub Pages)

1. Repo → **Settings → Pages** → *Deploy from a branch* → branch: `main`, klasör: `/ (root)`.
2. Birkaç dakika sonra `https://<kullanıcı>.github.io/para-takip/` adresinde yayında olur.
3. iPhone'da **Safari** ile aç → Paylaş → **Ana Ekrana Ekle**. Ana ekrandan açınca tam ekran çalışır.

> Safari sekmesi ile ana ekran uygulamasının depolaması iOS'ta **ayrıdır**. Kurulumu ana ekran
> uygulamasında yap; Safari'de girdiğin verileri taşımak için JSON yedeği kullan.

Yerelde denemek için (Web Crypto HTTPS veya `localhost` ister):

```bash
python3 -m http.server 8000
```

## Güncelleme

Dosyaları değiştirdikten sonra `sw.js` içindeki `CACHE` sürümünü artır (ör. `para-takip-v1.0.1`).
Aksi halde service worker eski dosyaları sunmaya devam eder. Yeni sürüm, uygulama bir sonraki
açılışta devreye girer.

## Güvenlik modeli

- PIN'den **PBKDF2-SHA256 (600.000 tur)** ile anahtar türetilir; bu anahtar rastgele üretilmiş
  256-bit bir veri anahtarını (DEK) **AES-GCM** ile sarar. Tüm kayıtlar DEK ile AES-256-GCM
  şifrelenir (her kayıt `depo:id` ek doğrulama verisiyle bağlanır).
- PIN değişince yalnızca DEK yeniden sarılır; veriler yeniden şifrelenmez.
- Düz metin olarak yalnızca tuz, sarılmış anahtar, PIN uzunluğu, hatalı deneme sayacı ve son
  yedek zamanı tutulur.
- 5 hatalı denemeden sonra artan bekleme süresi uygulanır (30 sn → en fazla 15 dk).
- Açılışta ve 1 dakikadan uzun arka planda kalınca PIN sorulur; uygulama değiştiricide bakiyeler gizlenir.
- **PIN unutulursa veri kurtarılamaz.** Düzenli JSON yedeği al. Yedek dosyası **şifresizdir**.
- Sınır: 4–6 haneli PIN'in olası kombinasyon sayısı az olduğundan, cihazın veritabanı dosyasını
  ele geçiren kararlı bir saldırgan PBKDF2'ye rağmen PIN'i deneme-yanılmayla bulabilir. Şifreleme
  esas olarak meraklı erişime ve veri dosyasının tek başına okunmasına karşı koruma sağlar;
  asıl koruma iPhone'un kendi kilidi ve cihaz şifrelemesidir.

## Veri modeli

Tutarlar **kuruş cinsinden tam sayı** (`12450,00 TL` → `1245000`), tarihler yerel `YYYY-MM-DD`.

| Depo | Alanlar |
|---|---|
| `accounts` | `id, name, initialBalance, order, createdAt, updatedAt` |
| `categories` | `id, type ('income'\|'expense'), name, order, createdAt` |
| `transactions` | `id, type ('income'\|'expense'\|'transfer'), amount (>0), date, accountId, toAccountId, categoryId, note, recurringId, createdAt, updatedAt` |
| `recurring` | İleride tekrarlayan işlemler için ayrıldı (şu an boş) |

Bakiye = `initialBalance + gelirler − giderler + gelen transferler − giden transferler`.
Transferler gelir/gider sayılmaz ve toplamı değiştirmez. Aylık grafikler `type`, `date` ve
`categoryId` üzerinden, tekrarlayan işlemler `recurring` deposu + `recurringId` ile eklenebilir.

## Dosyalar

```
index.html            uygulama kabuğu, iOS meta etiketleri, CSP
css/style.css         karanlık tema, safe-area
js/app.js             arayüz, PIN akışı, yedekleme
js/crypto.js          PBKDF2 + AES-GCM (Web Crypto)
js/db.js              IndexedDB sarmalayıcı
js/format.js          ₺ biçimlendirme, tutar ayrıştırma, tarih
sw.js                 çevrimdışı önbellek
manifest.webmanifest  PWA manifest
icons/                uygulama ikonları
```
