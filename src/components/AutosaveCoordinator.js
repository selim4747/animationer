/**
 * AutosaveCoordinator.js
 * Timeline ve sprite değişikliklerini izleyerek IndexedDB üzerinden otomatik kayıt yönetir.
 * UIManager'dan ayrıştırılarak sorumluluk azaltıldı.
 */

import { createAutosaveRecord } from './ProjectStore.js';

export class AutosaveCoordinator {
  /**
   * @param {Object} options
   * @param {import('./TimelineManager.js').TimelineManager} options.timeline
   * @param {import('./SpriteAnimationManager.js').SpriteAnimationManager} options.sprites
   * @param {import('./ProjectStore.js').IndexedProjectStore} options.projectStore
   * @param {Function} options.onStatus - Durum metni güncelleme callback'i
   * @param {Function} options.onError - Hata durumunda toast vb. için callback
   */
  constructor({ timeline, sprites, projectStore, onStatus = () => {}, onError = () => {} }) {
    this.timeline = timeline;
    this.sprites = sprites;
    this.projectStore = projectStore;
    this.onStatus = onStatus;
    this.onError = onError;
    this._restoring = false;
    this._timer = null;
    this._connected = false;
  }

  connect() {
    if (!this.projectStore || this._connected) return;
    this._connected = true;

    const originalTimelineNotify = this.timeline.onStateChange;
    this.timeline.onStateChange = (state) => {
      originalTimelineNotify?.(state);
      this.schedule();
    };

    const originalSpriteNotify = this.sprites.onStateChange;
    this.sprites.onStateChange = (state) => {
      originalSpriteNotify?.(state);
      this.schedule();
    };

    void this.restore();
  }

  schedule() {
    if (!this.projectStore || this._restoring) return;
    this.onStatus('Otomatik kayıt bekliyor…');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { void this.save(); }, 700);
  }

  async save() {
    if (!this.projectStore || this._restoring) return;
    try {
      const record = createAutosaveRecord({
        timeline: JSON.parse(this.timeline.exportSequence()),
        sprites: await this.sprites.exportAssetsForStorage(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      const savedAt = await this.projectStore.save(record);
      this.onStatus(`Otomatik kayıtlı · ${new Date(savedAt).toLocaleTimeString()}`);
    } catch (error) {
      this.onStatus(`Otomatik kayıt başarısız: ${error.message}`);
    }
  }

  async restore() {
    if (!this.projectStore) return;
    try {
      const record = await this.projectStore.load();
      if (!record) {
        this.onStatus('Otomatik kayıt yok.');
        return;
      }
      const candidate = new this.timeline.constructor({});
      candidate.importSequence(record.timeline);
      const spriteIds = new Set(record.sprites.map((asset) => asset.id));
      const missingSprite = candidate.steps.find(
        (step) => step.type === 'PLAY_SPRITE_ANIMATION' && !spriteIds.has(step.actorId)
      );
      if (missingSprite) {
        throw new Error(`'${missingSprite.actorId}' sprite dosyası otomatik kayıtta yok.`);
      }
      this._restoring = true;
      await this.sprites.importAssets(record.sprites);
      this.timeline.steps = candidate.steps;
      this.timeline.playMode = candidate.playMode;
      this.timeline._notify();
      this.onStatus('Otomatik kayıt geri yüklendi (timeline + 2D sprite).');
    } catch (error) {
      this.onStatus(`Otomatik kayıt geri yüklenemedi: ${error.message}`);
      this.onError(`Otomatik kayıt açılamadı; başlangıç projesi korundu: ${error.message}`);
    } finally {
      this._restoring = false;
    }
  }
}
