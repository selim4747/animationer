# Animationer Ana Ekran ve Proje Kitaplığı Planı

## Amaç
Uygulama her açıldığında kullanıcıyı ana ekranda karşılamak; birden fazla sahne/projeyi cihaz üzerinde kalıcı saklayıp kartlara dokunarak açmasını sağlamak; ortak 3D ve 2D karakter kitaplığından karakterleri görüp projelerde yeniden kullanabilmesini sağlamak. Android sürümünde büyük ikili varlıkları uygulamaya özel dosya sisteminde tutarak kitaplık büyüdükçe tüm dosyaların JavaScript belleğine alınmasını önlemek.

## Onaylanmış ürün kararları
- Her uygulama açılışında ana ekran görünür; kullanıcı proje seçerek editöre geçer.
- Birden fazla sahne/proje kaydedilir ve ana ekrandaki kartlardan açılır.
- Karakter kitaplığı 3D GLB ve 2D dünya karakteri spritesheet şablonlarını kapsar.
- Android’de ilk uygulama açılışında uygulama özel depolama alanında `Animationer/` ve `projects/`, `character-library/`, `temporary/` alt klasörleri hazırlanır. Bu konum diğer uygulamalara kapalıdır ve kaldırma sırasında Android tarafından silinir.
- Android’de proje, harita ve karakter ikili dosyaları bu klasör yapısında tutulur; `project.json` manifestleri aynı proje klasörlerinde bulunur. IndexedDB yalnızca hızlı proje indeksi, manifest/dosya referansları ve geçiş işaretlerini saklar; dosya içeriğinin kopyasını tutmaz.
- Karakter kitaplığı için uygulama tarafından konan toplam byte sınırı kaldırılır; gerçek kapasite cihazın kullanılabilir depolama alanıyla sınırlıdır. Tek bir varlığın dosya/format doğrulaması ve belleğe alma güvenliği sınırları korunur.
- Büyük dosyalar diske sabit boyutlu parçalarla yazılır; kitaplık listelerinde yalnız metadata okunur. Önizleme veya proje açılışı yalnız gereken varlığı/aktif projenin varlıklarını okur. Render edilen aktif karakter/texture’ın GPU ve çalışma belleği kullanımı kaçınılmazdır; hedef, kullanılmayan kitaplık öğelerini heap’te tutmamaktır.
- Web/PWA ve Electron çalıştırmalarında mevcut IndexedDB davranışı korunur; bu platformlarda Android’e özel görünür/özel klasör sözü verilmez.
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
- `src/storage/AppPrivateFileStore.js`: Capacitor Android `Directory.Data/Animationer` dizinlerini ilk açılışta oluşturma; uygulama içi güvenli yollar; Blob’ları sabit boyutlu base64 parçalarıyla geçici dosyaya yazıp boyut doğrulaması sonrasında adlandırma; yalnız istenen dosyayı okuma/silme. Web/Electron’da etkin olmaz.
- `src/components/ProjectStore.js`: Android’de büyük Blob’ları diskte dosya olarak tutma, proje JSON manifestlerini proje klasörlerine yazma ve IndexedDB’ye yalnız referans/indeks kaydetme; native ilk yüklemede eski Blob kayıtlarını kopya-doğrula-yönlendir biçiminde, kaynak kayıtları korunarak taşıma. Native kitaplıkta toplam sabit boyut sınırı uygulamama; fiziksel doluluk ve I/O hatalarını anlaşılır biçimde gösterme. Web/Electron IndexedDB uyumluluğunu koruma.
- `src/components/AutosaveCoordinator.js`: açık proje kimliği üzerinden mevcut kayıt API’sini kullanmaya devam etme; kayıt fingerprint’i dosya referanslarıyla çalışacak, her autosave sırasında aynı ikili veriyi tekrar kopyalamama.
- `src/components/CharacterRoster.js` ve `src/components/WorldSpriteCharacterManager.js`: kitaplık listelerini metadata ile tutma; proje açma/önizlemede tek gerekli GLB/spritesheet kaynağını yükleme; etkin Three.js kaynaklarını kaldırma sırasında dispose etme.
- `src/components/MapLoader.js`: proje harita varlığını proje dosya alanında saklama/geri yükleme; desteklenmeyen çok dosyalı `.gltf` biçimi için mevcut açık hata davranışını koruma.
- `src/components/HomeScreen.js`: proje ve karakter metadata’sı ile render etme; tek seçili varlık önizlemesi; uygulama özel depolama alanı kapasite hatalarını kullanıcıya aktarma.
- `src/main.js`, `index.html`, `src/style.css`: mevcut ana ekran ve editör akışını koruma, Android depolama hazırlığını uygulama açılışında proje/kitaplık okumasından önce tamamlatma.
- Testler: dosya yazma/okuma parçaları, güvenli yollar, native dosya referansı, metadata-only kitaplık listeleme, eski IndexedDB varlıklarının güvenli geçişi/tekrar denemesi ve web fallback.

## Dosya yapısı
- `src/storage/AppPrivateFileStore.js` — Android uygulama özel dosya operasyonları.
- `src/components/ProjectStore.js` — IndexedDB proje indeksi, manifests ve ortak varlık API’leri.
- `src/components/AutosaveCoordinator.js` — açık projenin güvenli otomatik kaydı.
- `src/components/HomeScreen.js` — ana ekran ve proje/karakter kitaplığı UI.
- `src/components/CharacterRoster.js` — 3D karakter örnekleri ve transform geri yükleme.
- `src/components/WorldSpriteCharacterManager.js` — 2D dünya karakteri kütüphanesi ve örnekleri.
- `src/components/MapLoader.js` — proje ortam varlıkları.
- `src/main.js`, `index.html`, `src/style.css` — giriş, ekran akışları ve responsive UI.
- `test/` — IndexedDB, dosya adaptörü, migration ve karakter varlık regresyonları.

## Mevcut veriye uyumluluk
Şema sürümü artırılacak. Android’de eski `autosave`, proje ve karakter Blob’ları parça parça `Animationer/` alanına yazılacak; boyut doğrulaması, manifest/ref kaydı ve yeniden okunabilirlik teyidi bitmeden eski IndexedDB kaynağı silinmeyecek. Kesilen geçişler tekrar çalıştırılabilir olmalı. Web/Electron’da mevcut IndexedDB verisi yerinde kalır. Gerçek depolama kotası/kalan alan ve varlık başına doğrulamalar korunur; Android uygulama verileri kaldırma sırasında işletim sistemi tarafından silinebilir.
