# Animationer Ek Keşif Testi ve Geliştirme Önerileri

**Tarih:** 8 Kasım 2026
**Test kapsamı:** Önceki kullanıcı akışlarına ek olarak sahne düzenleme geçmişi, timeline undo/redo ve cetvel görünümü, 320 px mobil kontroller, klavye odağı ve gerçek PNG/video dışa aktarma.
**Ortam:** Sandbox Chromium + yerel Vite; mobil viewport emülasyonu 320×640. Fiziksel cihaz veya gerçek katılımcı kullanılmadı. Test öncesi ve sonrası yalnızca `http://127.0.0.1:3000` uygulama origin verisi temizlendi.

## Sonuç özeti

Ek keşif akışında 9 UI assertion’ının 7’si geçti, 2’si başarısız oldu. Başarısızlıklar iki farklı, yeniden üretilebilir kullanıcı sorunu gösteriyor: sahne ekleme/renk işlemleri undo geçmişine girmiyor ve mobilde çok sayıda işlem düğmesi 44 px hedef boyutunun altında kalıyor. Ayrıca PNG ve video dosyaları oluştuğu hâlde UI her ikisini de “kaydedilemedi” şeklinde raporladı.

Uygulama kaynakları değiştirilmedi; commit veya PR oluşturulmadı. Tam regresyon paketi **163/163**, build ve lint kontrolleri başarılı.

## Test edilen akışlar

| Akış | Sonuç | Kanıt / gözlem |
|---|---|---|
| Primitive ekleme ve otomatik seçme | Başarılı | Boş sahneye kutu eklendi, seçili nesne oldu ve hierarşide listelendi. |
| Sayısal dönüşüm | Başarılı | Nesne (1, 2, 3) konumuna taşındı; undo başlangıç konumuna, redo tekrar yeni konuma getirdi. |
| Renk ve sahne undo geçmişi | **Başarısız / kapsam boşluğu** | Renk `#ff0000` yapıldığında `canUndo` false kaldı; Undo düğmesi pasifti. Primitive ekleme de undo kaydı oluşturmadı. Sonraki konum dönüşümü undo edildiğinde renk kırmızı kalmaya devam etti. |
| Sahne verisi persistence | Başarılı | Kutu, kırmızı rengi ve (1, 2, 3) konumu proje ana ekranından yeniden açıldıktan sonra korundu. |
| Timeline undo/redo | Başarılı | “2s Bekle” adımı eklendi, undo ile silindi, redo ile geri geldi. |
| Liste / zaman cetveli geçişi | Başarılı | Görünüm düğmesi `aria-pressed` durumunu değiştirdi ve cetvel görünür oldu. |
| Klavye odağı | Temel kontrol başarılı | `Tab` ile odak `BODY`’ye düşmeden odaklanabilir timeline paneline geçti. Bu tam klavye erişilebilirliği denetimi değildir. |
| 320×640 mobil düzen | Yatay taşma yok; hedef boyutları **başarısız** | `documentElement.scrollWidth` 320 px kaldı; ancak çok sayıda aktif işlem hedefi 44 px’den küçük. |
| PNG dışa aktarma | Dosya oluştu; durum mesajı **yanlış** | Demo sahnesi PNG’si 1280×1100 px olarak indirildi; 768 benzersiz RGB değeri vardı ve sahne/tek renk arka planı görüntüye işlendi. Toast “PNG ekran görüntüsü cihaza kaydedilemedi” dedi. |
| Video kaydı | WebM üretildi; durum mesajı **yanlış** | 27,206 byte VP9 WebM oluştu ve FFmpeg tarafından yaklaşık 1.02 saniye/5 kare olarak çözülebildi. UI “Video cihaza kaydedilemedi” gösterdi. Headless render yüzünden bu kare hızı gerçek cihaz performansı için ölçüt değildir. |

## Doğrulanmış bulgular

### P2 — Sahne ekleme ve renk değişikliği undo/redo kapsamında değil

