export function getDevicePerformanceProfile(deviceMemoryGiB) {
  const memory = Number.isFinite(deviceMemoryGiB) && deviceMemoryGiB > 0 ? deviceMemoryGiB : null;
  if (memory !== null && memory <= 2) {
    return { maxRecordingBytes: 32 * 1024 * 1024, maxFrameRate: 30, maxPixelRatio: 1, maxProjectAssetExportBytes: 12 * 1024 * 1024, maxTexturePixels: 4 * 1024 * 1024, maxTextureEdge: 4096, maxCharacterLibraryBytes: 48 * 1024 * 1024 };
  }
  if (memory !== null && memory <= 4) {
    return { maxRecordingBytes: 64 * 1024 * 1024, maxFrameRate: 60, maxPixelRatio: 1.5, maxProjectAssetExportBytes: 20 * 1024 * 1024, maxTexturePixels: 8 * 1024 * 1024, maxTextureEdge: 8192, maxCharacterLibraryBytes: 100 * 1024 * 1024 };
  }
  return { maxRecordingBytes: 128 * 1024 * 1024, maxFrameRate: 60, maxPixelRatio: 2, maxProjectAssetExportBytes: 50 * 1024 * 1024, maxTexturePixels: 16 * 1024 * 1024, maxTextureEdge: 8192, maxCharacterLibraryBytes: 250 * 1024 * 1024 };
}

export function getDeviceMemoryGiB() {
  if (typeof navigator === 'undefined') return null;
  if (Number.isFinite(navigator.deviceMemory)) return navigator.deviceMemory;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ? 4 : null;
}

export function getRendererPixelRatio(devicePixelRatio, deviceMemoryGiB) {
  const profile = getDevicePerformanceProfile(deviceMemoryGiB);
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(1, Math.min(dpr, profile.maxPixelRatio));
}

export function validateTextureDimensions(width, height, deviceMemoryGiB = getDeviceMemoryGiB()) {
  const { maxTexturePixels, maxTextureEdge } = getDevicePerformanceProfile(deviceMemoryGiB);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > maxTextureEdge || height > maxTextureEdge || width * height > maxTexturePixels) {
    throw new Error(`Görsel çözünürlüğü bu cihazın sınırını aşıyor (en çok ${maxTextureEdge}px kenar ve ${(maxTexturePixels / (1024 * 1024)).toFixed(0)} megapiksel). Daha küçük bir görsel kullanın.`);
  }
  return true;
}
