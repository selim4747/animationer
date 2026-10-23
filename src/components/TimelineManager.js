/**
 * TimelineManager.js
 * Reji / Yönetmen modu zaman çizelgesi ve eylem kuyruğu (Action Queue) yöneticisi.
 * Karakter yürüyüşü, kapı tetikleme, kamera geçişi, emote ve bekleme adımlarını
 * sırayla çalıştırır, kaydeder, dışa ve içe aktarır.
 */

export const ACTION_TYPES = {
  MOVE_TO: 'MOVE_TO',
  WAIT: 'WAIT',
  TRIGGER_DOOR: 'TRIGGER_DOOR',
  SWITCH_CAMERA: 'SWITCH_CAMERA',
  PLAY_EMOTE: 'PLAY_EMOTE',
  FOLLOW: 'FOLLOW',
  SET_VISIBILITY: 'SET_VISIBILITY',
  PLAY_SPRITE_ANIMATION: 'PLAY_SPRITE_ANIMATION',
};

export class TimelineManager {
  /**
   * @param {Object} options
   * @param {import('./Character.js').Character} options.character
   * @param {import('./Door.js').Door} options.door
   * @param {import('./CameraManager.js').CameraManager} options.cameraManager
   * @param {Function} options.onStateChange
   */
  constructor({ character, door, cameraManager, spriteAnimationManager, onStateChange = () => {} }) {
    this.character = character;
    this.door = door;
    this.cameraManager = cameraManager;
    this.spriteAnimationManager = spriteAnimationManager;
    this.onStateChange = onStateChange;

    // Kuyruk Adımları
    this.steps = [];

    // Oynatma Durumu
    this.isPlaying = false;
    this.isPaused = false;
    this.currentStepIndex = -1;
    this._abortPlayback = false;
    this._pausePromiseResolver = null;
    this._playbackId = 0;

    // Adım Kaydetme Modu
    this.isRecording = false;
    this.playMode = 'sequential';

    // Varsayılan zengin bir demo akışı yükle
    this._initDefaultDemoSequence();
  }

  /**
   * Başlangıçta kullanıcının hemen test edebileceği zengin bir reji senaryosu oluşturur
   * @private
   */
  _initDefaultDemoSequence() {
    this.steps = [
      {
        id: 'step-1',
        type: ACTION_TYPES.MOVE_TO,
        title: 'Koridora Doğru Yürü',
        data: { x: 0, y: 0, z: -1.8 },
      },
      {
        id: 'step-2',
        type: ACTION_TYPES.TRIGGER_DOOR,
        title: 'Oda Kapısını Aç',
        data: { action: 'open' },
      },
      {
        id: 'step-3',
        type: ACTION_TYPES.WAIT,
        title: '0.8s Kapı Önünde Durakla',
        data: { duration: 0.8 },
      },
      {
        id: 'step-4',
        type: ACTION_TYPES.MOVE_TO,
        title: 'İç Mekana Masaya Yürü',
        data: { x: 0, y: 0.1, z: -6.8 },
      },
      {
        id: 'step-5',
        type: ACTION_TYPES.PLAY_EMOTE,
        title: 'Kutlama / Neşeli Zıplama',
        data: { emote: 'jump' },
      },
      {
        id: 'step-6',
        type: ACTION_TYPES.SWITCH_CAMERA,
        title: 'Dış Genel Sahaya Dön',
        data: { stationId: 'station-ext' },
      },
      {
        id: 'step-7',
        type: ACTION_TYPES.MOVE_TO,
        title: 'Merdivene Doğru İlerle',
        data: { x: -5.0, y: 0, z: 0.8 },
      },
      {
        id: 'step-8',
        type: ACTION_TYPES.MOVE_TO,
        title: 'Merdiveni Tırman (2. Kat)',
        data: { x: -5.0, y: 1.75, z: -2.8 },
      },
      {
        id: 'step-9',
        type: ACTION_TYPES.PLAY_EMOTE,
        title: '2. Katta Selam Ver',
        data: { emote: 'wave' },
      },
    ];
  }

  _notify() {
    this.onStateChange({
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      currentStepIndex: this.currentStepIndex,
      steps: [...this.steps],
      isRecording: this.isRecording,
      playMode: this.playMode,
    });
  }

