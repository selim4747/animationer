import { getDeviceMemoryGiB, getDevicePerformanceProfile } from '../utils/device-profile.js';

export const PROJECT_SCHEMA_VERSION = 4;
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
export const MAX_CHARACTER_TEMPLATE_BYTES = 50 * 1024 * 1024;
export const MAX_CHARACTER_LIBRARY_BYTES = 250 * 1024 * 1024;
export const MAX_CHARACTER_MODEL_BYTES = 50 * 1024 * 1024;
const DB_NAME = 'animationer-projects';
const STORE_NAME = 'projects';
const PROJECT_INDEX_STORE = 'project-index';
const CHARACTER_LIBRARY_STORE = 'character-library';
const CHARACTER_MODEL_STORE = 'character-models';
const ACTIVE_KEY = 'autosave';
const LEGACY_MIGRATION_KEY = 'migration:legacy-autosave';
const PROJECT_KEY_PREFIX = 'project:';

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function safeProjectName(value, fallback = 'Yeni Proje') {
  const name = typeof value === 'string' ? value.trim().slice(0, 64) : '';
  return name || fallback;
}

export function validateCharacterTemplateRecord(input) {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id || input.id.length > 128) {
    throw new Error('2D karakter kitaplığı kaydı geçersiz.');
  }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 48) : '';
  if (!name) throw new Error('Karakter için bir ad girin.');
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(input.mimeType || input.blob?.type)) {
    throw new Error('Karakter spritesheet biçimi desteklenmiyor.');
  }
  if (!(typeof Blob !== 'undefined' && input.blob instanceof Blob) || !input.blob.size || input.blob.size > MAX_CHARACTER_TEMPLATE_BYTES) {
    throw new Error('Karakter spritesheet dosyası boş veya 50 MB sınırını aşıyor.');
  }
  const columns = Number(input.columns);
  const rows = Number(input.rows);
  const fps = Number(input.fps);
  if (!Number.isInteger(columns) || columns < 1 || columns > 64 || !Number.isInteger(rows) || rows < 1 || rows > 64 || columns * rows > 4096) {
    throw new Error('Karakter spritesheet satır/sütun bilgisi geçersiz.');
  }
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Karakter animasyon FPS değeri geçersiz.');
  return {
    id: input.id,
    name,
    blob: input.blob,
    mimeType: input.mimeType || input.blob.type,
    fileName: String(input.fileName || `${name}.png`).slice(0, 160),
    columns,
    rows,
    fps,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function validateCharacterModelRecord(input) {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id || input.id.length > 128) {
    throw new Error('3D karakter kitaplığı kaydı geçersiz.');
  }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 48) : '';
  if (!name) throw new Error('3D karakter için bir ad girin.');
  const blob = input.blob;
  const fileName = String(input.fileName || `${name}.glb`).slice(0, 160);
  if (!/\.glb$/i.test(fileName) || !(typeof Blob !== 'undefined' && blob instanceof Blob) || !blob.size || blob.size > MAX_CHARACTER_MODEL_BYTES) {
    throw new Error('3D karakter dosyası geçersiz veya 50 MB sınırını aşıyor; .glb dosyası seçin.');
  }
  return {
    id: input.id,
    name,
    blob,
    mimeType: input.mimeType || blob.type || 'model/gltf-binary',
    fileName,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function assetSize(asset) {
  return typeof asset?.blob?.size === 'number'
    ? asset.blob.size
    : (typeof asset?.data === 'string' ? Math.floor(asset.data.length * 3 / 4) : 0);
}

function normalized3dActors(value) {
  return Array.isArray(value) ? value.map((actor) => ({
    id: String(actor.id || ''),
    name: safeProjectName(actor.name, 'Karakter'),
    modelId: typeof actor.modelId === 'string' && actor.modelId ? actor.modelId : null,
    position: {
      x: Number(actor.position?.x ?? actor.x ?? 0),
      y: Number(actor.position?.y ?? actor.y ?? 0),
      z: Number(actor.position?.z ?? actor.z ?? 0),
    },
    rotationY: Number(actor.rotationY || 0),
    walkSpeed: Number(actor.walkSpeed ?? 4.2),
    wobbleIntensity: Number(actor.wobbleIntensity ?? 1),
    visible: actor.visible !== false,
  })) : [];
}

export function migrateProjectRecord(input) {
  if (!input || typeof input !== 'object') throw new Error('Kayıtlı proje bozuk.');
  if (input.schemaVersion === PROJECT_SCHEMA_VERSION) return validateProjectRecord(input);
  if (input.schemaVersion === 3) {
    return validateProjectRecord({
      ...input,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectVersion: PROJECT_SCHEMA_VERSION,
      projectId: input.projectId || '',
      name: safeProjectName(input.name, 'Son Çalışma'),
      createdAt: input.createdAt || input.updatedAt || new Date().toISOString(),
      characters3d: normalized3dActors(input.characters3d),
      wallBoxes: Array.isArray(input.wallBoxes) ? input.wallBoxes : [],
    });
  }
  if (input.schemaVersion === 2 || input.projectVersion === 2) {
    return validateProjectRecord({
      ...input,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectVersion: PROJECT_SCHEMA_VERSION,
      projectId: input.projectId || '',
      name: safeProjectName(input.name, 'Son Çalışma'),
      createdAt: input.createdAt || input.updatedAt || new Date().toISOString(),
      mapAsset: null,
      worldCharacterTemplates: [],
      worldCharacters: [],
      characters3d: [],
      scope: { ...input.scope, mapAssets: false, worldCharacters: false },
    });
  }
  if (input.schemaVersion === 1 || input.projectVersion === 1) {
    const legacyTimeline = input.timeline || input;
    return validateProjectRecord({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectVersion: PROJECT_SCHEMA_VERSION,
      format: 'animationer-project',
      projectId: '',
      name: 'Son Çalışma',
      createdAt: input.updatedAt || input.timestamp || new Date().toISOString(),
      updatedAt: input.updatedAt || input.timestamp || new Date().toISOString(),
      scope: { timeline: true, sprites2d: true, characterTransforms: false, mapAssets: false, worldCharacters: false, cameraPreferences: false },
      timeline: {
        version: legacyTimeline.version || '1.0.0',
        timestamp: legacyTimeline.timestamp || input.timestamp || new Date().toISOString(),
        playMode: legacyTimeline.playMode === 'scheduled' ? 'scheduled' : 'sequential',
        steps: Array.isArray(legacyTimeline.steps) ? legacyTimeline.steps : [],
      },
      sprites: Array.isArray(input.sprites) ? input.sprites.map((asset) => ({ ...asset })) : [],
      mapAsset: null,
      worldCharacterTemplates: [],
      worldCharacters: [],
      characters3d: [],
      viewport: null,
    });
  }
  throw new Error(`Desteklenmeyen proje schema sürümü: ${input.schemaVersion ?? input.projectVersion ?? 'belirsiz'}`);
}

export function calculateProjectBytes(timeline, sprites = [], mapAsset = null, worldCharacterTemplates = []) {
  let total = new TextEncoder().encode(JSON.stringify(timeline)).byteLength;
  for (const asset of [...sprites, ...worldCharacterTemplates]) total += assetSize(asset);
  if (mapAsset) total += assetSize(mapAsset);
  return total;
}

export function validateProjectRecord(input) {
  if (!input || input.schemaVersion !== PROJECT_SCHEMA_VERSION || input.format !== 'animationer-project') {
    throw new Error('Proje kayıt şeması geçersiz.');
  }
  if (!input.timeline || !Array.isArray(input.timeline.steps) || !Array.isArray(input.sprites)) {
    throw new Error('Proje timeline veya sprite verisi eksik.');
  }
  const mapAsset = input.mapAsset ?? null;
  const worldCharacterTemplates = input.worldCharacterTemplates ?? [];
  const worldCharacters = input.worldCharacters ?? [];
  const characters3d = normalized3dActors(input.characters3d);
  const wallBoxes = Array.isArray(input.wallBoxes) ? input.wallBoxes.map((box) => ({
    x: Number(box.x), z: Number(box.z), width: Number(box.width), depth: Number(box.depth), height: Number(box.height),
  })) : [];
  const skyColor = /^#?[0-9a-f]{6}$/i.test(String(input.skyColor || '')) ? String(input.skyColor).replace(/^#/, '').toLowerCase() : '080808';
  const cameraStations = Array.isArray(input.cameraStations) ? input.cameraStations.slice(0, 100).map((station) => ({
    id: String(station.id || '').slice(0, 128),
    name: String(station.name || '').trim().slice(0, 80),
    position: { x: Number(station.position?.x), y: Number(station.position?.y), z: Number(station.position?.z) },
    target: { x: Number(station.target?.x), y: Number(station.target?.y), z: Number(station.target?.z) },
    isAutoTrigger: Boolean(station.isAutoTrigger),
  })) : [];
  if (!Array.isArray(worldCharacterTemplates) || worldCharacterTemplates.length > 50) throw new Error('2D karakter kaynak listesi geçersiz.');
  if (!Array.isArray(worldCharacters) || worldCharacters.length > 50) throw new Error('Sahnedeki 2D karakter listesi geçersiz.');
  if (wallBoxes.length > 200 || wallBoxes.some((box) => ![box.x, box.z, box.width, box.depth, box.height].every(Number.isFinite)
    || box.width <= 0 || box.depth <= 0 || box.height <= 0 || box.width > 1000 || box.depth > 1000 || box.height > 1000)) {
    throw new Error('Harita engel kutusu kaydı geçersiz.');
  }
  if (cameraStations.some((station) => !station.id || !station.name
    || ![station.position.x, station.position.y, station.position.z, station.target.x, station.target.y, station.target.z].every(Number.isFinite))) {
    throw new Error('Kamera istasyonu kaydı geçersiz.');
  }
  if (mapAsset && mapAsset.kind === 'image'
    && (!assetSize(mapAsset) || !mapAsset.fileName || !Number.isFinite(mapAsset.scale) || !Number.isFinite(mapAsset.opacity) || mapAsset.opacity < 0 || mapAsset.opacity > 1 || typeof mapAsset.groundOrientation !== 'boolean')) {
    throw new Error('2D ortam kaydı geçersiz veya görseli eksik.');
  }
  if (mapAsset && mapAsset.kind === 'model'
    && (!assetSize(mapAsset) || !/\.glb$/i.test(mapAsset.fileName || ''))) {
    throw new Error('3D ortam kaydı geçersiz veya GLB dosyası eksik.');
  }
  if (mapAsset && !['image', 'model', 'demo-gallery'].includes(mapAsset.kind)) throw new Error('Harita biçimi desteklenmiyor.');
  if (mapAsset?.kind === 'demo-gallery' && !mapAsset.fileName) throw new Error('Örnek galeri haritası bilgisi eksik.');
  const templateIds = new Set();
  for (const template of worldCharacterTemplates) {
    if (!template || typeof template.id !== 'string' || !template.id || templateIds.has(template.id) || !assetSize(template)) throw new Error('2D karakter kitaplığı kaynağı geçersiz veya yineleniyor.');
    templateIds.add(template.id);
    if (!template.name || !Number.isInteger(Number(template.columns)) || !Number.isInteger(Number(template.rows)) || !Number.isFinite(Number(template.fps))) throw new Error('2D karakter kitaplığı bilgileri geçersiz.');
  }
  const worldActorIds = new Set();
  for (const actor of worldCharacters) {
    if (!actor || typeof actor.id !== 'string' || !actor.id || worldActorIds.has(actor.id) || !templateIds.has(actor.templateId)
      || ![actor.x, actor.y, actor.z].every((value) => Number.isFinite(Number(value)))) {
      throw new Error('Sahnedeki 2D karakter kaydı geçersiz veya kaynak spritesheet eksik.');
    }
    worldActorIds.add(actor.id);
  }
  if (characters3d.length > 20) throw new Error('Sahnedeki 3D karakter listesi 20 sınırını aşıyor.');
  const characterIds = new Set();
  for (const actor of characters3d) {
    if (!actor.id || characterIds.has(actor.id) || ![actor.position.x, actor.position.y, actor.position.z, actor.rotationY, actor.walkSpeed, actor.wobbleIntensity].every(Number.isFinite)) {
      throw new Error('Sahnedeki 3D karakter kaydı geçersiz.');
    }
    if (actor.modelId !== null && (typeof actor.modelId !== 'string' || actor.modelId.length > 128)) throw new Error('3D karakter kaynak kimliği geçersiz.');
    characterIds.add(actor.id);
  }
  if (input.sprites.length > 100) throw new Error('Projede en fazla 100 sprite olabilir.');
  const totalBytes = calculateProjectBytes(input.timeline, input.sprites, mapAsset, worldCharacterTemplates);
  for (const asset of input.sprites) {
    if (!asset || typeof asset.id !== 'string' || !asset.id) throw new Error('Proje sprite kimliği geçersiz.');
    const size = assetSize(asset);
    if (!size) throw new Error(`'${asset.id}' sprite dosyası eksik.`);
  }
  if (totalBytes > MAX_PROJECT_BYTES) throw new Error('Toplam proje boyutu 100 MB sınırını aşıyor.');
  return {
    ...input,
    projectVersion: PROJECT_SCHEMA_VERSION,
    projectId: typeof input.projectId === 'string' ? input.projectId : '',
    name: safeProjectName(input.name, 'Yeni Proje'),
    createdAt: input.createdAt || input.updatedAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
    scope: { ...input.scope },
    timeline: { ...input.timeline },
    sprites: [...input.sprites],
    mapAsset,
    worldCharacterTemplates: [...worldCharacterTemplates],
    worldCharacters: [...worldCharacters],
    characters3d,
    wallBoxes,
    skyColor,
    cameraStations,
    activeCameraStationId: typeof input.activeCameraStationId === 'string' ? input.activeCameraStationId.slice(0, 128) : null,
    cameraFollowCharacter: input.cameraFollowCharacter !== false,
  };
}

export function createAutosaveRecord({ timeline, sprites, viewport, mapAsset = null, worldCharacterTemplates = [], worldCharacters = [], characters3d = [], selectedCharacter3dId = null, wallBoxes = [], skyColor = '080808', cameraStations = [], activeCameraStationId = null, cameraFollowCharacter = true, projectId = '', name = 'Yeni Proje', createdAt = null }) {
  const assetBudget = getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes;
  const assetBytes = [...sprites, ...worldCharacterTemplates].reduce((total, asset) => total + assetSize(asset), mapAsset ? assetSize(mapAsset) : 0);
  if (assetBytes > assetBudget) throw new Error(`Bu cihazda otomatik kayıt görsel varlık sınırı ${Math.floor(assetBudget / (1024 * 1024))} MiB; daha küçük görseller kullanın.`);
  const timestamp = new Date().toISOString();
  return validateProjectRecord({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    format: 'animationer-project',
    projectId,
    name,
    createdAt: createdAt || timestamp,
    updatedAt: timestamp,
    scope: { timeline: true, sprites2d: true, characterTransforms: characters3d.length > 0, mapAssets: Boolean(mapAsset), worldCharacters: true, cameraPreferences: true },
    timeline,
    sprites,
    mapAsset,
    worldCharacterTemplates,
    worldCharacters,
    characters3d,
    selectedCharacter3dId,
    wallBoxes,
    skyColor,
    cameraStations,
    activeCameraStationId,
    cameraFollowCharacter,
    viewport: viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
      ? { width: Math.max(1, Math.round(viewport.width)), height: Math.max(1, Math.round(viewport.height)) }
      : null,
  });
}

function projectIndexEntry(record) {
  return {
    id: record.projectId,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    mapKind: record.mapAsset?.kind || null,
    mapFileName: record.mapAsset?.fileName || '',
    character3dCount: record.characters3d?.length || 0,
    character2dCount: record.worldCharacters?.length || 0,
    wallBoxCount: record.wallBoxes?.length || 0,
    spriteCount: record.sprites?.length || 0,
    timelineStepCount: record.timeline?.steps?.length || 0,
    favorite: record.favorite === true,
  };
}

function requestResult(request, errorMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error(errorMessage));
  });
}

