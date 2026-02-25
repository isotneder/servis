# Alpozler Kahramankazan Servis Takip Programi

Bu proje Netlify/GitHub Pages uzerinde calisan statik bir web uygulamasidir.
Iki rol vardir:
- `driver.html`: Sofor yonetim ekrani
- `index.html`: Eleman takip ekrani

Sistem tek servis mantigi ile calisir. Servis secimi veya baglan butonu yoktur.

## Ozellikler
- Sofor ekraninda canli harita
- Sofor ekraninda eleman ekleme + elemanin evi/duragi (haritadan secim)
- Duraklarin Firebase'e kaydedilmesi
- Eleman ekraninda kendi duragini secip servisi izleme
- Bugun `gelecek / gelmeyecek` durumunu yalnizca soforun yonetmesi
- Sofor konum paylasmiyorsa eleman ekraninda otomatik uyari
- Servis duraga yaklasinca sesli bildirim

## Veri yapisi (Firebase Realtime Database)
- `buses/{singleServiceId}/live`: Servisin anlik konumu
- `buses/{singleServiceId}/employees/{employeeId}`: Eleman + durak bilgisi
- `buses/{singleServiceId}/attendance/{yyyy-mm-dd}/{employeeId}`: Gunluk katilim durumu

## Lokal calistirma
1. Bu klasorde terminal ac:
   - `python -m http.server 5173`
2. Tarayici:
   - `http://localhost:5173`

## Deploy
1. Netlify: klasoru `https://app.netlify.com/drop` alanina surukle-birak
2. GitHub Pages: repoya yukle, `Settings > Pages` ile yayinla

## Canli kullanim (ucretsiz)
Canli olarak sofor-eleman senkronu icin Firebase gereklidir.

1. Firebase Spark (ucretsiz) proje ac
2. Realtime Database etkinlestir
3. `config.js` dosyasinda `firebase.config` alanlarini doldur
4. `config.js` icinde `firebase.enabled = true` yap
5. Gerekirse `config.js` icindeki `singleServiceId` degerini degistir
6. Istersen `driverOfflineTimeoutMs` ile \"sofor paylasmiyor\" uyarisinin gecikmesini ayarla
7. Sofor `driver.html` sayfasinda canli konum paylasimini baslatsin
8. Sofor, elemanlar icin bugun durumunu `driver.html` uzerinden ayarlasin
9. Elemanlar `index.html` acip direkt takip etsin

## Notlar
- HTTPS gerekli (Netlify/GitHub Pages bunu saglar)
- Konum ve sesli bildirim tarayici izni ister
- Firebase kapaliyken canli takip calismaz
