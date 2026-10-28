import { getDeviceMemoryGiB } from './device-profile.js';

const NATIVE_CHUNK_SIZE = 3 * 1024 * 1024;
const LOW_MEMORY_NATIVE_CHUNK_SIZE = 1024 * 1024;
export const LEGACY_ELECTRON_MAX_BYTES = 8 * 1024 * 1024;

function getNativeChunkSize() {
  const memory = getDeviceMemoryGiB();
  return Number.isFinite(memory) && memory <= 2 ? LOW_MEMORY_NATIVE_CHUNK_SIZE : NATIVE_CHUNK_SIZE;
}

async function saveWithElectronChunks(blob, filename, desktop, onProgress) {
  reportProgress(onProgress, 'waiting-for-destination', 0, blob.size);
  const session = await desktop.beginGeneratedFile({ filename, mimeType: blob.type || 'application/octet-stream', size: blob.size });
  if (session?.canceled) return { saved: false, canceled: true, method: 'electron', filename };
  if (!session?.sessionId) throw new Error('Windows dosya kaydetme oturumu başlatılamadı.');

  let bytesWritten = 0;
  try {
    reportProgress(onProgress, 'saving', 0, blob.size);
    for (let offset = 0; offset < blob.size; offset += NATIVE_CHUNK_SIZE) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + NATIVE_CHUNK_SIZE).arrayBuffer());
      const result = await desktop.writeGeneratedFileChunk(session.sessionId, bytes);
      bytesWritten = result?.written ?? Math.min(offset + bytes.byteLength, blob.size);
      reportProgress(onProgress, 'saving', bytesWritten, blob.size);
    }
    const result = await desktop.finishGeneratedFile(session.sessionId);
    if (!result?.saved) throw new Error('Windows dosyası tamamlanamadı.');
    reportProgress(onProgress, 'saved', blob.size, blob.size);
    return { ...result, saved: true, method: 'electron', filename: result.filename || session.filename || filename };
  } catch (error) {
    try { await desktop.abortGeneratedFile(session.sessionId); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function reportProgress(onProgress, stage, bytesWritten, totalBytes) {
  if (typeof onProgress !== 'function') return;
  const percent = totalBytes > 0 ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100)) : 100;
  try {
    onProgress({ stage, bytesWritten, totalBytes, percent });
  } catch {
    // UI progress observers are optional and must not interrupt file persistence.
  }
}

export async function saveToCapacitorDocuments(blob, filename, filesystem, directory, onProgress) {
  if (blob.size === 0) throw new Error('Kaydedilecek dosya boş.');
  const permission = await filesystem.checkPermissions();
  if (permission.publicStorage !== 'granted') {
    const requested = await filesystem.requestPermissions();
    if (requested.publicStorage !== 'granted') {
      throw new Error('Dosyayı Belgeler klasörüne kaydetmek için depolama izni gerekli.');
    }
  }

  const safeFilename = sanitizeFilename(filename);
  const path = `Animationer/${safeFilename}`;
  let fileCreated = false;
  const chunkSize = getNativeChunkSize();
  try {
    reportProgress(onProgress, 'saving', 0, blob.size);
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      const data = bytesToBase64(chunk);
      if (offset === 0) {
        await filesystem.writeFile({ path, data, directory, recursive: true });
        fileCreated = true;
      } else {
        await filesystem.appendFile({ path, data, directory });
      }
      reportProgress(onProgress, 'saving', Math.min(offset + chunk.byteLength, blob.size), blob.size);
    }
  } catch (error) {
    if (fileCreated && typeof filesystem.deleteFile === 'function') {
      try { await filesystem.deleteFile({ path, directory }); } catch { /* Preserve the original write error. */ }
    }
    throw error;
  }

  let uri;
  try {
    ({ uri } = await filesystem.getUri({ path, directory }));
  } catch {
    // Saving succeeded; sharing is optional and must not turn it into a failed export.
  }

  return {
    saved: true,
    method: 'capacitor',
    filename: safeFilename,
    location: `Documents/${path}`,
    uri,
  };
}

function saveInBrowser(blob, filename, onProgress) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  reportProgress(onProgress, 'download-started', blob.size, blob.size);
  return { saved: false, initiated: true, method: 'browser', filename, location: 'Tarayıcı indirilenleri' };
}

export async function shareGeneratedFile(blob, result) {
  if (!result?.saved) throw new Error('Paylaşılacak kayıtlı bir dosya bulunamadı.');

  if (result.method === 'capacitor' && result.uri) {
    const { Share } = await import('@capacitor/share');
    const availability = await Share.canShare();
    if (!availability.value) throw new Error('Bu cihazda dosya paylaşımı desteklenmiyor.');
    await Share.share({
      title: result.filename || 'Animationer dışa aktarma',
      text: result.filename || 'Animationer dosyası',
      files: [result.uri],
      dialogTitle: 'Dosyayı paylaş',
    });
    return;
  }

  if (blob instanceof Blob && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], result.filename || 'animationer-export', {
      type: blob.type || 'application/octet-stream',
    });
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      throw new Error('Bu tarayıcı bu dosya türünü paylaşamıyor.');
    }
    await navigator.share({ title: file.name, files: [file] });
    return;
  }

  throw new Error('Bu platformda dosya paylaşımı desteklenmiyor.');
}

export async function saveGeneratedFile(blob, filename, { onProgress } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('Dışa aktarılacak geçerli bir dosya bulunamadı.');
  if (!filename || typeof filename !== 'string') throw new TypeError('Dosya adı belirtilmedi.');
  if (blob.size === 0) throw new Error('Kaydedilecek dosya boş.');
  const safeFilename = sanitizeFilename(filename);

  if (typeof window !== 'undefined' && window.dioramaDesktop?.saveGeneratedFile) {
    if (typeof window.dioramaDesktop.beginGeneratedFile === 'function'
      && typeof window.dioramaDesktop.writeGeneratedFileChunk === 'function'
      && typeof window.dioramaDesktop.finishGeneratedFile === 'function'
      && typeof window.dioramaDesktop.abortGeneratedFile === 'function') {
      return saveWithElectronChunks(blob, safeFilename, window.dioramaDesktop, onProgress);
    }
    if (blob.size > LEGACY_ELECTRON_MAX_BYTES) {
      throw new Error(`Bu Windows uygulaması eski dışa aktarma köprüsünü kullanıyor; ${Math.floor(LEGACY_ELECTRON_MAX_BYTES / (1024 * 1024))} MB üzerindeki dosyalar desteklenmiyor. Uygulamayı güncelleyin veya dosyayı küçültün.`);
    }
    reportProgress(onProgress, 'waiting-for-destination', 0, blob.size);
    const response = await window.dioramaDesktop.saveGeneratedFile({
      filename: safeFilename,
      mimeType: blob.type || 'application/octet-stream',
      data: await blob.arrayBuffer(),
    });
    if (response?.canceled) return { saved: false, canceled: true, method: 'electron', filename: safeFilename };
    if (!response?.saved) throw new Error(response?.error || 'Dosya Windows uygulamasına kaydedilemedi.');
    reportProgress(onProgress, 'saved', blob.size, blob.size);
    return { ...response, saved: true, method: 'electron', filename: response.filename || safeFilename };
  }

  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('Filesystem')) {
      throw new Error('Dosya kaydetme bileşeni bu mobil uygulama sürümünde bulunamadı.');
    }
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    return saveToCapacitorDocuments(blob, safeFilename, Filesystem, Directory.Documents, onProgress);
  }

  return saveInBrowser(blob, safeFilename, onProgress);
}
