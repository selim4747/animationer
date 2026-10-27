export function loadImage(source, ImageConstructor = globalThis.Image) {
  if (typeof ImageConstructor !== 'function') {
    return Promise.reject(new Error('Bu ortamda görsel yükleme desteklenmiyor.'));
  }

  return new Promise((resolve, reject) => {
    const image = new ImageConstructor();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Görsel çözümlenemedi veya desteklenmiyor.'));
    image.src = source;
  });
}
