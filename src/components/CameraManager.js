/**
 * CameraManager.js
 * Serbest kamera (OrbitControls) ve Sabit CCTV kamera istasyonlarını yöneten sınıf.
 * Karakter odaya girdiğinde (BoundingBox tetikleyicisi) otomatik iç tavan/oda açısına yumuşak geçiş yapar.
 * Timeline/Reji sistemi için transitionToStationPromise desteği sunar.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraManager {
  /**
   * @param {THREE.PerspectiveCamera} camera - Ana kamera
   * @param {HTMLElement} domElement - Canvas DOM öğesi
   * @param {Function} onStateChange - Durum değişim bildirim işlevi
   */
  constructor(camera, domElement, onStateChange = () => {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.onStateChange = onStateChange;

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 1.2, 0);
    this.controls.maxDistance = 180;
    this.controls.minDistance = 0.5;

    // İstasyon Listesi
    this.stations = [];
    this.activeStationId = null;
    this.activePresetId = null;
    this.presets = [
      { id: 'front', name: 'Ön', offset: new THREE.Vector3(0, 2.4, 8) },
      { id: 'side', name: 'Yan', offset: new THREE.Vector3(8, 2.4, 0) },
      { id: 'top', name: 'Üst', offset: new THREE.Vector3(0, 11, 0.01) },
      { id: 'isometric', name: 'İzometrik', offset: new THREE.Vector3(8, 6, 8) },
    ];

    // Lerp Yumuşak Geçiş Durumu
    this.isTransitioning = false;
    this.transitionStartTime = 0;
    this.transitionDuration = 900; // ms
    this.startPos = new THREE.Vector3();
    this.startTarget = new THREE.Vector3();
    this.endPos = new THREE.Vector3();
    this.endTarget = new THREE.Vector3();
    this.transitionResolve = null;

    // Kamera Turu Durumu
    this.isTourActive = false;
    this.tourIndex = 0;
    this.tourTimer = null;

    // Karakteri Takip Etme
    this.followCharacter = true;

    // Oda İç/Dış Tetikleyici Durumu (BoundingBox Trigger)
    this.isCharacterInsideRoom = false;

    // Varsayılan İstasyonları Tanımla
    this._initDefaultStations();

    // Kullanıcı manuel döndürürse kilit modunu aç
    this.controls.addEventListener('start', () => {
      if (!this.isTransitioning && this.activeStationId !== null) {
        this.setFreeMode();
      }
    });
  }

  /**
   * Varsayılan dış ve iç CCTV kamera istasyonlarını ekler
   * @private
   */
  _initDefaultStations() {
    this.stations.push({
      id: 'station-ext',
      name: 'Dış Saha (Kamera 1)',
      position: new THREE.Vector3(12, 10, 16),
      target: new THREE.Vector3(0, 1.0, 0),
      isAutoTrigger: false,
    });

    this.interiorCCTV = {
      id: 'station-interior-cctv',
      name: 'İç Mekan CCTV (Tavan)',
      position: new THREE.Vector3(3.2, 3.4, -4.8),
      target: new THREE.Vector3(0, 1.0, -8.2),
      isAutoTrigger: true,
    };
    this.stations.push(this.interiorCCTV);
  }

  /**
   * Serbest kamera moduna döner (OrbitControls açılır)
   */
  setFreeMode() {
    this.isTransitioning = false;
    this.controls.enabled = true;
    this.activeStationId = null;
    this.activePresetId = null;

    if (this.isTourActive) {
      this.stopTour();
    }

    this.onStateChange({
      mode: 'free',
      stationName: 'Serbest Orbit',
      stations: this.stations,
      activeId: null,
    });
  }

  /**
   * Belirtilen kamera istasyonuna yumuşak geçiş yapar
   * @param {Object|string} stationOrId
   */
  transitionToStation(stationOrId) {
    let station = typeof stationOrId === 'string'
      ? this.stations.find((s) => s.id === stationOrId)
      : stationOrId;

    if (!station && typeof stationOrId === 'number') {
      station = this.stations[stationOrId];
    }
    if (!station) return;

    this.activeStationId = station.id;
    this.activePresetId = null;

    this.startPos.copy(this.camera.position);
    this.startTarget.copy(this.controls.target);
    this.endPos.copy(station.position);
    this.endTarget.copy(station.target);

    this.transitionStartTime = performance.now();
    this.isTransitioning = true;
    this.controls.enabled = false;

    this.onStateChange({
      mode: 'locked',
      stationName: station.name,
      stations: this.stations,
      activeId: station.id,
    });
  }

  transitionToPreset(presetId, target = new THREE.Vector3()) {
    const preset = this.presets.find((item) => item.id === presetId);
    if (!preset || !target) return false;
    this.activeStationId = `preset-${preset.id}`;
    this.activePresetId = preset.id;
    this.startPos.copy(this.camera.position);
    this.startTarget.copy(this.controls.target);
    this.endPos.copy(target).add(preset.offset);
    this.endTarget.copy(target);
    this.transitionStartTime = performance.now();
    this.isTransitioning = true;
    this.controls.enabled = false;
    this.onStateChange({ mode: 'locked', stationName: `${preset.name} Görünümü`, stations: this.stations, activeId: this.activeStationId });
    return true;
  }

  /**
   * Timeline / Async için Promise döndüren kamera geçişi
   * @param {Object|string|number} stationOrId
   * @returns {Promise<void>}
   */
  transitionToStationPromise(stationOrId) {
    this.transitionToStation(stationOrId);
    return new Promise((resolve) => {
      if (!this.isTransitioning) {
        resolve();
      } else {
        this.transitionResolve = resolve;
      }
    });
  }

  cancelTransition() {
    if (!this.isTransitioning && !this.transitionResolve) return false;
    this.isTransitioning = false;
    this.controls.enabled = true;
    this.activeStationId = null;
    this.activePresetId = null;
    const resolve = this.transitionResolve;
    this.transitionResolve = null;
    resolve?.();
    this.onStateChange({ mode: 'free', stationName: 'Serbest Orbit', stations: this.stations, activeId: null });
    return true;
  }

  /**
   * Mevcut kamera açısını yeni bir istasyon olarak kaydeder
   */
  addCurrentAsStation() {
    const nextNum = this.stations.length + 1;
    const newStation = {
      id: 'station-' + Date.now(),
      name: `Kamera ${nextNum}`,
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      isAutoTrigger: false,
    };

    this.stations.push(newStation);
    this.onStateChange({
      mode: this.activeStationId ? 'locked' : 'free',
      stations: this.stations,
      activeId: this.activeStationId,
    });
    return newStation;
  }

  /**
   * Belirtilen ID'ye sahip istasyonu siler
   * @param {string} id
   */
  removeStation(id) {
    if (id === 'station-ext' || !this.stations.some((station) => station.id === id)) return false;
    this.stations = this.stations.filter((station) => station.id !== id);
    this._stationListChanged(id);
    return true;
  }

  /** Rename a station; names are trimmed and limited to 80 characters. */
  renameStation(id, name) {
    if (typeof name !== 'string') return false;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 80) return false;
    const station = this.stations.find((item) => item.id === id);
    if (!station) return false;
    station.name = trimmedName;
    this.onStateChange({ mode: this.activeStationId ? 'locked' : 'free', stations: this.stations, activeId: this.activeStationId });
    return true;
  }

  /** Move a station to a zero-based list index; returns false for invalid or protected moves. */
  reorderStation(id, index) {
    const fromIndex = this.stations.findIndex((station) => station.id === id);
    if (fromIndex < 0 || id === 'station-ext' || !Number.isInteger(index) || index < 0 || index >= this.stations.length) return false;
    if (fromIndex > 0 && index === 0) return false;
    if (fromIndex === index) return true;
    const [station] = this.stations.splice(fromIndex, 1);
    this.stations.splice(index, 0, station);
    this._stationListChanged();
    return true;
  }

  _stationListChanged(removedId = null) {
    if (removedId && this.activeStationId === removedId) this.setFreeMode();
    else this.onStateChange({ mode: this.activeStationId ? 'locked' : 'free', stations: this.stations, activeId: this.activeStationId });
    if (this.isTourActive) {
      if (this.stations.length < 2) {
        this.stopTour();
        this.tourIndex = 0;
      } else {
        this.tourIndex = ((this.tourIndex % this.stations.length) + this.stations.length) % this.stations.length;
        if (this.tourIndex > 0) this.tourIndex = 0;
      }
    } else {
      this.tourIndex = this.stations.length ? Math.min(this.tourIndex, this.stations.length - 1) : 0;
    }
  }

  /**
   * İstasyonun üzerine o anki açıyı kaydeder
   * @param {string} id
   */
  updateStation(id) {
    const s = this.stations.find((item) => item.id === id);
    if (s) {
      s.position.copy(this.camera.position);
      s.target.copy(this.controls.target);
      this.onStateChange({
        mode: this.activeStationId ? 'locked' : 'free',
        stations: this.stations,
        activeId: this.activeStationId,
      });
    }
  }

  exportProjectStateForStorage() {
    return {
      stations: this.stations.map((station) => ({
        id: station.id, name: station.name,
        position: { x: station.position.x, y: station.position.y, z: station.position.z },
        target: { x: station.target.x, y: station.target.y, z: station.target.z },
        isAutoTrigger: Boolean(station.isAutoTrigger),
      })),
      activeStationId: this.activeStationId,
      followCharacter: this.followCharacter,
    };
  }

  restoreProjectState(state = {}) {
    const defaults = [
      { id: 'station-ext', name: 'Dış Saha (Kamera 1)', position: { x: 12, y: 10, z: 16 }, target: { x: 0, y: 1, z: 0 }, isAutoTrigger: false },
      { id: 'station-interior-cctv', name: 'İç Mekan CCTV (Tavan)', position: { x: 3.2, y: 3.4, z: -4.8 }, target: { x: 0, y: 1, z: -8.2 }, isAutoTrigger: true },
    ];
    const rows = Array.isArray(state.stations) ? state.stations : defaults;
    const restored = rows.flatMap((station) => {
      const values = [station?.position?.x, station?.position?.y, station?.position?.z, station?.target?.x, station?.target?.y, station?.target?.z].map(Number);
      if (!station?.id || !station?.name || values.some((value) => !Number.isFinite(value))) return [];
      return [{ id: String(station.id).slice(0, 128), name: String(station.name).trim().slice(0, 80) || 'Kamera',
        position: new THREE.Vector3(...values.slice(0, 3)), target: new THREE.Vector3(...values.slice(3)), isAutoTrigger: Boolean(station.isAutoTrigger) }];
    });
    const makeDefault = (fallback) => ({ ...fallback, position: new THREE.Vector3(fallback.position.x, fallback.position.y, fallback.position.z), target: new THREE.Vector3(fallback.target.x, fallback.target.y, fallback.target.z) });
    if (!restored.some((station) => station.id === 'station-ext')) restored.unshift(makeDefault(defaults[0]));
    if (!restored.some((station) => station.id === 'station-interior-cctv')) restored.splice(Math.min(1, restored.length), 0, makeDefault(defaults[1]));
    if (restored[0]?.id !== 'station-ext') {
      const exteriorIndex = restored.findIndex((station) => station.id === 'station-ext');
      restored.unshift(restored.splice(exteriorIndex, 1)[0]);
    }
    this.stopTour();
    this.stations = restored;
    this.interiorCCTV = this.stations.find((station) => station.id === 'station-interior-cctv');
    this.followCharacter = state.followCharacter !== false;
    this.activeStationId = this.stations.some((station) => station.id === state.activeStationId) ? state.activeStationId : null;
    if (this.activeStationId && this.camera && this.controls) this.transitionToStation(this.activeStationId);
    else if (!this.activeStationId && this.controls) this.setFreeMode();
    else this.onStateChange({ mode: this.activeStationId ? 'locked' : 'free', stationName: this.stations.find((station) => station.id === this.activeStationId)?.name || 'Serbest Orbit', stations: this.stations, activeId: this.activeStationId });
    return true;
  }

  /**
   * Otomatik kamera turunu başlatır
   */
  startTour() {
    if (this.stations.length < 2) return false;
    this.isTourActive = true;
    this.tourIndex = 0;
    this._playTourStep();
    return true;
  }

  stopTour() {
    this.isTourActive = false;
    clearTimeout(this.tourTimer);
  }

  _playTourStep() {
    if (!this.isTourActive) return;
    if (this.stations.length < 2) { this.stopTour(); this.tourIndex = 0; return; }
    this.tourIndex = ((this.tourIndex % this.stations.length) + this.stations.length) % this.stations.length;
    const station = this.stations[this.tourIndex];
    if (!station) { this.stopTour(); this.tourIndex = 0; return; }
    this.transitionToStation(station);

    this.tourIndex = (this.tourIndex + 1) % this.stations.length;
    this.tourTimer = setTimeout(() => {
      if (this.isTourActive) this._playTourStep();
    }, 3400);
  }

  /**
   * Karakterin odaya girip girmediğini BoundingBox ile denetler
   * @private
   */
  _checkRoomBoundsTrigger(characterPos, roomBounds) {
    if (!characterPos || !roomBounds) return;

    const isInsideNow = roomBounds.containsPoint(characterPos);

    if (isInsideNow && !this.isCharacterInsideRoom) {
      this.isCharacterInsideRoom = true;
      if (!this.isTourActive) {
        this.transitionToStation(this.interiorCCTV);
      }
    } else if (!isInsideNow && this.isCharacterInsideRoom) {
      this.isCharacterInsideRoom = false;
      if (!this.isTourActive) {
        const extStation = this.stations.find((s) => s.id === 'station-ext') || this.stations[0];
        if (extStation) {
          this.transitionToStation(extStation);
        }
      }
    }
  }

  /**
   * Her karede kamera hareketini ve takip sistemini günceller
   * @param {number} delta - Süre
   * @param {THREE.Vector3} characterPos - Karakterin güncel konumu
   * @param {THREE.Box3} roomBounds - Odanın BoundingBox'ı
   */
  update(delta, characterPos, roomBounds) {
    const now = performance.now();

    // 1. Odaya Giriş / Çıkış BoundingBox Tetikleyicisini Denetle
    this._checkRoomBoundsTrigger(characterPos, roomBounds);

    // 2. İstasyonlar Arası Yumuşak Lerp Geçişi
    if (this.isTransitioning) {
      const elapsed = now - this.transitionStartTime;
      const progress = Math.min(1.0, elapsed / this.transitionDuration);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      this.camera.position.lerpVectors(this.startPos, this.endPos, ease);
      this.controls.target.lerpVectors(this.startTarget, this.endTarget, ease);
      this.camera.lookAt(this.controls.target);

      if (progress >= 1.0) {
        this.camera.position.copy(this.endPos);
        this.controls.target.copy(this.endTarget);
        this.isTransitioning = false;
        this.controls.enabled = false;

        if (this.transitionResolve) {
          const res = this.transitionResolve;
          this.transitionResolve = null;
          res();
        }
      }
    } else {
      // 3. Karakteri Takip Etme Mantığı
      if (this.followCharacter && characterPos) {
        const charHead = new THREE.Vector3(characterPos.x, characterPos.y + 0.9, characterPos.z);

        if (this.activeStationId !== null) {
          this.controls.target.lerp(charHead, delta * 6.0);
          this.camera.lookAt(this.controls.target);
        } else if (this.controls.enabled) {
          this.controls.target.lerp(charHead, delta * 6.0);
        }
      }

      if (this.controls.enabled) {
        this.controls.update();
      }
    }
  }

  setFollow(enable) {
    this.followCharacter = enable;
  }
}
