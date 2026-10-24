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

- `npm test`: **49/49 geçti**.
- `npm run build`: başarılı; Vite, minify sonrası 500 kB üzerindeki tek bundle için uyarı verdi.
- `npm run lint`: başarılı.
- `git diff --check`: temiz.
- Tarayıcıda: dört kamera preset düğmesi, Ön/Üst HUD durumu, CCTV aç/kapat ve inset boyutu; tekil engel ekleme/silme denendi.
- Gerçek 390×844 portre ve 844×390 yatay viewport bu tarayıcı oturumunda ayarlanamadı; responsive CSS bu nedenle cihaz E2E kanıtı sayılmaz.

## PR’da açıkça belirtilen mevcut sınırlar

1. Mobil portre/yatay gerçek cihaz veya emüle viewport testi henüz yok.
2. Otomatik kayıt sonrası tam timeline videosunun uçtan uca oynatılabilirliği bu düzeltme dalında yeniden sınanmadı.
3. Otomatik kayıt şu an timeline ve 2D sprite varlıklarını saklıyor; özel harita/engel, GLB model ve kamera/sahne tercihleri proje kaydı/dışa aktarma kapsamına dahil değil. UI’daki kapsam açıklaması korunmalı.
4. Önceki `npm audit` kontrolü 3 orta önem seviyeli bağımlılık uyarısı göstermişti. Sürüm düşürme/uyumluluk kararı gerektirebileceğinden bağımlılıklar bu PR’da değiştirilmedi.
5. Build uyarısı: ana JS bundle 500 kB sınırını aşıyor; kod bölme ayrı optimizasyon işi olarak kalıyor.