**Yeniden üretme:** Boş proje açın → Scene sekmesinde “+ Ekle” ile primitive oluşturun → rengini değiştirin → “Sahne Geri Al” durumunu kontrol edin.

Primitive oluşturulduktan ve rengi değiştirildikten sonra sahne history boş kalıyor ve Undo pasif. Konum/dönüş/ölçek değişimi ise history’ye giriyor ve undo/redo çalışıyor. Rengi geri çevirmek için kullanıcı rengi elle bulup yeniden seçmek zorunda; eklenen primitive de ayrı bir undo eylemiyle kaldırılamıyor.

**Kullanıcı etkisi:** Kullanıcı aynı “Sahne Geri Al/Yinele” kontrolünün sahne düzenlemelerini geri alacağını bekler; işlem türüne göre değişen, açıklanmayan history davranışı hata sonrası güveni düşürür. Bu, özellikle ekleme ve renklendirme gibi geri çevrilmesi beklenen düzenlemelerde veri kaybı veya elle onarım riski yaratır.

**Öneri:** Sahne düzenleyici history’sini tipli komutlar olarak genişletin: `add/remove`, `transform`, `color`, `rename`, `visibility/lock` ve çoklu seçim/batch işlemleri. Alternatif olarak düğme açıklamasında desteklenen kapsamı açıkça “dönüşümü geri al” olarak daraltın. Tercih edilen çözüm, tüm kullanıcı tarafından yapılan sahne düzenlemelerini tek bir undo/redo geçmişinde tutmaktır.

**Test boşluğu:** Mevcut `test/scene-editing.test.js` dönüşüm undo/redo’sunu ve renk persistence/material izolasyonunu test ediyor; ancak UI üzerinden primitive ekleme/silme ve renk değişikliği sonrasında undo/redo davranışını test etmiyor.

### P2 — Mobil işlem düğmelerinde 44 px dokunma hedefi tutarlı değil

**Yeniden üretme:** Stüdyoyu 320×640 mobil viewport’ta açın; Timeline, Scene ve Camera sekmelerindeki aktif düğmeleri ölçün.

Yatay taşma oluşmadı ve sekme düğmeleri 44 px yüksekliğinde kaldı. Buna karşılık ölçülen bazı hedefler şunlardı:

- Timeline adım kartı eylemleri (yukarı/aşağı/çoğalt/sil): **22×22 px**.
- Kamera istasyonu yenile/adlandır/sırala düğmeleri: **36×36 px**.
- Sahne seçimi, uygula, reset, scene undo/redo ve primitive “+ Ekle”: **38 px yükseklik**.
- “2s Bekle”, “Kapı Tetikle”, kamera presetleri ve karakter emote’ları gibi `small-btn` kontrolleri: **40 px yükseklik**.

**Kullanıcı etkisi:** 320 px ekranda bu düğmeler küçük ve birbirine yakın; yanlış hedefe dokunma olasılığı artıyor. 22×22 px timeline ikonları özellikle güç kullanımını ve hareket doğruluğunu zorlaştırabilir.

**Öneri:** Mobil breakpoint’te tüm işlem hedeflerine en az 44×44 px hit-area verin. Görsel ikon 22–36 px kalabilir; padding ile gerçek tıklama alanı büyütülebilir. Sık kullanılan step actions için aralık ekleyin veya satır içi ikonları daha geniş bir aksiyon menüsüne taşıyın.

**Test boşluğu:** Mobil testleri yalnız sekme düğmelerine değil, her paneldeki görünür/etkin `button` elemanlarına da en az 44×44 px assert’i uygulamalı.

### P2 — Tarayıcı indirmesi başarılı olsa da UI başarısız diyor

**Yeniden üretme:** Render sekmesine geçin → 720p/HD uzun kenar ve tek renk arka plan seçin → PNG alın; ardından video kaydı başlatıp durdurun.