export class IndexedProjectStore {
  constructor(indexedDB = globalThis.indexedDB) {
    this.indexedDB = indexedDB;
  }
  _open() {
    if (!this.indexedDB) return Promise.reject(new Error('Bu tarayıcı IndexedDB otomatik kaydını desteklemiyor.'));
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
        if (!request.result.objectStoreNames.contains(CHARACTER_LIBRARY_STORE)) request.result.createObjectStore(CHARACTER_LIBRARY_STORE);
        if (!request.result.objectStoreNames.contains(PROJECT_INDEX_STORE)) request.result.createObjectStore(PROJECT_INDEX_STORE);
        if (!request.result.objectStoreNames.contains(CHARACTER_MODEL_STORE)) request.result.createObjectStore(CHARACTER_MODEL_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB açılamadı.'));
      request.onblocked = () => reject(new Error('Proje veritabanı başka bir sekme tarafından engellendi.'));
    });
  }
  async _put(storeName, key, value, errorMessage) {
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error(errorMessage));
        tx.onabort = () => reject(tx.error || new Error(errorMessage));
      });
    } catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Cihaz depolama kotası dolu; önceki kayıt korundu.');
      throw error;
    } finally { db.close(); }
  }
  async _get(storeName, key, errorMessage) {
    const db = await this._open();
    try { return await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key), errorMessage); }
    finally { db.close(); }
  }
  async save(record) {
    const valid = validateProjectRecord(record);
    await this._put(STORE_NAME, ACTIVE_KEY, valid, 'Otomatik kayıt başarısız.');
    return valid.updatedAt;
  }
  async load() {
    const result = await this._get(STORE_NAME, ACTIVE_KEY, 'Otomatik kayıt okunamadı.');
    return result === null ? null : migrateProjectRecord(result);
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
  async createProject(name = 'Yeni Proje') {
    const id = createId('project');
    const timestamp = new Date().toISOString();
    const record = createAutosaveRecord({
      projectId: id, name: safeProjectName(name), createdAt: timestamp,
      timeline: { version: '1.0.0', playMode: 'sequential', steps: [] },
      sprites: [], viewport: null,
      characters3d: [{ id: 'character-1', name: 'Karakter 1', modelId: null, position: { x: 0, y: 0, z: 0 }, rotationY: 0, walkSpeed: 4.2, wobbleIntensity: 1, visible: true }],
      selectedCharacter3dId: 'character-1',
    });
    await this.saveProject(id, record);
    return record;
  }
  async saveProject(id, input) {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Proje kimliği geçersiz.');
    const existing = await this._get(PROJECT_INDEX_STORE, id, 'Proje özeti okunamadı.');
    const timestamp = new Date().toISOString();
    const record = validateProjectRecord({
      ...input,
      favorite: typeof input?.favorite === 'boolean' ? input.favorite : existing?.favorite === true,
      projectId: id,
      name: safeProjectName(input?.name, existing?.name || 'Yeni Proje'),
      createdAt: existing?.createdAt || input?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, PROJECT_INDEX_STORE], 'readwrite');
        tx.objectStore(STORE_NAME).put(record, `${PROJECT_KEY_PREFIX}${id}`);
        tx.objectStore(PROJECT_INDEX_STORE).put(projectIndexEntry(record), id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Proje kaydedilemedi.'));
        tx.onabort = () => reject(tx.error || new Error('Proje kaydı geri alındı.'));
      });
    } catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Cihaz depolama kotası dolu; önceki proje kaydı korundu.');
      throw error;
    } finally { db.close(); }
    return record.updatedAt;
  }
  async loadProject(id) {
    if (!id) return null;
    const result = await this._get(STORE_NAME, `${PROJECT_KEY_PREFIX}${id}`, 'Proje okunamadı.');
    return result === null ? null : migrateProjectRecord(result);
  }
  async listProjects() {
    const db = await this._open();
    try {
      const entries = await requestResult(db.transaction(PROJECT_INDEX_STORE, 'readonly').objectStore(PROJECT_INDEX_STORE).getAll(), 'Proje listesi okunamadı.');
      return (entries || []).filter((entry) => entry && typeof entry.id === 'string').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    } finally { db.close(); }
  }
  async setProjectFavorite(id, favorite) {
    if (typeof favorite !== 'boolean') throw new Error('Favori durumu geçersiz.');
    const record = await this.loadProject(id);
    if (!record) throw new Error('Proje bulunamadı.');
    record.favorite = favorite;
    await this.saveProject(id, record);
    return favorite;
  }
  async renameProject(id, name) {
    const record = await this.loadProject(id);
    if (!record) throw new Error('Yeniden adlandırılacak proje bulunamadı.');
    record.name = safeProjectName(name, 'Yeni Proje');
    await this.saveProject(id, record);
    return this.loadProject(id);
  }
  async duplicateProject(id, name = '') {
    const source = await this.loadProject(id);
    if (!source) throw new Error('Kopyalanacak proje bulunamadı.');
    const copy = {
      ...source,
      projectId: createId('project'),
      name: safeProjectName(name, `${source.name} kopyası`.slice(0, 64)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: { ...source.timeline, steps: source.timeline.steps.map((step) => ({ ...step, data: step.data ? { ...step.data } : step.data })) },
      sprites: [...source.sprites],
      worldCharacterTemplates: [...source.worldCharacterTemplates],
      worldCharacters: source.worldCharacters.map((actor) => ({ ...actor })),
      characters3d: source.characters3d.map((actor) => ({ ...actor, position: { ...actor.position } })),
      wallBoxes: source.wallBoxes.map((box) => ({ ...box })),
      mapAsset: source.mapAsset ? { ...source.mapAsset } : null,
    };
    await this.saveProject(copy.projectId, copy);
    return copy;
  }
  async deleteProject(id) {
    if (!id) return false;
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, PROJECT_INDEX_STORE], 'readwrite');
        tx.objectStore(STORE_NAME).delete(`${PROJECT_KEY_PREFIX}${id}`);
        tx.objectStore(PROJECT_INDEX_STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Proje silinemedi.'));
        tx.onabort = () => reject(tx.error || new Error('Proje silme işlemi geri alındı.'));
      });
      return true;
    } finally { db.close(); }
  }
  async importLegacyAutosave() {
    const marker = await this._get(STORE_NAME, LEGACY_MIGRATION_KEY, 'Eski proje kaydı kontrol edilemedi.');
    if (marker?.complete) return null;
    const oldRecord = await this.load();
    if (!oldRecord) {
      await this._put(STORE_NAME, LEGACY_MIGRATION_KEY, { complete: true, at: new Date().toISOString() }, 'Eski proje kaydı işaretlenemedi.');
      return null;
    }
    const id = createId('project');
    const record = validateProjectRecord({
      ...oldRecord,
      projectId: id,
      name: 'Son Çalışma',
      createdAt: oldRecord.updatedAt || new Date().toISOString(),
    });
    // Keep the legacy key intact. The marker is written only after the new project is durable.
    await this.saveProject(id, record);
    await this._put(STORE_NAME, LEGACY_MIGRATION_KEY, { complete: true, at: new Date().toISOString(), projectId: id }, 'Eski proje aktarımı işaretlenemedi.');
    return record;
  }

  async saveCharacterTemplate(input, { maxLibraryBytes = MAX_CHARACTER_LIBRARY_BYTES } = {}) {
    const template = validateCharacterTemplateRecord(input);
    const effectiveLimit = Math.min(MAX_CHARACTER_LIBRARY_BYTES, Number(maxLibraryBytes) || MAX_CHARACTER_LIBRARY_BYTES);
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CHARACTER_LIBRARY_STORE, 'readwrite');
        const store = tx.objectStore(CHARACTER_LIBRARY_STORE);
        const existingRequest = typeof store.openCursor === 'function' ? store.openCursor() : store.getAll();
        let validationError = null;
        let total = template.blob.size;
        const validateAndPut = () => {
          if (total > effectiveLimit) {
            validationError = new Error(`2D karakter kitaplığı bu cihazın ${Math.max(1, Math.round(effectiveLimit / (1024 * 1024)))} MB sınırını aşıyor; önce bazı modelleri silin.`);
            tx.abort();
            return;
          }
          store.put(template, template.id);
        };
        existingRequest.onsuccess = () => {
          if (typeof store.openCursor === 'function') {
            const cursor = existingRequest.result;
            if (cursor) {
              if (cursor.primaryKey !== template.id) total += cursor.value.blob?.size || 0;
              cursor.continue();
            } else validateAndPut();
          } else {
            total = (existingRequest.result || []).reduce((sum, item) => sum + (item.id === template.id ? 0 : item.blob?.size || 0), total);
            validateAndPut();
          }
        };
        existingRequest.onerror = () => { validationError = existingRequest.error; tx.abort(); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(validationError || tx.error || new Error('2D karakter kaydedilemedi.'));
        tx.onabort = () => reject(validationError || tx.error || new Error('2D karakter kaydı geri alındı.'));
      });
    } catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Cihaz depolama kotası dolu; 2D karakter kaydedilemedi.');
      throw error;
    } finally { db.close(); }
    return template;
  }
  async renameCharacterTemplate(id, name) {
    const record = await this.getCharacterTemplate(id);
    if (!record) throw new Error('2D karakter kaydı bulunamadı.');
    return this.saveCharacterTemplate({ ...record, name });
  }
  async updateCharacterTemplateMetadata(id, { columns, rows, fps }) {
    const record = await this.getCharacterTemplate(id);
    if (!record) throw new Error('2D karakter kaydı bulunamadı.');
    return this.saveCharacterTemplate({ ...record, columns, rows, fps });
  }
  async replaceCharacterTemplate(id, file) {
    const record = await this.getCharacterTemplate(id);
    if (!record) throw new Error('2D karakter kaydı bulunamadı.');
    if (!file || !['image/png', 'image/webp', 'image/jpeg'].includes(file.type) || !file.size || file.size > MAX_CHARACTER_TEMPLATE_BYTES) throw new Error('2D spritesheet dosyası geçersiz veya 50 MB sınırını aşıyor.');
    return this.saveCharacterTemplate({ ...record, blob: file.slice(0, file.size, file.type), mimeType: file.type, fileName: file.name || record.fileName });
  }
  async getCharacterTemplateUsages(id) {
    const projects = await this.listProjects();
    const usages = [];
    for (const item of projects) {
      const record = await this.loadProject(item.id);
      const actors = record?.worldCharacters?.filter((actor) => actor.templateId === id) || [];
      if (actors.length) usages.push({ projectId: item.id, projectName: item.name, count: actors.length, characters: actors.map((actor) => actor.name) });
    }
    return usages;
  }
  async deleteCharacterTemplate(id) {
    if (typeof id !== 'string' || !id) return false;
    const db = await this._open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(CHARACTER_LIBRARY_STORE, 'readwrite');
        tx.objectStore(CHARACTER_LIBRARY_STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('2D karakter kitaplığından silinemedi.'));
        tx.onabort = () => reject(tx.error || new Error('2D karakter silme işlemi geri alındı.'));
      });
    } finally { db.close(); }
  }
  async listCharacterTemplates({ onInvalid = () => {} } = {}) {
    const db = await this._open();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(CHARACTER_LIBRARY_STORE, 'readonly').objectStore(CHARACTER_LIBRARY_STORE).getAll();
        request.onsuccess = () => {
          const valid = [];
          for (const item of request.result || []) {
            try { valid.push(validateCharacterTemplateRecord(item)); }
            catch (error) { onInvalid(item, error); }
          }
          resolve(valid);
        };
        request.onerror = () => reject(request.error || new Error('2D karakter kitaplığı okunamadı.'));
      });
    } finally { db.close(); }
  }
  async listCharacterTemplateMetadata({ onInvalid = () => {} } = {}) {
    const db = await this._open();
    try {
      const store = db.transaction(CHARACTER_LIBRARY_STORE, 'readonly').objectStore(CHARACTER_LIBRARY_STORE);
      const records = await requestResult(store.getAll(), '2D karakter kitaplığı okunamadı.');
      return (records || []).flatMap((item) => {
        try {
          const valid = validateCharacterTemplateRecord(item);
          const { blob, ...metadata } = valid;
          metadata.blobSize = blob.size;
          return [metadata];
        } catch (error) { onInvalid(item, error); return []; }
      });
    } finally { db.close(); }
  }
  async getCharacterTemplate(id) {
    const record = await this._get(CHARACTER_LIBRARY_STORE, id, '2D karakter kaynağı okunamadı.');
    return record ? validateCharacterTemplateRecord(record) : null;
  }

  async saveCharacterModel(input, { maxLibraryBytes = MAX_CHARACTER_LIBRARY_BYTES } = {}) {
    const model = validateCharacterModelRecord(input);
    const effectiveLimit = Math.min(MAX_CHARACTER_LIBRARY_BYTES, Number(maxLibraryBytes) || MAX_CHARACTER_LIBRARY_BYTES);
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CHARACTER_MODEL_STORE, 'readwrite');
        const store = tx.objectStore(CHARACTER_MODEL_STORE);
        const request = store.getAll();
        let validationError = null;
        request.onsuccess = () => {
          const total = model.blob.size + (request.result || []).reduce((sum, item) => sum + (item.id === model.id ? 0 : item.blob?.size || 0), 0);
          if (total > effectiveLimit) {
            validationError = new Error(`3D karakter kitaplığı ${Math.max(1, Math.round(effectiveLimit / (1024 * 1024)))} MB sınırını aşıyor; önce bazı modelleri silin.`);
            tx.abort();
            return;
          }
          store.put(model, model.id);
        };
        request.onerror = () => { validationError = request.error; tx.abort(); };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(validationError || tx.error || new Error('3D karakter kaydedilemedi.'));
        tx.onabort = () => reject(validationError || tx.error || new Error('3D karakter kaydı geri alındı.'));
      });
    } catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Cihaz depolama kotası dolu; 3D karakter kaydedilemedi.');
      throw error;
    } finally { db.close(); }
    return model;
  }
  async getCharacterModel(id) {
    const model = await this._get(CHARACTER_MODEL_STORE, id, '3D karakter kaynağı okunamadı.');
    return model ? validateCharacterModelRecord(model) : null;
  }
  async listCharacterModelMetadata({ onInvalid = () => {} } = {}) {
    const db = await this._open();
    try {
      const records = await requestResult(db.transaction(CHARACTER_MODEL_STORE, 'readonly').objectStore(CHARACTER_MODEL_STORE).getAll(), '3D karakter kitaplığı okunamadı.');
      return (records || []).flatMap((item) => {
        try {
          const valid = validateCharacterModelRecord(item);
          const { blob, ...metadata } = valid;
          metadata.blobSize = blob.size;
          return [metadata];
        } catch (error) { onInvalid(item, error); return []; }
      });
    } finally { db.close(); }
  }
  async renameCharacterModel(id, name) {
    const record = await this.getCharacterModel(id);
    if (!record) throw new Error('3D karakter kaydı bulunamadı.');
    return this.saveCharacterModel({ ...record, name });
  }
  async replaceCharacterModel(id, file) {
    const record = await this.getCharacterModel(id);
    if (!record) throw new Error('3D karakter kaydı bulunamadı.');
    if (!file || !/\.glb$/i.test(file.name || '') || !file.size || file.size > MAX_CHARACTER_MODEL_BYTES) throw new Error('3D karakter dosyası geçersiz veya 50 MB sınırını aşıyor; .glb dosyası seçin.');
    return this.saveCharacterModel({ ...record, blob: file.slice(0, file.size, file.type || 'model/gltf-binary'), mimeType: file.type || 'model/gltf-binary', fileName: file.name });
  }
  async getCharacterModelUsages(id) {
    const projects = await this.listProjects();
    const usages = [];
    for (const item of projects) {
      const record = await this.loadProject(item.id);
      const actors = record?.characters3d?.filter((actor) => actor.modelId === id) || [];
      if (actors.length) usages.push({ projectId: item.id, projectName: item.name, count: actors.length, characters: actors.map((actor) => actor.name) });
    }
    return usages;
  }
  async deleteCharacterModel(id) {
    const projects = await this.listProjects();
    for (const project of projects) {
      const record = await this.loadProject(project.id);
      if (record?.characters3d?.some((actor) => actor.modelId === id)) {
        throw new Error(`Bu model “${project.name}” projesinde kullanılıyor; önce o projedeki karakteri kaldırın.`);
      }
    }
    const db = await this._open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CHARACTER_MODEL_STORE, 'readwrite');
        tx.objectStore(CHARACTER_MODEL_STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('3D karakter silinemedi.'));
        tx.onabort = () => reject(tx.error || new Error('3D karakter silme işlemi geri alındı.'));
      });
      return true;
    } finally { db.close(); }
  }
}