  /**
   * Adım Kayıt Modunu açar veya kapatır
   * @param {boolean} [enable]
   */
  toggleRecordMode(enable) {
    this.isRecording = enable !== undefined ? enable : !this.isRecording;
    this._notify();
    return this.isRecording;
  }

  /**
   * Kullanıcı sahnede tıkladığında veya kapıya bastığında kuyruğa yeni bir adım ekler
   * @param {string} type
   * @param {Object} data
   */
  recordClickAsStep(type, data, options = {}) {
    if (!this.isRecording) return;

    let title = 'Yeni Eylem';
    if (type === ACTION_TYPES.MOVE_TO) {
      const x = Number(data.x).toFixed(1);
      const y = Number(data.y).toFixed(1);
      const z = Number(data.z).toFixed(1);
      title = `Konuma Yürü [${x}, ${y}, ${z}]`;
    } else if (type === ACTION_TYPES.TRIGGER_DOOR) {
      title = data.action === 'close' ? 'Kapıyı Kapat' : 'Kapıyı Aç';
    } else if (type === ACTION_TYPES.SWITCH_CAMERA) {
      title = `Kamera Değiştir (${data.stationName || data.stationId})`;
    } else if (type === ACTION_TYPES.PLAY_EMOTE) {
      title = `Emote: ${data.emote || 'jump'}`;
    } else if (type === ACTION_TYPES.WAIT) {
      title = `${data.duration || 1}s Bekle`;
    }

    const step = {
      id: 'step-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type,
      title,
      data,
      ...this._cleanTimingOptions(options),
    };

    this.steps.push(step);
    this._notify();
    return step;
  }

  /**
   * Manuel adım ekleme
   */
  addStep(type, data = {}, title = '', options = {}) {
    const step = {
      id: 'step-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type,
      title: title || this._getDefaultTitleForType(type, data),
      data,
      ...this._cleanTimingOptions(options),
    };
    this.steps.push(step);
    this._notify();
    return step;
  }

  _cleanTimingOptions(options = {}) {
    const clean = {};
    if (typeof options.actorId === 'string') clean.actorId = options.actorId.slice(0, 128);
    if (options.startAt !== '' && options.startAt !== null && Number.isFinite(Number(options.startAt))) {
      clean.startAt = Math.max(0, Math.min(3600, Number(options.startAt)));
    }
    if (options.duration !== '' && options.duration !== null && Number.isFinite(Number(options.duration)) && Number(options.duration) > 0) {
      clean.duration = Math.max(0.1, Math.min(3600, Number(options.duration)));
    }
    return clean;
  }

  setPlayMode(mode) {
    this.playMode = mode === 'scheduled' ? 'scheduled' : 'sequential';
    this._notify();
  }

  _getDefaultTitleForType(type, data) {
    switch (type) {
      case ACTION_TYPES.MOVE_TO:
        return `Yürü: [${(data.x || 0).toFixed(1)}, ${(data.y || 0).toFixed(1)}, ${(data.z || 0).toFixed(1)}]`;
      case ACTION_TYPES.WAIT:
        return `${data.duration || 2} Saniye Bekle`;
      case ACTION_TYPES.TRIGGER_DOOR:
        return data.action === 'close' ? 'Kapıyı Kapat' : 'Kapıyı Aç';
      case ACTION_TYPES.SWITCH_CAMERA:
        return 'Kameraya Geç';
      case ACTION_TYPES.PLAY_EMOTE:
        return `Karakter Emote: ${data.emote || 'jump'}`;
      case ACTION_TYPES.FOLLOW:
        return `Karakteri Takip Et: ${data.targetCharacterId || 'hedef'}`;
      case ACTION_TYPES.SET_VISIBILITY:
        return data.visible ? 'Karakteri Göster' : 'Karakteri Gizle';
      case ACTION_TYPES.PLAY_SPRITE_ANIMATION:
        return '2D Spritesheet Animasyonu';
      default:
        return 'Eylem';
    }
  }

