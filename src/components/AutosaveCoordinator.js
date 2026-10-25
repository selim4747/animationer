import { createAutosaveRecord } from './ProjectStore.js';

function assetSize(asset) {
  return asset?.blob?.size || (typeof asset?.data === 'string' ? Math.floor(asset.data.length * 3 / 4) : 0);
}

function recordFingerprint(record, mapRevision = 0) {
  return JSON.stringify({
    timeline: [record.timeline.playMode, record.timeline.steps],
    sprites: record.sprites.map(({ id, name, columns, rows, fps, x, y, displayHeight, fileName, blob, data }) => [id, name, columns, rows, fps, x, y, displayHeight, fileName, assetSize({ blob, data })]),
    map: record.mapAsset ? [mapRevision, record.mapAsset.fileName, assetSize(record.mapAsset), record.mapAsset.scale, record.mapAsset.opacity, record.mapAsset.groundOrientation] : null,
    templates: record.worldCharacterTemplates.map(({ id, name, columns, rows, fps, fileName, updatedAt, blob, data }) => [id, name, columns, rows, fps, fileName, updatedAt, assetSize({ blob, data })]),
    actors: record.worldCharacters.map(({ id, name, templateId, x, y, z }) => [id, name, templateId, x, y, z]),
  });
}

/** Coalesces and serializes durable project changes into IndexedDB. */
export class AutosaveCoordinator {
  constructor({ timeline, sprites, mapLoader = null, worldSprites = null, projectStore, worldSpriteReady = Promise.resolve(), onStatus = () => {}, onError = () => {} }) {
    this.timeline = timeline;
    this.sprites = sprites;
    this.mapLoader = mapLoader;
    this.worldSprites = worldSprites;
    this.projectStore = projectStore;
    this.worldSpriteReady = worldSpriteReady;
    this.onStatus = onStatus;
    this.onError = onError;
    this._restoring = false;
    this._timer = null;
    this._connected = false;
    this._savePromise = null;
    this._saveRequested = false;
    this._lastFingerprint = null;
    this.ready = Promise.resolve();
  }

  connect() {
    if (!this.projectStore || this._connected) return this.ready;
    this._connected = true;

    const originalTimelineNotify = this.timeline.onStateChange;
    this.timeline.onStateChange = (state) => {
      originalTimelineNotify?.(state);
      this.schedule(); // Playback-only updates are suppressed by the persisted-content fingerprint.
    };
    const originalSpriteNotify = this.sprites.onStateChange;
    this.sprites.onStateChange = (state) => {
      originalSpriteNotify?.(state);
      this.schedule();
    };
    if (this.mapLoader) {
      const originalMapNotify = this.mapLoader.onStateChange;
      this.mapLoader.onStateChange = (state) => {
        originalMapNotify?.(state);
        this.schedule();
      };
    }
    if (this.worldSprites) {
      const originalWorldNotify = this.worldSprites.onStateChange;
      this.worldSprites.onStateChange = (state) => {
        originalWorldNotify?.(state);
        if (['actor-added', 'actor-removed', 'actor-moving', 'actor-arrived', 'actor-blocked', 'actor-stopped', 'instances-restored'].includes(state?.type)) this.schedule();
      };
    }

    this.ready = this.restore();
    return this.ready;
  }

  schedule() {
    if (!this.projectStore || this._restoring) return;
    this.onStatus('Değişiklikler kaydediliyor…');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { void this.save(); }, 700);
  }

  async _buildRecord() {
    const [sprites, worldState] = await Promise.all([
      this.sprites.exportAssetsForStorage(),
      this.worldSprites?.exportProjectStateForStorage?.() || Promise.resolve({ templates: [], actors: [] }),
    ]);
    return createAutosaveRecord({
      timeline: JSON.parse(this.timeline.exportSequence()),
      sprites,
      mapAsset: this.mapLoader?.exportStateForStorage?.() || null,
      worldCharacterTemplates: worldState.templates,
      worldCharacters: worldState.actors,
      viewport: { width: globalThis.window?.innerWidth || 1, height: globalThis.window?.innerHeight || 1 },
    });
  }

  async save() {
    if (!this.projectStore || this._restoring) return;
    if (this._savePromise) {
      this._saveRequested = true;
      return this._savePromise;
    }
    this._savePromise = (async () => {
      do {
        this._saveRequested = false;
        const record = await this._buildRecord();
        const fingerprint = recordFingerprint(record, this.mapLoader?.stateRevision);
        if (fingerprint === this._lastFingerprint) continue;
        const savedAt = await this.projectStore.save(record);
        this._lastFingerprint = fingerprint;
        this.onStatus(`Otomatik kayıtlı · ${new Date(savedAt).toLocaleTimeString()}`);
      } while (this._saveRequested && !this._restoring);
    })().catch((error) => {
      this.onStatus(`Otomatik kayıt başarısız: ${error.message}`);
      this.onError(error.message || 'Otomatik kayıt başarısız.');
    }).finally(() => { this._savePromise = null; });
    return this._savePromise;
  }

  async restore() {
    if (!this.projectStore) return;
    this._restoring = true;
    this.onStatus('Otomatik kayıt ve karakter kitaplığı yükleniyor…');
    try {
      await this.worldSpriteReady;
      const record = await this.projectStore.load();
      if (!record) {
        const initial = await this._buildRecord();
        this._lastFingerprint = recordFingerprint(initial, this.mapLoader?.stateRevision);
        this.onStatus('Otomatik kayıt yok.');
        return;
      }
      const candidate = new this.timeline.constructor({});
      candidate.importSequence(record.timeline);
      const spriteIds = new Set(record.sprites.map((asset) => asset.id));
      const missingSprite = candidate.steps.find((step) => step.type === 'PLAY_SPRITE_ANIMATION' && !spriteIds.has(step.actorId));
      if (missingSprite) throw new Error(`'${missingSprite.actorId}' sprite dosyası otomatik kayıtta yok.`);

      // Resource loaders validate/decode into temporary resources before replacing their current state.
      await this.worldSprites?.importProjectState?.({ templates: record.worldCharacterTemplates, actors: record.worldCharacters });
      await this.sprites.importAssets(record.sprites);
      await this.mapLoader?.restoreProjectState?.(record.mapAsset);
      this.timeline.steps = candidate.steps;
      this.timeline.playMode = candidate.playMode;
      this.timeline._notify();
      this._lastFingerprint = recordFingerprint(record, this.mapLoader?.stateRevision);
      this.onStatus('Otomatik kayıt geri yüklendi (2D ortam + reji + 2D karakterler).');
    } catch (error) {
      this.onStatus(`Otomatik kayıt geri yüklenemedi: ${error.message}`);
      this.onError(`Otomatik kayıt açılamadı: ${error.message}`);
      throw error;
    } finally {
      this._restoring = false;
    }
  }
}
