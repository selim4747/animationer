import { createAutosaveRecord } from './ProjectStore.js';

function assetSize(asset) {
  return asset?.blob?.size || (typeof asset?.data === 'string' ? Math.floor(asset.data.length * 3 / 4) : 0);
}

function recordFingerprint(record, mapRevision = 0) {
  return JSON.stringify({
    projectId: record.projectId,
    name: record.name,
    timeline: [record.timeline.playMode, record.timeline.steps],
    sprites: record.sprites.map(({ id, name, columns, rows, fps, x, y, displayHeight, fileName, blob, data }) => [id, name, columns, rows, fps, x, y, displayHeight, fileName, assetSize({ blob, data })]),
    map: record.mapAsset ? [mapRevision, record.mapAsset.fileName, assetSize(record.mapAsset), record.mapAsset.scale, record.mapAsset.opacity, record.mapAsset.groundOrientation] : null,
    templates: record.worldCharacterTemplates.map(({ id, name, columns, rows, fps, fileName, updatedAt, blob, data }) => [id, name, columns, rows, fps, fileName, updatedAt, assetSize({ blob, data })]),
    actors: record.worldCharacters.map(({ id, name, templateId, x, y, z }) => [id, name, templateId, x, y, z]),
    characters3d: record.characters3d.map(({ id, name, modelId, position, rotationY, walkSpeed, wobbleIntensity, visible }) => [id, name, modelId, position.x, position.y, position.z, rotationY, walkSpeed, wobbleIntensity, visible]),
    wallBoxes: record.wallBoxes.map(({ x, z, width, depth, height }) => [x, z, width, depth, height]),
    skyColor: record.skyColor,
    cameras: record.cameraStations.map((station) => [station.id, station.name, station.position.x, station.position.y, station.position.z, station.target.x, station.target.y, station.target.z, station.isAutoTrigger]),
    activeCameraStationId: record.activeCameraStationId,
    cameraFollowCharacter: record.cameraFollowCharacter,
    selectedCharacter3dId: record.selectedCharacter3dId,
  });
}

/** Coalesces and serializes durable project changes into IndexedDB. */
export class AutosaveCoordinator {
  constructor({ timeline, sprites, characters = null, mapLoader = null, worldSprites = null, cameraManager = null, scene = null, projectStore, projectId = '', projectName = 'Yeni Proje', worldSpriteReady = Promise.resolve(), onStatus = () => {}, onError = () => {} }) {
    this.timeline = timeline;
    this.sprites = sprites;
    this.characters = characters;
    this.mapLoader = mapLoader;
    this.worldSprites = worldSprites;
    this.cameraManager = cameraManager;
    this.scene = scene;
    this.projectStore = projectStore;
    this.projectId = projectId;
    this.projectName = projectName;
    this.worldSpriteReady = worldSpriteReady;
    this.onStatus = onStatus;
    this.onError = onError;
    this._restoring = false;
    this._timer = null;
    this._connected = false;
    this._savePromise = null;
    this._saveRequested = false;
    this._lastFingerprint = null;
    this._lastError = null;
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
    if (this.characters) {
      const originalCharacterNotify = this.characters.onChange;
      this.characters.onChange = (state) => {
        originalCharacterNotify?.(state);
        if (['added', 'removed', 'visibility', 'restored', 'actor-position', 'selected'].includes(state?.type)) this.schedule();
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
    const characterState = this.characters?.exportProjectStateForStorage?.();
    const cameraState = this.cameraManager?.exportProjectStateForStorage?.();
    return createAutosaveRecord({
      timeline: JSON.parse(this.timeline.exportSequence()),
      sprites,
      mapAsset: this.mapLoader?.exportStateForStorage?.() || null,
      worldCharacterTemplates: worldState.templates,
      worldCharacters: worldState.actors,
      characters3d: characterState?.actors || [],
      selectedCharacter3dId: characterState?.selectedId || null,
      wallBoxes: this.mapLoader?.exportWallBoxesForStorage?.() || [],
      skyColor: this.scene?.background?.getHexString?.() || '080808',
      cameraStations: cameraState?.stations || [],
      activeCameraStationId: this.cameraManager?.activeStationId || null,
      cameraFollowCharacter: cameraState?.followCharacter !== false,
      viewport: { width: globalThis.window?.innerWidth || 1, height: globalThis.window?.innerHeight || 1 },
      projectId: this.projectId,
      name: this.projectName,
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
        this._lastError = null;
        const record = await this._buildRecord();
        const fingerprint = recordFingerprint(record, this.mapLoader?.stateRevision);
        if (fingerprint === this._lastFingerprint) continue;
        const savedAt = this.projectId && this.projectStore.saveProject
          ? await this.projectStore.saveProject(this.projectId, record)
          : await this.projectStore.save(record);
        this._lastFingerprint = fingerprint;
        this.onStatus(`Otomatik kayıtlı · ${new Date(savedAt).toLocaleTimeString()}`);
      } while (this._saveRequested && !this._restoring);
    })().catch((error) => {
      this._lastError = error;
      this.onStatus(`Otomatik kayıt başarısız: ${error.message}`);
      this.onError(error.message || 'Otomatik kayıt başarısız.');
    }).finally(() => { this._savePromise = null; });
    return this._savePromise;
  }

  async flush() {
    clearTimeout(this._timer);
    this._timer = null;
    this._lastError = null;
    await this.save();
    if (this._lastError) throw this._lastError;
  }

  async restore() {
    if (!this.projectStore) return;
    this._restoring = true;
    this.onStatus('Otomatik kayıt ve karakter kitaplığı yükleniyor…');
    try {
      await this.worldSpriteReady;
      const record = this.projectId && this.projectStore.loadProject
        ? await this.projectStore.loadProject(this.projectId)
        : await this.projectStore.load();
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
      await this.mapLoader?.restoreWallBoxes?.(record.wallBoxes || []);
      await this.characters?.restoreProjectState?.({ actors: record.characters3d, selectedId: record.selectedCharacter3dId });
      if (this.scene?.background?.set && record.skyColor) this.scene.background.set(`#${record.skyColor}`);
      this.cameraManager?.restoreProjectState?.({ stations: record.cameraStations || [], activeStationId: record.activeCameraStationId, followCharacter: record.cameraFollowCharacter });
      this.timeline.steps = candidate.steps;
      this.timeline.playMode = candidate.playMode;
      this.timeline._notify();
      this._lastFingerprint = recordFingerprint(record, this.mapLoader?.stateRevision);
      this.onStatus('Proje geri yüklendi · harita, karakterler ve reji.');
    } catch (error) {
      this.onStatus(`Otomatik kayıt geri yüklenemedi: ${error.message}`);
      this.onError(`Otomatik kayıt açılamadı: ${error.message}`);
      throw error;
    } finally {
      this._restoring = false;
    }
  }
}