  /**
   * Adım silme
   * @param {number} index
   */
  removeStep(index) {
    if (index >= 0 && index < this.steps.length) {
      this.steps.splice(index, 1);
      if (this.currentStepIndex >= this.steps.length) {
        this.currentStepIndex = Math.max(-1, this.steps.length - 1);
      }
      this._notify();
    }
  }

  /**
   * Adım sırasını değiştirme
   */
  moveStep(fromIndex, toIndex) {
    if (
      fromIndex >= 0 &&
      fromIndex < this.steps.length &&
      toIndex >= 0 &&
      toIndex < this.steps.length
    ) {
      const item = this.steps.splice(fromIndex, 1)[0];
      this.steps.splice(toIndex, 0, item);
      this._notify();
    }
  }

  /**
   * Kuyruğu temizleme
   */
  clear() {
    this.stop();
    this.steps = [];
    this._notify();
  }

  /**
   * Tüm adımları sırayla çalıştırır (Play)
   */
  async play() {
    if (this.playMode === 'scheduled') return this._playScheduled();
    if (this.steps.length === 0) return;

    if (this.isPaused) {
      // Duraklatılmış yerden devam et
      this.isPaused = false;
      this.isPlaying = true;
      this.character?.pauseAll?.(false);
      this.spriteAnimationManager?.pauseAll?.(false);
      if (this._pausePromiseResolver) {
        this._pausePromiseResolver();
        this._pausePromiseResolver = null;
      }
      this._notify();
      return;
    }

    if (this.isPlaying) return;

    this.isPlaying = true;
    this.isPaused = false;
    this._abortPlayback = false;
    const playbackId = ++this._playbackId;

    // Eğer son adımdaysak başa dön
    if (this.currentStepIndex < 0 || this.currentStepIndex >= this.steps.length - 1) {
      this.currentStepIndex = 0;
    }

    this._notify();

    let playbackFailed = false;
    try {
      while (this.currentStepIndex < this.steps.length) {
        if (this._abortPlayback || playbackId !== this._playbackId) break;

        // Pause bekleme kontrolü
        if (this.isPaused) {
          await new Promise((resolve) => {
            this._pausePromiseResolver = resolve;
          });
          if (this._abortPlayback || playbackId !== this._playbackId) break;
        }

        if (!(await this._waitUntilResumed(playbackId))) break;
        const step = this.steps[this.currentStepIndex];
        this._notify();

        await this._executeStep(step, playbackId);

        if (this._abortPlayback || playbackId !== this._playbackId) break;
        this.currentStepIndex++;
      }
    } catch (err) {
      playbackFailed = true;
      console.error('Timeline oynatma hatası:', err);
    } finally {
      if (playbackId === this._playbackId) {
        this.isPlaying = false;
        this.isPaused = false;
        if (this.currentStepIndex >= this.steps.length) {
          this.currentStepIndex = -1; // Tamamlandı
        }
        this._notify();
      }
    }
    return !playbackFailed && !this._abortPlayback && playbackId === this._playbackId;
  }

  async _playScheduled() {
    if (this.steps.length === 0) return true;
    if (this.isPaused) {
      this.isPaused = false;
      this.isPlaying = true;
      this.character?.pauseAll?.(false);
      this.spriteAnimationManager?.pauseAll?.(false);
      this._pausePromiseResolver?.();
      this._pausePromiseResolver = null;
      this._notify();
      return true;
    }
    if (this.isPlaying) return false;

    this.isPlaying = true;
    this.isPaused = false;
    this._abortPlayback = false;
    const playbackId = ++this._playbackId;
    this.character?.pauseAll?.(false);
    this.spriteAnimationManager?.pauseAll?.(false);
    const schedule = this.steps
      .map((step, index) => ({
        step,
        index,
        startAt: Number.isFinite(step.startAt) ? step.startAt : index * 2,
      }))
      .sort((a, b) => a.startAt - b.startAt || a.index - b.index);
    this._notify();

    const runningActions = [];
    let previousStartAt = 0;
    let failed = false;
    try {
      for (const item of schedule) {
        if (this._abortPlayback || playbackId !== this._playbackId) break;
        await this._sleepWithAbort(Math.max(0, item.startAt - previousStartAt) * 1000, playbackId);
        if (this._abortPlayback || playbackId !== this._playbackId) break;
        if (!(await this._waitUntilResumed(playbackId))) break;
        if (this._abortPlayback || playbackId !== this._playbackId) break;
        previousStartAt = item.startAt;
        this.currentStepIndex = item.index;
        this._notify();
        runningActions.push(Promise.resolve(this._executeStep(item.step, playbackId)));
      }
      const results = await Promise.allSettled(runningActions);
      failed = results.some((result) => result.status === 'rejected');
      if (failed) {
        const firstError = results.find((result) => result.status === 'rejected')?.reason;
        throw firstError;
      }
    } catch (error) {
      console.error('Zamanlı reji oynatma hatası:', error);
      failed = true;
    } finally {
      if (playbackId === this._playbackId) {
        this.isPlaying = false;
        this.isPaused = false;
        this.character?.pauseAll?.(false);
        this.currentStepIndex = -1;
        this._notify();
      }
    }
    return !failed && !this._abortPlayback && playbackId === this._playbackId;
  }

