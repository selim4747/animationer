# Ana Ekran ve Proje Kitaplığı TODO

- [x] **Uygulama her açılışta ana ekranı göstermeli.** Kullanıcı ana ekranda “Yeni Proje” oluşturabilmeli veya kayıtlı bir proje kartına dokunarak o projeyi açabilmeli; editörden tekrar ana ekrana dönebilmelidir. Ana ekranda projeler ve karakter kitaplığı erişilebilir olmalıdır.

- [x] **Birden fazla proje aynı cihazda kalıcı saklanmalıdır.** Her proje kendi adı ve güncelleme zamanını, harita/ortamını, zaman çizelgesini ve sahneye yerleştirilmiş 3D/2D karakterlerini korumalı; ana ekrandaki proje düğmesi doğru projeyi açmalıdır. Kullanıcı projeyi yeniden adlandırabilmeli, kopyalayabilmeli ve silme onayıyla silebilmelidir. Önceden var olan tekli otomatik kayıt ilk açılışta korunarak “Son Çalışma” projesi olarak içe alınmalıdır.

- [x] **Ortak karakter kitaplığı hem 3D hem 2D karakterleri göstermelidir.** 3D GLB modelleri ve 2D dünya karakteri spritesheet şablonları oturumlar arasında cihazdaki IndexedDB’de saklanmalı; ana ekranda görsel olarak ayırt edilebilir önizleme/ad/format bilgisiyle listelenmeli ve açık projeye yeniden eklenebilmelidir. Projeler karakter kaynaklarından bağımsız olarak sahne yerleşimlerini ve transformlarını korumalıdır.

- [x] **Yeni ve var olan kayıt akışları geriye uyumlu olmalıdır.** Mevcut 2D karakter kitaplığı ve proje JSON içe/dışa aktarma davranışı bozulmamalı; saklama kotası veya desteklenmeyen harita biçimi durumunda kullanıcıya açık hata verilerek mevcut proje korunmalıdır.

- [x] **Ana ekran ve proje depolaması otomatik kontrollerle doğrulanmalıdır.** Proje CRUD/migration, varlık kitaplığı, proje açıp geri yükleme ve otomatik kaydetme için testler eklenmeli; mevcut test paketi, lint ve production build başarılı olmalıdır.

## Doğrulama kaydı

- `npm test`: 86 test geçti, 0 başarısız.
- `npm run build`: başarılı; Vite üretim çıktısı oluşturuldu.
- `npm run lint`: başarılı (`tsc --noEmit`).
- `git diff --check`: başarılı.
- Gerçek tarayıcı akışı: yeni proje oluşturma; geçici GLB ve 4×2 PNG spritesheet ekleme; iki varlığı seçilen projeye yerleştirme; ana ekrana dönüp kayıtlı proje sayımlarını doğrulama; projeyi yeniden açıp 3D model kimliği ile 2D karakter örneğinin IndexedDB’den geri yüklendiğini doğrulama.
- Temizlik: bu QA oturumunda eklenen geçici proje ve `QA_Actor_A` / `QA_Sprite_A` test varlıkları kaldırıldı. Önceden var olan `Son Çalışma` projesi ve `QA Sprite` kitaplık girdisi korunmuştur.
- `renameProject`, `duplicateProject`, `deleteProject`, karakter kitaplığı ve kota davranışları için regresyon testleri `test/project-store.test.js` içinde yer alır.

## Kapsam notu

Kayıtlar cihazın IndexedDB’sinde tutulur; bulut/cihazlar arası eşitleme bu sürümün kapsamı dışındadır. Proje başına kayıt limiti ve cihaz depolama kotası `ProjectStore.js` doğrulamalarına tabidir. Üretim dağıtımı ve farklı fiziksel cihazlarda saha testi bu görev kapsamında yapılmadı.
