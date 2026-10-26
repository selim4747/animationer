# Animationer Ana Ekran ve Proje Kitaplığı Planı

## Amaç
Uygulama her açıldığında kullanıcıyı bir ana ekranda karşılamak; birden fazla sahne/projeyi cihaz üzerinde kalıcı saklayıp kartlara dokunarak açmasını sağlamak; ortak 3D ve 2D karakter kitaplığından karakterleri görüp projelerde yeniden kullanabilmesini sağlamak.

## Onaylanmış ürün kararları
- Her uygulama açılışında ana ekran görünür; kullanıcı proje seçerek editöre geçer.
- Birden fazla sahne/proje kaydedilir ve ana ekrandaki kartlardan açılır.
- Karakter kitaplığı 3D GLB ve 2D dünya karakterlerini kapsar.
- Projeler ve karakter dosyaları bu sürümde aynı cihazın IndexedDB depolamasında kalır; bulut/cihazlar arası eşitleme kapsam dışıdır.
- Her proje kendi harita/ortamını, zaman çizelgesini ve sahneye yerleştirilmiş karakter örneklerini taşır; karakter kaynakları projeler arasında tekrar kullanılabilir.
- Proje işlemleri: oluştur, aç, yeniden adlandır, kopyala ve sil.

## Tasarım
Var olan Animationer monokrom kontrol odası görsel dili korunacak: siyah/kömür arka plan, beyaz ve gri tipografi, ince çizgiler, monospace meta bilgiler. Ana ekran editör HUD’undan daha sakin ve keşif odaklı olacak.

- **Hareket:** mevcut monokrom kontrol odası ve araç rafı.
- **İlkeler:** (1) projeye tek dokunuşla dön, (2) büyük görsel hedefler ve okunur adlar, (3) yerel kayıt durumunu görünür kıl, (4) mevcut 3D editör akışını bozmadan aç/kapat.
- **Yerleşim:** üstte marka/son kayıt durumu; ana alanda “Yeni Sahne” ve projeler; ayrı karakter kitaplığı bölümünde 3D/2D filtreleri ve seçili varlık önizlemesi. Telefonlarda tek sütun ve yatay kaydırılabilir varlık kartları.
- **İmza öğeleri:** büyük sahne kartları, ince teknik kenarlıklar ve küçük monospace proje/karakter etiketleri.
- **Etkileşim:** proje kartına tıklamak projeyi açar; ikincil menü düzenleme/kopyalama/silme işlemlerini açıkça ayırır. Silme öncesinde onay istenir.
- **Hareket:** kısa opaklık/konum geçişleri; azaltılmış hareket tercihi desteklenir; içerik animasyon beklemeden kullanılabilir.
- **Tipografi ve marka:** mevcut sistem fontu ve monospace metadata; “REJİ / STUDIO” markası korunur. Konumlandırma: sahne ve animasyon projelerini tek yerde saklayan mobil uyumlu 3D/2D stüdyo; pratik, net, teknik.

## Uygulama yaklaşımı
- `src/components/ProjectStore.js`: IndexedDB şema yükseltmesi; çoklu proje CRUD/metadata API’leri; ortak 3D GLB varlık deposu; eski tekli `autosave` kaydını silmeden ilk açılışta “Son Çalışma” projesine dönüştürme.
- `src/components/AutosaveCoordinator.js`: otomatik kayıtları açık proje kimliğine bağlama; açılışta otomatik editör yüklemesi yerine yalnızca seçilen projenin yüklenmesi.
- `src/components/CharacterRoster.js` ve `src/components/WorldSpriteCharacterManager.js`: 3D model varlık kimliği ile örnek transform/hareket ayarlarını dışa/içe alma; ortak kitaplıktan model ekleme; mevcut 2D şablon kaydını ortak kitaplık olarak kullanma.
- `src/components/MapLoader.js`: desteklenen yerel harita/ortam dosyalarını proje kaydına bağlama ve seçili projeye geri yükleme. Çok dosyalı harita biçimleri güvenli şekilde saklanamıyorsa arayüzde açık sınır gösterilecek; kayıt sessizce kaybolmayacak.
- `src/components/HomeScreen.js`: IndexedDB’den projeleri ve karakter metadata’sını yükleme, kartları/önizlemeleri çizme, oluştur/aç/yeniden adlandır/kopyala/sil ve editör/ana ekran geçişlerini yönetme.
- `src/main.js`, `index.html`, `src/ui/studio-panel.html`, `src/style.css`: ana ekranı uygulama başlangıcı yapma, editöre dönüş düğmesi ekleme, seçilen proje durumunu editör bileşenlerine aktarma ve responsive monokrom stiller.
- Testler: `ProjectStore` için çoklu kayıt/migration/library kapsamı; proje açma ve CharacterRoster serialize/restore regresyonları; başlangıç görünümü ve ana ekran işlemleri için uygun otomatik kontroller.

## Dosya yapısı
- `src/components/ProjectStore.js` — yerel proje ve karakter varlığı saklama.
- `src/components/AutosaveCoordinator.js` — açık projenin güvenli otomatik kaydı.
- `src/components/HomeScreen.js` — ana ekran ve proje/karakter kitaplığı kullanıcı arayüzü.
- `src/components/CharacterRoster.js` — 3D karakter yükleme, örnek kimliği ve konum geri yükleme.
- `src/components/WorldSpriteCharacterManager.js` — 2D dünya karakter şablon ve örnek durumu.
- `src/components/MapLoader.js` — proje harita varlığının yükleme/geri yükleme davranışı.
- `src/main.js`, `index.html`, `src/style.css`, `src/ui/studio-panel.html` — ekran geçişi, DOM kökleri, editör kontrolü ve responsive görünüm.
- `test/` — proje deposu, kaydetme/geri yükleme ve yardımcı bileşen regresyonları.

## Mevcut veriye uyumluluk
Şema sürümü artırılacak. İlk açılışta eski `autosave` kaydı varsa yeni çoklu proje kitaplığına yalnızca bir kez “Son Çalışma” adıyla kopyalanacak; eski kayıt başarılı kopya doğrulanana kadar silinmeyecek. Mevcut 2D karakter kitaplığı ve dışa/içe aktarma davranışı korunacak. Kayıt boyutu/yerel kota sınırları kullanıcıya anlaşılır mesajla iletilecek.