  /**
   * Tek bir adımı çalıştırır
   * @private
   */
  async _executeStep(step, playbackId = this._playbackId) {
    if (!step) return;
    const actor = this.character?.getCharacter
      ? (this.character.getCharacter(step.actorId) || this.character.selectedCharacter)
      : this.character;

    switch (step.type) {
      case ACTION_TYPES.MOVE_TO: {
        if (actor && step.data) {
          await actor.moveToPromise(step.data, { duration: step.duration });
        }
        break;
      }

      case ACTION_TYPES.WAIT: {
        const ms = (step.duration || step.data.duration || 1) * 1000;
        await this._sleepWithAbort(ms, playbackId);
        break;
      }

      case ACTION_TYPES.TRIGGER_DOOR: {
        if (this.door) {
          const act = step.data.action || 'toggle';
          if (act === 'open') {
            await this.door.openDoorPromise();
          } else if (act === 'close') {
            await this.door.closeDoorPromise();
          } else {
            await this.door.toggleDoorPromise();
          }
          if (this._abortPlayback || playbackId !== this._playbackId) break;
          await this._sleepWithAbort(400, playbackId); // Yumuşak ara
        }
        break;
      }

      case ACTION_TYPES.SWITCH_CAMERA: {
        if (this.cameraManager) {
          const targetStation = step.data.stationId || step.data.stationIndex || 0;
          await this.cameraManager.transitionToStationPromise(targetStation);
          if (this._abortPlayback || playbackId !== this._playbackId) break;
          await this._sleepWithAbort(500, playbackId);
        }
        break;
      }

      case ACTION_TYPES.PLAY_EMOTE: {
        if (actor) {
          const emote = step.data.emote || 'jump';
          await actor.playEmotePromise(emote);
        }
        break;
      }

      case ACTION_TYPES.FOLLOW: {
        const targetId = step.data.targetCharacterId;
        if (this.character?.followCharacter && targetId) {
          await this.character.followCharacter(step.actorId || this.character.selectedId, targetId, {
            duration: step.duration || step.data.duration || 10,
            offset: step.data.offset || { x: 0, y: 0, z: 1.2 },
          });
        }
        break;
      }

      case ACTION_TYPES.SET_VISIBILITY: {
        const visible = Boolean(step.data.visible);
        if (this.character?.setVisible) this.character.setVisible(step.actorId || this.character.selectedId, visible);
        else actor?.setVisible?.(visible);
        break;
      }

      case ACTION_TYPES.PLAY_SPRITE_ANIMATION: {
        if (!this.spriteAnimationManager) throw new Error('2D spritesheet yöneticisi bulunamadı.');
        await this.spriteAnimationManager.playAnimation(step.actorId, {
          duration: step.duration || step.data.duration || 2,
          fps: step.data.fps,
          loop: step.data.loop !== false,
        });
        break;
      }

      default:
        console.warn('Bilinmeyen timeline eylemi:', step.type);
    }
  }

