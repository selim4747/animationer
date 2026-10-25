import { writeFile as writeFileToDisk } from 'node:fs/promises';
import path from 'node:path';

const allowedExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'json', 'webm', 'mp4']);

export async function saveGeneratedFileFromRenderer(event, file, mainWindow, {
  dialogApi,
  writeFileImpl = writeFileToDisk,
} = {}) {
  if (!mainWindow || event?.sender !== mainWindow.webContents) {
    throw new Error('Dosya kaydetme isteği uygulama penceresinden gelmedi.');
  }
  if (!dialogApi || typeof dialogApi.showSaveDialog !== 'function') {
    throw new Error('Dosya kaydetme penceresi kullanılamıyor.');
  }

  const requestedName = typeof file?.filename === 'string' ? file.filename : '';
  const safeName = path.basename(requestedName).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const extension = path.extname(safeName).slice(1).toLowerCase();
  if (!safeName || !allowedExtensions.has(extension)) {
    throw new Error('Bu dosya türünün dışa aktarılmasına izin verilmiyor.');
  }

  let bytes;
  if (file.data instanceof ArrayBuffer) {
    bytes = Buffer.from(file.data);
  } else if (ArrayBuffer.isView(file.data)) {
    bytes = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
  } else {
    throw new Error('Dosya içeriği geçersiz.');
  }

  const typeNames = {
    png: 'PNG Görseli', jpg: 'JPEG Görseli', jpeg: 'JPEG Görseli',
    webp: 'WebP Görseli', json: 'JSON Dosyası', webm: 'WebM Videosu', mp4: 'MP4 Videosu',
  };
  const result = await dialogApi.showSaveDialog(mainWindow, {
    title: 'Dışa Aktarılan Dosyayı Kaydet',
    defaultPath: safeName,
    filters: [{ name: typeNames[extension], extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return { saved: false, canceled: true };

  await writeFileImpl(result.filePath, bytes);
  return { saved: true, filename: path.basename(result.filePath), path: result.filePath };
}
