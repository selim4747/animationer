export const PROJECT_SCHEMA_VERSION = 2;
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
const DB_NAME = 'animationer-projects';
const STORE_NAME = 'projects';
const ACTIVE_KEY = 'autosave';

export function migrateProjectRecord(input) {
  if (!input || typeof input !== 'object') throw new Error('Kayıtlı proje bozuk.');
  if (input.schemaVersion === PROJECT_SCHEMA_VERSION) return validateProjectRecord(input);
  if (input.schemaVersion === 1 || input.projectVersion === 1) {
    // v1 portable JSON stores timeline properties at the root and sprites as base64.
    const legacyTimeline = input.timeline || input;
    return validateProjectRecord({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      format: 'animationer-project',
      updatedAt: input.updatedAt || input.timestamp || new Date().toISOString(),
      scope: { timeline: true, sprites2d: true, characterTransforms: false, mapAssets: false, cameraPreferences: false },
      timeline: {
        version: legacyTimeline.version || '1.0.0',
        timestamp: legacyTimeline.timestamp || input.timestamp || new Date().toISOString(),
        playMode: legacyTimeline.playMode === 'scheduled' ? 'scheduled' : 'sequential',
        steps: Array.isArray(legacyTimeline.steps) ? legacyTimeline.steps : [],
      },
      sprites: Array.isArray(input.sprites) ? input.sprites.map((asset) => ({ ...asset })) : [],
      viewport: null,
    });
  }
  throw new Error(`Desteklenmeyen proje schema sürümü: ${input.schemaVersion ?? input.projectVersion ?? 'belirsiz'}`);
}

export function calculateProjectBytes(timeline, sprites = []) {
  let total = new TextEncoder().encode(JSON.stringify(timeline)).byteLength;
  for (const asset of sprites) {
    const size = typeof asset?.blob?.size === 'number'
      ? asset.blob.size
      : (typeof asset?.data === 'string' ? Math.floor(asset.data.length * 3 / 4) : 0);
    total += size;
  }
  return total;
}

export function validateProjectRecord(input) {
  if (!input || input.schemaVersion !== PROJECT_SCHEMA_VERSION || input.format !== 'animationer-project') {
    throw new Error('Proje kayıt şeması geçersiz.');
  }
  if (!input.timeline || !Array.isArray(input.timeline.steps) || !Array.isArray(input.sprites)) {
    throw new Error('Proje timeline veya sprite verisi eksik.');
  }
  if (input.sprites.length > 100) throw new Error('Projede en fazla 100 sprite olabilir.');
  const totalBytes = calculateProjectBytes(input.timeline, input.sprites);
  for (const asset of input.sprites) {
    if (!asset || typeof asset.id !== 'string' || !asset.id) throw new Error('Proje sprite kimliği geçersiz.');
    const hasBlob = typeof Blob !== 'undefined' && asset.blob instanceof Blob;
    const size = hasBlob ? asset.blob.size : (typeof asset.data === 'string' ? Math.floor(asset.data.length * 3 / 4) : 0);
    if (!size) throw new Error(`'${asset.id}' sprite dosyası eksik.`);
  }
  if (totalBytes > MAX_PROJECT_BYTES) throw new Error('Toplam proje boyutu 100 MB sınırını aşıyor.');
  return { ...input, scope: { ...input.scope }, timeline: { ...input.timeline }, sprites: [...input.sprites] };
}

export function createAutosaveRecord({ timeline, sprites, viewport }) {
  return validateProjectRecord({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    format: 'animationer-project',
    updatedAt: new Date().toISOString(),
    scope: { timeline: true, sprites2d: true, characterTransforms: false, mapAssets: false, cameraPreferences: false },
    timeline,
    sprites,
    viewport: viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
      ? { width: Math.max(1, Math.round(viewport.width)), height: Math.max(1, Math.round(viewport.height)) }
      : null,
  });
}

export class IndexedProjectStore {
  constructor(indexedDB = globalThis.indexedDB) {
    this.indexedDB = indexedDB;
  }
  _open() {
    if (!this.indexedDB) return Promise.reject(new Error('Bu tarayıcı IndexedDB otomatik kaydını desteklemiyor.'));
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB açılamadı.'));
      request.onblocked = () => reject(new Error('Proje veritabanı başka bir sekme tarafından engellendi.'));
    });
  }
  async save(record) {
    const valid = validateProjectRecord(record);
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(valid, ACTIVE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Otomatik kayıt başarısız.'));
        tx.onabort = () => reject(tx.error || new Error('Otomatik kayıt geri alındı.'));
      });
    } catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Cihaz depolama kotası dolu; önceki otomatik kayıt korundu.');
      throw error;
    } finally { db.close(); }
    return valid.updatedAt;
  }
  async load() {
    const db = await this._open();
    try {
      const result = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(ACTIVE_KEY);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error || new Error('Otomatik kayıt okunamadı.'));
      });
      return result === null ? null : migrateProjectRecord(result);
    } finally { db.close(); }
  }
  async clear() {
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Otomatik kayıt silinemedi.'));
      });
    } finally { db.close(); }
  }
}