  /**
   * İptal veya pause duyarlı uyku
   * @private
   */
  _sleepWithAbort(ms, playbackId = this._playbackId) {
    return new Promise((resolve) => {
      let elapsed = 0;
      let previous = performance.now();
      const interval = setInterval(() => {
        const now = performance.now();
        if (this._abortPlayback || playbackId !== this._playbackId) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (!this.isPaused) elapsed += now - previous;
        previous = now;
        if (!this.isPaused && elapsed >= ms) {
          clearInterval(interval);
          resolve();
        }
      }, 30);
    });
  }

  _waitUntilResumed(playbackId) {
    if (this._abortPlayback || playbackId !== this._playbackId) return Promise.resolve(false);
    if (!this.isPaused) return Promise.resolve(true);
    return new Promise((resolve) => {
      const check = () => {
        if (this._abortPlayback || playbackId !== this._playbackId) return resolve(false);
        if (!this.isPaused) return resolve(true);
        setTimeout(check, 30);
      };
      check();
    });
  }

  /**
   * Oynatmayı duraklatır
   */
  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      this.character?.pauseAll?.(true);
      this.spriteAnimationManager?.pauseAll?.(true);
      this._notify();
    }
  }

  /**
   * Oynatmayı tamamen durdurur ve başa alır
   */
  stop() {
    this._playbackId += 1;
    this._abortPlayback = true;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentStepIndex = -1;
    this.character?.pauseAll?.(false);
    this.character?.stopAllMotions?.();
    this.spriteAnimationManager?.pauseAll?.(false);
    this.spriteAnimationManager?.stopAll?.();
    this.door?.cancelTransition?.();
    this.cameraManager?.cancelTransition?.();

    if (this._pausePromiseResolver) {
      this._pausePromiseResolver();
      this._pausePromiseResolver = null;
    }

    this._notify();
  }

  /**
   * Hazırlanan sahne akışını JSON dizesi olarak dışa aktarır
   * @returns {string}
   */
  exportSequence() {
    const payload = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      playMode: this.playMode,
      steps: this.steps,
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * JSON dosyasını kullanıcı cihazına indirir
   */
  downloadSequenceJSON(filename = 'monochrome-timeline.json') {
    const jsonStr = this.exportSequence();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * JSON dizesinden veya nesneden kuyruğu yükler
   * @param {string|Object} jsonInput
   */
  importSequence(jsonInput) {
    try {
      const data = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
      const rawSteps = Array.isArray(data) ? data : data?.steps;
      if (!Array.isArray(data) && data?.playMode !== undefined && !['sequential', 'scheduled'].includes(data.playMode)) {
        throw new Error('Zaman çizelgesi oynatma modu geçersiz.');
      }
      if (!Array.isArray(rawSteps)) {
        throw new Error('Geçersiz sequence JSON yapısı: "steps" dizisi bulunamadı.');
      }
      if (rawSteps.length > 5000) {
        throw new Error('Zaman çizelgesi en fazla 5000 adım içerebilir.');
      }

      const allowedTypes = new Set(Object.values(ACTION_TYPES));
      const allowedEmotes = new Set(['jump', 'wave', 'spin']);
      const validatedSteps = rawSteps.map((step, index) => {
        if (!step || typeof step !== 'object' || Array.isArray(step) || !allowedTypes.has(step.type)) {
          throw new Error(`${index + 1}. adımın türü geçersiz.`);
        }
        const data = step.data && typeof step.data === 'object' && !Array.isArray(step.data)
          ? step.data
          : {};
        let cleanData;
        switch (step.type) {
          case ACTION_TYPES.MOVE_TO: {
            const coords = ['x', 'y', 'z'].map((key) => Number(data[key]));
            if (coords.some((value) => !Number.isFinite(value) || Math.abs(value) > 10000)) {
              throw new Error(`${index + 1}. adımın koordinatları geçersiz.`);
            }
            cleanData = { x: coords[0], y: coords[1], z: coords[2] };
            break;
          }
          case ACTION_TYPES.WAIT: {
            const duration = Number(data.duration ?? 1);
            if (!Number.isFinite(duration) || duration < 0 || duration > 3600) {
              throw new Error(`${index + 1}. adımın bekleme süresi 0–3600 saniye arasında olmalı.`);
            }
            cleanData = { duration };
            break;
          }
          case ACTION_TYPES.TRIGGER_DOOR: {
            const action = data.action ?? 'toggle';
            if (!['open', 'close', 'toggle'].includes(action)) {
              throw new Error(`${index + 1}. adımın kapı eylemi geçersiz.`);
            }
            cleanData = { action };
            break;
          }
          case ACTION_TYPES.SWITCH_CAMERA: {
            const stationId = typeof data.stationId === 'string' && data.stationId.length <= 128
              ? data.stationId
              : undefined;
            const stationIndex = Number(data.stationIndex);
            if (!stationId && (!Number.isInteger(stationIndex) || stationIndex < 0 || stationIndex > 10000)) {
              throw new Error(`${index + 1}. adımın kamera hedefi geçersiz.`);
            }
            cleanData = stationId ? { stationId } : { stationIndex };
            break;
          }
          case ACTION_TYPES.PLAY_EMOTE: {
            const emote = data.emote ?? 'jump';
            if (!allowedEmotes.has(emote)) {
              throw new Error(`${index + 1}. adımın emote değeri geçersiz.`);
            }
            cleanData = { emote };
            break;
          }
          case ACTION_TYPES.FOLLOW: {
            const targetCharacterId = typeof data.targetCharacterId === 'string' && data.targetCharacterId.length <= 128
              ? data.targetCharacterId
              : '';
            if (!targetCharacterId) throw new Error(`${index + 1}. adımın takip karakteri geçersiz.`);
            const rawOffset = data.offset && typeof data.offset === 'object' ? data.offset : {};
            const offset = { x: Number(rawOffset.x ?? 0), y: Number(rawOffset.y ?? 0), z: Number(rawOffset.z ?? 1.2) };
            if (Object.values(offset).some((value) => !Number.isFinite(value) || Math.abs(value) > 1000)) {
              throw new Error(`${index + 1}. adımın takip mesafesi geçersiz.`);
            }
            cleanData = { targetCharacterId, offset };
            break;
          }
          case ACTION_TYPES.SET_VISIBILITY: {
            if (typeof data.visible !== 'boolean') throw new Error(`${index + 1}. adımın görünürlük değeri geçersiz.`);
            cleanData = { visible: data.visible };
            break;
          }
          case ACTION_TYPES.PLAY_SPRITE_ANIMATION: {
            const fps = Number(data.fps ?? 12);
            const loop = data.loop ?? true;
            if (!Number.isFinite(fps) || fps < 1 || fps > 60 || typeof loop !== 'boolean') {
              throw new Error(`${index + 1}. adımın 2D animasyon ayarları geçersiz.`);
            }
            cleanData = { fps, loop };
            break;
          }
        }
        const title = typeof step.title === 'string' ? step.title.slice(0, 160) : '';
        const actorId = step.actorId === undefined ? undefined : (typeof step.actorId === 'string' && step.actorId.length <= 128 ? step.actorId : null);
        const startAt = step.startAt === undefined ? undefined : Number(step.startAt);
        const duration = step.duration === undefined ? undefined : Number(step.duration);
        if (actorId === null || (startAt !== undefined && (!Number.isFinite(startAt) || startAt < 0 || startAt > 3600))) {
          throw new Error(`${index + 1}. adımın karakteri veya başlangıç zamanı geçersiz.`);
        }
        if (step.type === ACTION_TYPES.PLAY_SPRITE_ANIMATION && !actorId) {
          throw new Error(`${index + 1}. adım için bir 2D sprite seçilmemiş.`);
        }
        if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > 3600)) {
          throw new Error(`${index + 1}. adımın süresi 0–3600 saniye arasında olmalı.`);
        }
        return {
          id: `step-import-${index + 1}`,
          type: step.type,
          title: title || this._getDefaultTitleForType(step.type, cleanData),
          data: cleanData,
          ...(actorId === undefined ? {} : { actorId }),
          ...(startAt === undefined ? {} : { startAt }),
          ...(duration === undefined ? {} : { duration }),
        };
      });

      this.stop();
      this.steps = validatedSteps;
      this.playMode = data?.playMode === 'scheduled' ? 'scheduled' : 'sequential';
      this._notify();
      return true;
    } catch (err) {
      console.error('Sequence içe aktarma hatası:', err);
      throw err;
    }
  }
}
