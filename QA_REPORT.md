# Animationer — QA ve düzeltme raporu

**Tarih:** 24 Ekim 2026  
**Depo/dal:** `selim4747/animationer`, `fix/qa-issues` → `main`  
**Kapsam:** Önceki kullanıcı test raporundaki açık kamera, karakter spawn, engel yönetimi ve timeline stop bulguları.  
**Sonuç:** Kod düzeltmeleri tamamlandı; yeni PR için test ve build başarılı. Gerçek 390×844/844×390 cihaz viewport QA’sı ve IndexedDB dışı harita/model/ayar kalıcılığı hâlâ kapsam dışı/açık.

## Çözülen bulgular

| Bulgu | Düzeltme | Kanıt |
|---|---|---|
| Ayrı CCTV mini görünümü yoktu | Ana sahneyle aynı Three.js sahnesini bağımsız sabit `PerspectiveCamera` ile scissor viewport’ta render etme; Kamera sekmesine erişilebilir aç/kapat, sol üst güvenli alanda responsive inset ve etiket eklendi. | Tarayıcıda aç/kapat, görüntü alanı ölçüsü ve canlı canvas renderı kontrol edildi. |
| Ön/Yan/Üst/İzometrik presetleri yoktu | Dört yumuşak geçişli kadraj eklendi; kamera istasyon sayısını değiştirmeden aktif durumu güncelliyor. | Dört düğme DOM’da; Ön ve Üst seçimi sonrası HUD etiketi doğrulandı. |
| Yeni karakterler engel/aktör içine doğabilirdi | `CharacterRoster`, yakındaki serbest noktaları halka düzeninde arıyor; kayıtlı obstacle kutuları, zemin yüksekliği ve mevcut karakterlerle çarpışmayı denetliyor. Boş yer yoksa hiçbir karakter eklemeden anlaşılır hata veriyor. | Serbest obstacle noktası ve tüm adayların kapalı olduğu senaryolar için regresyon testleri. |
| Engel kutuları yalnızca topluca silinebiliyordu | Sahne sekmesinde kutu pozisyon/ölçü listesi ve tekil silme; collider kaydı ve alt tel-kafes geometrileri temizleniyor. | Tarayıcıda ekle → listede göster → tekil sil testi ve CollisionManager testi. |
| “Başa Sar” sahne durumunu geri alıyor izlenimi veriyordu | Buton “Durdur” olarak adlandırıldı; metin ve bildirim artık yalnızca aktif oynatımı/işaretçiyi durdurduğunu, karakter/kapının bulunduğu yerde kaldığını açıklıyor. | DOM metni ve aktif `MOVE_TO` stop regresyon testi. |
| Mobil tarayıcı dinamik yüksekliği değişince canvas eskide kalabilirdi | Resize dinleyicileri `visualViewport` ve `ResizeObserver` ile tamamlandı; `100dvh` desteği eklendi; mini pencere mobil breakpoint’lerinde küçülüyor. | Build ve mevcut responsive testleri; gerçek cihaz viewport’u ayrıca denenmedi. |

## Değişen ana dosyalar

`CameraManager.js`, `CharacterRoster.js`, `CollisionManager.js`, `MapLoader.js`, `UIManager.js`, `main.js`, `studio-panel.html`, `style.css`, `index.html`; ayrıca `ViewportLayout.js` ve `test/qa-fixes.test.js` eklendi. Önceki PR hazırlığından gelen Vite `allowedHosts` düzeltmesi ve `QA_REPORT.md` de dalda bulunuyor.

## Doğrulama

- `npm test`: **50/50 geçti** (Three spritesheet zamanlama regresyon testi dahil).
- `npm run build`: başarılı; Three.js kod bölme etkinleştirildi, 500 kB üstü chunk uyarısı yok.
- `npm run lint`: başarılı.
- `git diff --check`: temiz.
- Tarayıcıda: dört kamera preset düğmesi, Ön/Üst HUD durumu, CCTV aç/kapat ve inset boyutu; tekil engel ekleme/silme denendi.
- Gerçek cihaz testi yapılmadı; aşağıdaki follow-up testleri Chromium mobil emülasyonunda çalıştırıldı.

## Follow-up doğrulaması (24 Ekim 2026)

- Chromium touch emülasyonunda **390×844 portre** ve **844×390 yatay** boyutlarında `innerWidth`, `visualViewport`, container ve WebGL canvas backing-store ölçüleri kontrol edildi; yön değişiminde eski ölçüde kalma sorunu giderildi.
- UI’dan üç ayrı **4×2 (8 kare)** PNG spritesheet yüklendi. Zamanlı adımlar `QA_Sprite_A` (0.0s), `QA_Sprite_B` (0.25s), `QA_Sprite_C` (0.5s) olarak, her biri 0.8s süreyle oynatıldı; canlı arayüzde üç adımın da aktif olduğu gözlendi.
- Arayüzdeki **“Rejiyi Oynat ve Kaydet (Otomatik)”** düğmesiyle WebM indirildi. `ffprobe` çıktısı **VP9, 390×844** gösterdi; `ffmpeg` tüm dosyayı hatasız çözdü.
- Three.js modülleri Rolldown kod bölme ile **352.26 kB, 240.43 kB ve 65.05 kB** chunk’lara ayrıldı; build’in 500 kB uyarısı giderildi.
- `@capacitor/cli` güvenlik düzeltmesi için **8.4.3** sürümüne sabitlendi (Capacitor core/Android 8.5.3 olarak kaldı); `npm audit` **0 bulgu** verdi.

## Açık sınırlar

1. Mobil doğrulama gerçek Android/iOS cihazında değil Chromium emülasyonunda yapıldı; fiziksel cihazdaki tarayıcı adres çubuğu/OS inset davranışı ayrıca denenmeli.
2. Proje JSON ve IndexedDB kapsamı timeline + 2D sprite görselleriyle sınırlıdır. Harita, engeller, GLB modeller ve kamera/ışık tercihleri saklanmıyor; uygulamadaki uyarılar bu sınırı açıkça belirtmeye devam ediyor.
