# Ana Ekran ve Proje Kitaplığı TODO

- [x] **Uygulama her açılışta ana ekranı göstermeli.** Kullanıcı yeni proje oluşturabilmeli veya karttan kayıtlı projeyi açabilmeli; editörden ana ekrana dönebilmeli; projeler ve karakter kitaplığı ana ekrandan erişilebilir olmalıdır.

- [x] **Birden fazla proje kalıcı saklanmalıdır.** Projeler ad, güncelleme zamanı, ortam/harita, zaman çizelgesi ve 3D/2D sahne karakterlerini korur; yeniden adlandırma, kopyalama ve silme desteklenir. Legacy autosave “Son Çalışma” olarak içe alınır.

- [x] **Ortak karakter kitaplığı 3D ve 2D karakterleri desteklemelidir.** GLB modelleri ve spritesheet şablonları listelenir, önizlenir ve seçilen projeye eklenir; sahne yerleşimleri/transformları proje içinde korunur.

- [x] **Android ikili varlıkları uygulama özel `Animationer/` alanında saklanmalıdır.** İlk native açılışta `projects/`, `character-library/2d`, `character-library/3d` ve `temporary/` alt klasörleri hazırlanır. Proje manifestleri, proje/harita/karakter ikili dosyaları `Directory.Data/Animationer` altında tutulur. IndexedDB yalnız proje indeksi, dosya referansları ve migration işaretlerini saklar. Android’de sabit toplam kitaplık/proje asset bütçeleri uygulanmaz; gerçek kapasite cihaz alanı ve OS kotasıdır. Android uygulama verileri kaldırma sırasında silinebilir.

- [x] **Dosya I/O bellek dostu ve güvenli olmalıdır.** İkili dosyalar 256 KiB base64 parçalar halinde geçici dosyaya yazılır; byte boyutu ve her parça byte-byte doğrulanır; ancak sonra hedef dosya adına geçirilip metadata/manifest başvurusu kaydedilir. Eski kaynak kayıtları geçiş tamamlanana kadar korunur. Karakter kitaplığı ana ekranda metadata-only listelenir; yalnız seçilen/aktif varlık gerektiğinde okunur. Eksik dosya ve disk doluluğu hataları raporlanır, eski geçerli kayıt korunur.

- [x] **Geriye uyumluluk ve web fallback korunmalıdır.** IndexedDB Blob kayıtları Android’de proje/karakter bazında, tekrarlanabilir ve kaynak veriyi güvenli tutan geçişle dosyaya taşınır. Web/PWA ve Electron IndexedDB davranışını sürdürür. Proje JSON içe/dışa aktarma akışı korunur.

- [x] **Otomatik regresyon doğrulaması.** Proje CRUD, migration, dosya deposu, parçalı yazma/okuma, disk doluluğu, eksik dosya, 250 MiB üzeri karakter kitaplığı ve Android’de 100 MiB üzeri proje varlık testi; lint ve production build kontrolleri bulunur.

- [ ] **Fiziksel Android doğrulaması.** JDK `javac` içeren tam JDK ve Android SDK/Build Tools bulunan ortamda `./gradlew assembleDebug` veya `npx cap build android` çalıştırılmalı; gerçek cihaz/emülatörde dosya oluşturma, varlık yükleme, yeniden başlatma sonrası açma ve depolama doluluğu smoke testi yapılmalıdır.

## Güncel doğrulama kaydı

- `npm test`: **97 test geçti**, 0 başarısız.
- `npm run lint`: başarılı (`tsc --noEmit`).
- `npm run build`: başarılı.
- `git diff --check`: başarılı.
- `npx cap add android`: başarılı; Android projesi oluşturuldu ve `@capacitor/filesystem@8.1.5` ile `@capacitor/share@8.0.3` Android pluginleri bulundu.
- `npx cap sync android`: başarılı; üretim assetleri kopyalandı ve pluginler Android projesine eklendi.
- `./gradlew assembleDebug`: ortamda yalnız JRE bulunduğu için başarısız; Gradle `/usr/lib/jvm/java-21-openjdk-amd64` JDK kurulumunda `JAVA_COMPILER` bulamadı (`javac` yok). `ANDROID_HOME`/`ANDROID_SDK_ROOT` ve Android SDK platform/build-tools da kurulu değil. Bu nedenle gerçek APK/emülatör/device smoke testi henüz yapılamadı.

## Kapsam notu

Android `Directory.Data` uygulamaya özel, diğer uygulamalardan gizli depolamadır; herkese açık `Download` klasörü değildir ve uygulama kaldırılırsa işletim sistemi tarafından silinir. Web/PWA ve Electron ortamlarında uygulama klasörü oluşturulmaz; IndexedDB kullanımı devam eder. Hiçbir fiziksel cihazda depolama sınırsız değildir; Android’de uygulama tarafından konmuş toplam kütüphane/proje asset kotası yoktur.
