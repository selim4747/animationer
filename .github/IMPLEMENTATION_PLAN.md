## Plan (uygulama öncesi)

- Timeline playback için generation/abort tabanlı durdurma ve pause/resume bariyerleri ekleyip sıralı ve zamanlanmış yürütmede gecikmiş dispatch'leri engellemek; eşzamanlı karakter/sprite aksiyonlarının mevcut davranışını korumak.
- Mobil ekran/viewport dönüşlerinde sprite konum ve boyutlarını sahne sınırlarına göre güvenli biçimde korumak; dar telefon ve safe-area/layout durumlarını iyileştirmek ve test etmek.
- Timeline adım kartı tetiklemesini klavye erişilebilir named button'a çevirmek; odak görünürlüğü ve iç kontrol event izolasyonunu sağlamak.
- Kayıt kapsamını dürüstçe belgelemek: bugün project JSON timeline + gömülü 2D spritesheet'leri içeriyor, tam 3D scene snapshot'ı değil. Atomic import ve güvenli asset sınırları/rollback davranışını test etmek; geniş IndexedDB autosave/3D snapshot işini desteklenmiyorsa kapsam dışı olarak belirtmek.
- Android Debug APK için tek kanonik workflow bırakmak; test, build, lint, Gradle Debug ve tek `DioramaStudio-Android-Debug` artifact yüklemesini garanti etmek, Windows job'ına dokunmamak.
- Regresyon testleri eklemek; `npm test`, `npm run build`, `npm run lint` çalıştırmak ve PR Actions APK artifact üretimini doğrulamak.

## Doğrulama
- PR #4 ve #5 main'e merge edilmiştir; bağımsız PR #6 açık olduğundan bu dal ona dokunmaz.
- Test/build/lint başlangıç kontrolü: başarılı.
