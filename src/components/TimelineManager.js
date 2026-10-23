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
};

export class TimelineManager {
  /**
   * @param {Object} options
   * @param {import('./Character.js').Character} options.character
   * @param {import('./Door.js').Door} options.door
   * @param {import('./CameraManager.js').CameraManager} options.cameraManager
   * @param {Function} options.onStateChange
   */
  constructor({ character, door, cameraManager, onStateChange = () => {} }) {
    this.character = character;
    this.door = door;
    this.cameraManager = cameraManager;
    this.onStateChange = onStateChange;

    // Kuyruk Adımları
    this.steps = [];

    // Oynatma Durumu
    this.isPlaying = false;
    this.isPaused = false;
    this.currentStepIndex = -1;
    this._abortPlayback = false;
    this._pausePromiseResolver = null;

    // Adım Kaydetme Modu
    this.isRecording = false;

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
  recordClickAsStep(type, data) {
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
    };

    this.steps.push(step);
    this._notify();
    return step;
  }

  /**
   * Manuel adım ekleme
   */
  addStep(type, data = {}, title = '') {
    const step = {
      id: 'step-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type,
      title: title || this._getDefaultTitleForType(type, data),
      data,
    };
    this.steps.push(step);
    this._notify();
    return step;
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
    if (this.steps.length === 0) return;

    if (this.isPaused) {
      // Duraklatılmış yerden devam et
      this.isPaused = false;
      this.isPlaying = true;
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

    // Eğer son adımdaysak başa dön
    if (this.currentStepIndex < 0 || this.currentStepIndex >= this.steps.length - 1) {
      this.currentStepIndex = 0;
    }

    this._notify();

    let playbackFailed = false;
    try {
      while (this.currentStepIndex < this.steps.length) {
        if (this._abortPlayback) break;

        // Pause bekleme kontrolü
        if (this.isPaused) {
          await new Promise((resolve) => {
            this._pausePromiseResolver = resolve;
          });
          if (this._abortPlayback) break;
        }

        const step = this.steps[this.currentStepIndex];
        this._notify();

        await this._executeStep(step);

        if (this._abortPlayback) break;
        this.currentStepIndex++;
      }
    } catch (err) {
      playbackFailed = true;
      console.error('Timeline oynatma hatası:', err);
    } finally {
      this.isPlaying = false;
      this.isPaused = false;
      if (this.currentStepIndex >= this.steps.length) {
        this.currentStepIndex = -1; // Tamamlandı
      }
      this._notify();
    }
    return !playbackFailed && !this._abortPlayback;
  }

  /**
   * Tek bir adımı çalıştırır
   * @private
   */
  async _executeStep(step) {
    if (!step) return;

    switch (step.type) {
      case ACTION_TYPES.MOVE_TO: {
        if (this.character && step.data) {
          await this.character.moveToPromise(step.data);
        }
        break;
      }

      case ACTION_TYPES.WAIT: {
        const ms = (step.data.duration || 1) * 1000;
        await this._sleepWithAbort(ms);
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
          await this._sleepWithAbort(400); // Yumuşak ara
        }
        break;
      }

      case ACTION_TYPES.SWITCH_CAMERA: {
        if (this.cameraManager) {
          const targetStation = step.data.stationId || step.data.stationIndex || 0;
          await this.cameraManager.transitionToStationPromise(targetStation);
          await this._sleepWithAbort(500);
        }
        break;
      }

      case ACTION_TYPES.PLAY_EMOTE: {
        if (this.character) {
          const emote = step.data.emote || 'jump';
          await this.character.playEmotePromise(emote);
        }
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
  _sleepWithAbort(ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      const interval = setInterval(() => {
        if (this._abortPlayback) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (!this.isPaused && performance.now() - start >= ms) {
          clearInterval(interval);
          resolve();
        }
      }, 30);
    });
  }

  /**
   * Oynatmayı duraklatır
   */
  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      this._notify();
    }
  }

  /**
   * Oynatmayı tamamen durdurur ve başa alır
   */
  stop() {
    this._abortPlayback = true;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentStepIndex = -1;

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
        }
        const title = typeof step.title === 'string' ? step.title.slice(0, 160) : '';
        return {
          id: `step-import-${index + 1}`,
          type: step.type,
          title: title || this._getDefaultTitleForType(step.type, cleanData),
          data: cleanData,
        };
      });

      this.stop();
      this.steps = validatedSteps;
      this._notify();
      return true;
    } catch (err) {
      console.error('Sequence içe aktarma hatası:', err);
      throw err;
    }
  }
}