Tarayıcı dışa aktarma yardımcısı `method: 'browser'`, `initiated: true`, `saved: false` döndürüyor. Bu, tarayıcı indirmesinin başlatıldığını belirtir; uygulama işletim sisteminin dosyayı diske yazdığını doğrudan doğrulayamaz. PNG dosyası gerçekten indirildi ve görsel sahne içeriği taşıdı; WebM de üretildi ve çözülebildi. Buna rağmen kullanıcı toast/status mesajı “cihaza kaydedilemedi” dedi.

**Kök neden:** `UIManager.js` içindeki `saveResultMessage()` önce `!result.saved` koşuluyla başarısızlık metnine dönüyor; `method === 'browser'` için “indiriliyor” mesajı üreten kontrol bu koşuldan sonra kaldığından erişilemiyor. Böylece `initiated: true` sonucu kullanıcıya yanlış gösteriliyor.

**Öneri:** `method === 'browser'` veya `initiated === true` durumunu `!saved` kontrolünden önce ele alın ve “Tarayıcı indirmesi başlatıldı — İndirilenler klasörünü kontrol edin” gibi net bir mesaj gösterin. Bu mesajı “dosya kesin kaydedildi” ifadesinden ayırın. PNG ve video için aynı durum mesajı fonksiyonunu kullanın.

**Test boşluğu:** `saveGeneratedFile` için `saved:true`, browser `initiated:true`, iptal ve gerçek hata sonuçlarını kapsayan mesaj/arayüz testleri ekleyin. UI testi hem dosya üretimini hem gösterilen son mesajı doğrulamalı.

## Eklenebilecek özellikler — testle kanıtlanan ihtiyaçlara göre

1. **Tutarlı sahne undo/redo:** Ekleme, silme, renk, adlandırma, görünürlük ve dönüşümleri geri alınabilir hâle getirme. Bu, yeni bir özellikten çok mevcut affordance’ın kapsamını tamamlar.
2. **Mobil aksiyon düzeni:** 44 px hit-area, gruplandırılmış timeline/camera aksiyonları ve daha az hatalı dokunma için aralık/overflow yönetimi.
3. **İndirme durumu ve dosya erişimi:** Başlatıldı, iptal edildi, tamamlandı/başarısız durumlarını ayrı gösterme; mümkün olduğunda “İndirilenler klasörünü aç” veya yeniden dene bağlantısı.
4. **Timeline hızlı düzenleme:** Mevcut cetvel/listenin yanına playhead sürükleme, seçili adımları toplu taşıma ve daha geniş mobil adım eylemleri ekleme. Bu bir ürün fırsatıdır; keşif testi timeline’in temel undo/redo ve görünüm geçişini doğruladı ama playhead/scrub davranışını bu turda kapsamlı sınamadı.
5. **Başlangıç yardımı:** Önceki rapordaki eksik “Yardım & Bilgi” penceresi ve sahne şablonu önizlemeleri hâlâ öneri olarak geçerlidir.

## Regresyon ve sınırlar

- `npm test`: **163 geçti, 0 başarısız**.
- `npm run build`: başarılı.
- `npm run lint`: başarılı.
- Bu ek testler kaynak kodu değiştirmedi; rapor dosyaları dışında uygulama değişikliği yok.
- Mobil boyutlar Chromium emülasyonudur; gerçek Android/iOS cihazında dokunma ve performans doğrulaması gerekir.
- PNG’de “HD · uzun kenar 1280 px” seçeneği kaynak en-boy oranını koruduğundan 1280×1100 üretti. Arayüz bu davranışı “uzun kenar 1280 px” ve oran açıklamasıyla belirtiyor; bu testte boyut hesaplama hatası bulunmadı.

## Sonuç

En yüksek değerli iyileştirmeler: (1) sahne history’sine primitive/renk işlemlerini dahil etmek, (2) mobil işlem hedeflerini 44 px’e çıkarmak ve (3) tarayıcı indirme başarısını yanlış “kaydedilemedi” mesajından ayırmak. Bu üçü için küçük, ayrı regresyon testleri eklenmesi önerilir. Kod değişikliği veya PR bu turda yapılmadı.
