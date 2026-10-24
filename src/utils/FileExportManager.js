const NATIVE_CHUNK_SIZE = 3 * 1024 * 1024;

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

export async function saveToCapacitorDocuments(blob, filename, filesystem, directory) {
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
  try {
    for (let offset = 0; offset < blob.size; offset += NATIVE_CHUNK_SIZE) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + NATIVE_CHUNK_SIZE).arrayBuffer());
      const data = bytesToBase64(chunk);
      if (offset === 0) {
        await filesystem.writeFile({ path, data, directory, recursive: true });
        fileCreated = true;
      } else {
        await filesystem.appendFile({ path, data, directory });
      }
    }
  } catch (error) {
    if (fileCreated && typeof filesystem.deleteFile === 'function') {
      try { await filesystem.deleteFile({ path, directory }); } catch { /* Preserve the original write error. */ }
    }
    throw error;
  }

  return {
    saved: true,
    method: 'capacitor',
    filename: safeFilename,
    location: `Documents/${path}`,
  };
}

function saveInBrowser(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  return { saved: true, method: 'browser', filename };
}

export async function saveGeneratedFile(blob, filename) {
  if (!(blob instanceof Blob)) throw new TypeError('Dışa aktarılacak geçerli bir dosya bulunamadı.');
  if (!filename || typeof filename !== 'string') throw new TypeError('Dosya adı belirtilmedi.');
  if (blob.size === 0) throw new Error('Kaydedilecek dosya boş.');
  const safeFilename = sanitizeFilename(filename);

  if (typeof window !== 'undefined' && window.dioramaDesktop?.saveGeneratedFile) {
    const response = await window.dioramaDesktop.saveGeneratedFile({
      filename: safeFilename,
      mimeType: blob.type || 'application/octet-stream',
      data: await blob.arrayBuffer(),
    });
    if (response?.canceled) return { saved: false, canceled: true, method: 'electron', filename: safeFilename };
    if (!response?.saved) throw new Error(response?.error || 'Dosya Windows uygulamasına kaydedilemedi.');
    return { ...response, saved: true, method: 'electron', filename: response.filename || safeFilename };
  }

  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('Filesystem')) {
      throw new Error('Dosya kaydetme bileşeni bu mobil uygulama sürümünde bulunamadı.');
    }
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    return saveToCapacitorDocuments(blob, safeFilename, Filesystem, Directory.Documents);
  }

  return saveInBrowser(blob, safeFilename);
}
