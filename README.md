# Alpozler Kahramankazan Servis Takip Programı

Bu proje Netlify/GitHub Pages üzerinde çalışan statik bir web uygulamasıdır.
İki rol vardır:
- `driver.html`: Şoför yönetim ekranı
- `index.html`: Eleman takip ekranı

Sistem tek servis mantığı ile çalışır. Servis seçimi veya bağlan butonu yoktur.

## Özellikler
- Şoför ekranında canlı harita
- Şoför ekranında eleman ekleme + elemanın evi/durağı (haritadan seçim)
- Durakların Firebase'e kaydedilmesi
- Eleman ekranında kendi durağını seçip servisi izleme
- Bugün `gelecek / gelmeyecek` durumunu yalnızca şoförün yönetmesi
- Şoför konum paylaşmıyorsa eleman ekranında otomatik uyarı
- Servis durağa yaklaşınca sesli bildirim

## Veri yapısı (Firebase Realtime Database)
- `buses/{singleServiceId}/live`: Servisin anlık konumu
- `buses/{singleServiceId}/employees/{employeeId}`: Eleman + durak bilgisi
- `buses/{singleServiceId}/attendance/{yyyy-mm-dd}/{employeeId}`: Günlük katılım durumu

## Yerel çalıştırma
1. Bu klasörde terminal aç:
   - `python -m http.server 5173`
2. Tarayıcı:
   - `http://localhost:5173`

## Dağıtım
1. Netlify: klasörü `https://app.netlify.com/drop` alanına sürükle-bırak
2. GitHub Pages: repoya yükle, `Settings > Pages` ile yayınla

## Canlı kullanım (ücretsiz)
Canlı olarak şoför-eleman senkronu için Firebase gereklidir.

1. Firebase Spark (ücretsiz) proje aç
2. Realtime Database etkinleştir
3. `config.js` dosyasında `firebase.config` alanlarını doldur
4. `config.js` içinde `firebase.enabled = true` yap
5. Gerekirse `config.js` içindeki `singleServiceId` değerini değiştir
6. İstersen `driverOfflineTimeoutMs` ile "şoför paylaşmıyor" uyarısının gecikmesini ayarla
7. Şoför `driver.html` sayfasında canlı konum paylaşımını başlatsın
8. Şoför, elemanlar için bugün durumunu `driver.html` üzerinden ayarlasın
9. Elemanlar `index.html` açıp direkt takip etsin

## Notlar
- HTTPS gerekli (Netlify/GitHub Pages bunu sağlar)
- Konum ve sesli bildirim tarayıcı izni ister
- Firebase kapalıyken canlı takip çalışmaz
