/**
 * UIManager.js
 * Monokrom Stüdyo HUD Panelini yöneten arayüz sınıfı.
 * Sekmeler (Sahne, Kameralar, Karakter, Reji/Timeline, Render/Dışa Aktar),
 * kaydırıcılar, sinematik mod ('H' kısayolu), bildirimler (Toast) ve
 * video/ekran görüntüsü dışa aktarma (RecorderManager) kontrollerini yönetir.
 */

import { AutosaveCoordinator } from './AutosaveCoordinator.js';
import { saveGeneratedFile, shareGeneratedFile } from '../utils/FileExportManager.js';
import { calculateProjectBytes, migrateProjectRecord, PROJECT_SCHEMA_VERSION } from './ProjectStore.js';
import { getDeviceMemoryGiB, getDevicePerformanceProfile } from '../utils/device-profile.js';

const MAX_INLINE_PREVIEW_BYTES = 32 * 1024 * 1024;

function saveResultMessage(label, result) {
  if (result?.canceled) return `${label} kaydetme işlemi iptal edildi.`;
  if (!result?.saved) return result?.error || `${label} cihaza kaydedilemedi.`;
  const filename = result.filename || 'dosya';
  if (result.method === 'browser') return `${label} indiriliyor: ${filename} · Tarayıcı indirilenleri`;
  const location = result.location || result.path || (result.method === 'capacitor' ? 'Documents/Animationer' : '');
  return `${label} kaydedildi: ${filename}${location ? ` · ${location}` : ''}`;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBlob(data, type) {
  if (typeof data !== 'string' || !data) throw new Error('Proje görsel verisi eksik.');
  const binary = atob(data);
  const chunks = [];
  for (let offset = 0; offset < binary.length; offset += 0x8000) {
    const end = Math.min(binary.length, offset + 0x8000);
    const bytes = new Uint8Array(end - offset);
    for (let index = offset; index < end; index++) bytes[index - offset] = binary.charCodeAt(index);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: type || 'application/octet-stream' });
}

export class UIManager {
  /**
   * @param {Object} context
   * @param {import('./TimelineManager.js').TimelineManager} context.timelineManager
   * @param {import('./Character.js').Character} context.character
   * @param {import('./Door.js').Door} context.door
   * @param {import('./CameraManager.js').CameraManager} context.cameraManager
   * @param {import('./MapLoader.js').MapLoader} context.mapLoader
   * @param {import('./RecorderManager.js').RecorderManager} [context.recorderManager]
   * @param {Object} context.sceneHelpers - gridHelper, dirLight, hemiLight referansları
   */
  constructor({ timelineManager, character, characterManager, spriteAnimationManager, worldSpriteCharacterManager = null, projectStore = null, projectId = '', projectName = 'Yeni Proje', onReturnHome = () => {}, worldSpriteReady = Promise.resolve(), onControlModeChange = () => {}, door, cameraManager, mapLoader, recorderManager, sceneHelpers }) {
    this.timeline = timelineManager;
    this.character = character;
    this.characters = characterManager || character;
    this.sprites = spriteAnimationManager;
    this.worldSprites = worldSpriteCharacterManager;
    this.projectStore = projectStore;
    this.projectId = projectId;
    this.projectName = projectName;
    this.onReturnHome = onReturnHome;
    this.worldSpriteReady = worldSpriteReady;
    this.onControlModeChange = onControlModeChange;
    this.door = door;
    this.cameraManager = cameraManager;
    this.mapLoader = mapLoader;
    this.recorder = recorderManager;
    this.sceneHelpers = sceneHelpers || {};

    this.isPanelHidden = false; // 'H' tuşu ve sinematik mod
    this.isCollapsed = false; // Mobilde paneli küçültme
    this.activeTab = 'tab-timeline'; // Başlangıçta Reji/Timeline açık olsun
    this.recordingPreviewUrl = null;

    this._cacheDOM();
    this._bindEvents();
    this._initShortcuts();
    this.autosave = new AutosaveCoordinator({
      timeline: this.timeline,
      sprites: this.sprites,
      characters: this.characters,
      mapLoader: this.mapLoader,
      worldSprites: this.worldSprites,
      projectStore: this.projectStore,
      projectId: this.projectId,
      projectName: this.projectName,
      worldSpriteReady: this.worldSpriteReady,
      onStatus: (msg) => { if (this.dom?.autosaveStatus) this.dom.autosaveStatus.textContent = msg; },
      onError: (msg) => this.showToast(msg),
    });
    this.autosave.connect();
    if (this.dom.panelBody) {
      this.dom.panelBody.inert = true;
      this.dom.panelBody.setAttribute('aria-busy', 'true');
      this.autosave.ready.finally(() => {
        this.dom.panelBody.inert = false;
        this.dom.panelBody.removeAttribute('aria-busy');
      }).catch(() => {});
    }

    // İlk durum senkronizasyonu
    this.updateTimelineUI();
    this.updateCameraList(this.cameraManager.stations, this.cameraManager.activeStationId);
    this.updateCharacterList(this.characters?.list?.() || []);
    this.updateSpriteList(this.sprites?.list?.() || [], this.sprites?.selectedId);
    this.updateWorldSpriteUI();
    this.updateRecorderUI({
      maxRecordingBytes: this.recorder?.maxRecordingBytes,
      maxDurationSeconds: this.recorder?.maxDurationSeconds,
      maxFrameRate: this.recorder?.maxFrameRate,
      frameRate: this.recorder?.frameRate,
      width: this.recorder?.canvas?.width,
      height: this.recorder?.canvas?.height,
    });
  }

  setRecorder(recorderManager) {
    this.recorder = recorderManager;
  }

  _cacheDOM() {
    this.dom = {
      // Ana Panel & Başlık
      studioPanel: document.getElementById('studio-panel'),
      btnToggleVisibility: document.getElementById('btn-toggle-hud-vis'),
      btnRestorePanel: document.getElementById('btn-restore-studio-panel'),
      btnCollapseHeader: document.getElementById('panel-collapse-trigger'),
      panelCollapseArrow: document.getElementById('panel-collapse-arrow'),
      panelBody: document.getElementById('panel-body-wrapper'),

      // Üst Durum Rozetleri
      badgeRecorderMode: document.getElementById('badge-recorder-mode'),
      labelRecorderMode: document.getElementById('label-recorder-mode'),
      badgeRecordMode: document.getElementById('badge-record-mode'),
      labelRecordMode: document.getElementById('label-record-mode'),
      badgeTimelineStatus: document.getElementById('badge-timeline-status'),
      labelTimelineStatus: document.getElementById('label-timeline-status'),
      badgeCameraMode: document.getElementById('badge-camera-mode'),
      labelCameraMode: document.getElementById('label-camera-mode'),
      badgeDoorMode: document.getElementById('badge-door-mode'),
      labelDoorMode: document.getElementById('label-door-mode'),

      // Hızlı Üst Butonlar
      btnQuickPlay: document.getElementById('btn-quick-play'),
      btnQuickDoor: document.getElementById('btn-quick-door'),
      btnCinematic: document.getElementById('btn-cinematic-mode'),
      btnHomeScreen: document.getElementById('btn-home-screen'),

      // Sekme Butonları & Panelleri
      tabButtons: document.querySelectorAll('.studio-tab-btn'),
      tabPanes: document.querySelectorAll('.studio-tab-pane'),

      // Sekme 1: REJİ / TIMELINE
      timelineListContainer: document.getElementById('timeline-steps-list'),
      autosaveStatus: document.getElementById('autosave-status'),
      btnTimelinePlay: document.getElementById('btn-timeline-play'),
      btnTimelinePause: document.getElementById('btn-timeline-pause'),
      btnTimelineStop: document.getElementById('btn-timeline-stop'),
      btnToggleRecord: document.getElementById('btn-toggle-record-mode'),
      btnAddWaitStep: document.getElementById('btn-add-wait-step'),
      btnAddDoorStep: document.getElementById('btn-add-door-step'),
      btnAddCamStep: document.getElementById('btn-add-cam-step'),
      btnAddEmoteStep: document.getElementById('btn-add-emote-step'),
      btnExportJSON: document.getElementById('btn-export-timeline-json'),
      btnImportJSON: document.getElementById('btn-import-timeline-json'),
      fileInputJSON: document.getElementById('file-picker-timeline-json'),
      btnClearTimeline: document.getElementById('btn-clear-timeline'),
      timelinePlayMode: document.getElementById('timeline-play-mode'),
      timelineStartAt: document.getElementById('timeline-start-at'),
      timelineDuration: document.getElementById('timeline-duration'),
      timelineFollowTarget: document.getElementById('timeline-follow-target'),
      btnAddFollowStep: document.getElementById('btn-add-follow-step'),
      btnAddHideStep: document.getElementById('btn-add-hide-step'),

      // Sekme 2: SAHNE / HARİTA
      filePicker: document.getElementById('file-picker'),
      btnTriggerFile: document.getElementById('btn-trigger-file-pick'),
      dropZone: document.getElementById('studio-drop-zone'),
      btnOrientHorizontal: document.getElementById('btn-orient-horizontal'),
      btnOrientVertical: document.getElementById('btn-orient-vertical'),
      sliderImageSize: document.getElementById('slider-image-size'),
      labelImageSize: document.getElementById('label-image-size'),
      sliderImageAlpha: document.getElementById('slider-image-alpha'),
      labelImageAlpha: document.getElementById('label-image-alpha'),
      panelImageControls: document.getElementById('panel-image-controls'),
      btnToggleGrid: document.getElementById('btn-toggle-grid'),
      btnToggleLights: document.getElementById('btn-toggle-lights'),
      btnDemoFloorplan: document.getElementById('btn-demo-floorplan'),
      btnDemoGallery: document.getElementById('btn-demo-gallery'),
      btnFocusMap: document.getElementById('btn-focus-map'),
      btnClearMap: document.getElementById('btn-clear-map'),
      btnAddWallBox: document.getElementById('btn-add-wall-box'),
      btnClearWallBoxes: document.getElementById('btn-clear-wall-boxes'),
      wallBoxList: document.getElementById('studio-wall-box-list'),

      // Sekme 3: KAMERALAR
      btnFreeOrbit: document.getElementById('btn-free-orbit'),
      btnAddCamera: document.getElementById('btn-add-camera'),
      btnToggleFollow: document.getElementById('btn-toggle-follow'),
      btnToggleTour: document.getElementById('btn-toggle-tour'),
      labelTourBtn: document.getElementById('label-tour-btn'),
      cameraListContainer: document.getElementById('studio-camera-list'),
      cameraPresetButtons: document.querySelectorAll('.camera-preset-btn'),
      btnToggleCctvPreview: document.getElementById('btn-toggle-cctv-preview'),
      cctvPreview: document.getElementById('cctv-preview'),

      // Sekme 4: KARAKTER & MERDİVEN
      sliderSpeed: document.getElementById('slider-character-speed'),
      labelSpeedVal: document.getElementById('label-speed-val'),
      sliderWobble: document.getElementById('slider-wobble-intensity'),
      labelWobbleVal: document.getElementById('label-wobble-val'),
      btnResetSpawn: document.getElementById('btn-reset-spawn'),
      btnEmoteJump: document.getElementById('btn-emote-jump'),
      btnEmoteWave: document.getElementById('btn-emote-wave'),
      btnEmoteSpin: document.getElementById('btn-emote-spin'),
      characterSelect: document.getElementById('character-select'),
      btnAddCharacter: document.getElementById('btn-add-character'),
      btnRemoveCharacter: document.getElementById('btn-remove-character'),
      btnLoadCharacter: document.getElementById('btn-load-character'),
      characterFilePicker: document.getElementById('file-picker-character'),
      controlModeSelect: document.getElementById('control-mode-select'),
      btnShowCharacter: document.getElementById('btn-show-character'),

      // Sekme 5: 2D Spritesheet Animasyonu
      spriteFilePicker: document.getElementById('file-picker-sprite-sheet'),
      btnLoadSpriteSheet: document.getElementById('btn-load-sprite-sheet'),
      spriteColumns: document.getElementById('sprite-columns'),
      spriteRows: document.getElementById('sprite-rows'),
      spriteFps: document.getElementById('sprite-fps'),
      spriteActorSelect: document.getElementById('sprite-actor-select'),
      spritePositionX: document.getElementById('sprite-position-x'),
      spritePositionY: document.getElementById('sprite-position-y'),
      spriteDisplayHeight: document.getElementById('sprite-display-height'),
      btnApplySpriteTransform: document.getElementById('btn-apply-sprite-transform'),
      btnPreviewSprite: document.getElementById('btn-preview-sprite'),
      btnAddSpriteTimelineStep: document.getElementById('btn-add-sprite-timeline-step'),
      btnRemoveSprite: document.getElementById('btn-remove-sprite'),
      spriteListContainer: document.getElementById('studio-sprite-list'),
      worldSpriteFilePicker: document.getElementById('file-picker-world-sprite'),
      worldSpriteName: document.getElementById('world-sprite-name'),
      worldSpriteColumns: document.getElementById('world-sprite-columns'),
      worldSpriteRows: document.getElementById('world-sprite-rows'),
      worldSpriteFps: document.getElementById('world-sprite-fps'),
      btnSaveWorldSpriteTemplate: document.getElementById('btn-save-world-sprite-template'),
      worldSpriteTemplateSelect: document.getElementById('world-sprite-template-select'),
      btnSpawnWorldSprite: document.getElementById('btn-spawn-world-sprite'),
      btnDeleteWorldSpriteTemplate: document.getElementById('btn-delete-world-sprite-template'),
      worldSpriteActorSelect: document.getElementById('world-sprite-actor-select'),
      btnWorldSpriteControl: document.getElementById('btn-world-sprite-control'),
      btnRemoveWorldSprite: document.getElementById('btn-remove-world-sprite'),
      worldSpriteListContainer: document.getElementById('studio-world-sprite-list'),

      // Sekme 5: DIŞA AKTAR / RENDER
      btnTakeScreenshot: document.getElementById('btn-take-screenshot'),
      btnQuality720p: document.getElementById('btn-quality-720p'),
      btnQuality1080p: document.getElementById('btn-quality-1080p'),
      btnFrameRate30: document.getElementById('btn-fps-30'),
      btnFrameRate60: document.getElementById('btn-fps-60'),
      labelRenderFps: document.getElementById('label-render-fps'),
      labelRenderRes: document.getElementById('label-render-res'),
      btnToggleVideoRecord: document.getElementById('btn-toggle-video-record'),
      btnRecordSequence: document.getElementById('btn-record-sequence'),
      renderRecordingBanner: document.getElementById('render-recording-banner'),
      labelBannerTimer: document.getElementById('label-banner-timer'),
      recordingStatus: document.getElementById('render-recording-status'),
      recordingPreviewPanel: document.getElementById('recording-preview-panel'),
      recordingVideoPreview: document.getElementById('recording-video-preview'),
      btnDismissVideoPreview: document.getElementById('btn-dismiss-video-preview'),
      recordingHeading: document.getElementById('render-recording-heading'),

      // Toast & Modallar
      toast: document.getElementById('toast'),
      toastMessage: document.getElementById('toast-message'),
      toastProgress: document.getElementById('toast-progress'),
      toastAction: document.getElementById('toast-action'),
      modalHelp: document.getElementById('modal-help'),
      btnOpenHelp: document.getElementById('btn-open-help'),
      btnCloseHelp: document.getElementById('btn-close-help'),
      dragOverlay: document.getElementById('drag-overlay'),
    };
  }

  _bindEvents() {
    const d = this.dom;

    if (d.btnHomeScreen) {
      d.btnHomeScreen.addEventListener('click', async () => {
        d.btnHomeScreen.disabled = true;
        this.timeline.stop();
        try {
          await this.autosave.ready;
          await this.autosave.flush();
          await this.onReturnHome();
        } catch (error) {
          d.btnHomeScreen.disabled = false;
          this.showToast(`Ana ekrana geçilemedi: ${error.message || 'proje kaydedilemedi'}`);
        }
      });
    }

    // --- SEKME GEÇİŞLERİ ---
    d.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-tab');
        this.switchTab(targetId);
      });
    });

    // --- PANEL KATLAMA / GİZLEME ---
    if (d.btnCollapseHeader) {
      d.btnCollapseHeader.addEventListener('click', () => {
        this.toggleCollapse();
      });
    }

    if (d.btnToggleVisibility) {
      d.btnToggleVisibility.addEventListener('click', () => {
        this.togglePanelVisibility();
      });
    }

    if (d.btnRestorePanel) {
      d.btnRestorePanel.addEventListener('click', () => this.togglePanelVisibility());
    }

    if (d.btnCinematic) {
      d.btnCinematic.addEventListener('click', () => {
        this.togglePanelVisibility();
      });
    }

    // --- SEKME 1: REJİ / TIMELINE ---
    if (d.btnTimelinePlay) {
      d.btnTimelinePlay.addEventListener('click', () => {
        this.timeline.play();
        this.showToast('Reji Zaman Çizelgesi Oynatılıyor ▶');
      });
    }

    if (d.btnQuickPlay) {
      d.btnQuickPlay.addEventListener('click', () => {
        if (this.timeline.isPlaying) {
          this.timeline.pause();
          this.showToast('Reji Duraklatıldı ⏸');
        } else {
          this.timeline.play();
          this.showToast('Reji Oynatılıyor ▶');
        }
      });
    }

    if (d.btnTimelinePause) {
      d.btnTimelinePause.addEventListener('click', () => {
        this.timeline.pause();
        this.showToast('Reji Duraklatıldı ⏸');
      });
    }

    if (d.btnTimelineStop) {
      d.btnTimelineStop.addEventListener('click', () => {
        this.timeline.stop();
        this.showToast('Oynatma durduruldu; sahne mevcut konumunda bırakıldı.');
      });
    }

    if (d.btnToggleRecord) {
      d.btnToggleRecord.addEventListener('click', () => {
        const isRec = this.timeline.toggleRecordMode();
        this.updateRecordModeButton(isRec);
        this.showToast(
          isRec
            ? 'Adım Kaydetme Modu AÇIK: Zemine veya kapıya dokunduğunuzda adıma eklenir'
            : 'Adım Kaydetme Modu KAPALI'
        );
      });
    }

    // Hızlı Adım Ekleme Butonları
    if (d.btnAddWaitStep) {
      d.btnAddWaitStep.addEventListener('click', () => {
        this.timeline.addStep('WAIT', { duration: 2 }, '2 Saniye Durakla', this.getTimelineActionOptions());
        this.showToast('Kuyruğa 2s Bekleme Adımı Eklendi');
      });
    }

    if (d.btnAddDoorStep) {
      d.btnAddDoorStep.addEventListener('click', () => {
        this.timeline.addStep('TRIGGER_DOOR', { action: 'toggle' }, 'Kapıyı Tetikle (Aç/Kapat)', this.getTimelineActionOptions());
        this.showToast('Kuyruğa Kapı Adımı Eklendi');
      });
    }

    if (d.btnAddCamStep) {
      d.btnAddCamStep.addEventListener('click', () => {
        const curStation = this.cameraManager.stations[0];
        const stationId = this.cameraManager.activeStationId || (curStation ? curStation.id : 'station-ext');
        const st = this.cameraManager.stations.find((s) => s.id === stationId);
        this.timeline.addStep(
          'SWITCH_CAMERA',
          { stationId },
          `Kameraya Geç: ${st ? st.name : 'Kamera 1'}`,
          this.getTimelineActionOptions()
        );
        this.showToast('Kuyruğa Kamera Değişimi Eklendi');
      });
    }

    if (d.btnAddEmoteStep) {
      d.btnAddEmoteStep.addEventListener('click', () => {
        this.timeline.addStep('PLAY_EMOTE', { emote: 'jump' }, 'Karakter Zıplasın (Emote)', this.getTimelineActionOptions());
        this.showToast('Kuyruğa Emote Adımı Eklendi');
      });
    }

    d.timelinePlayMode?.addEventListener('change', () => {
      this.timeline.setPlayMode(d.timelinePlayMode.value);
      this.showToast(d.timelinePlayMode.value === 'scheduled' ? 'Zamanlı oynatma: başlangıç ve süre alanları kullanılacak' : 'Sıralı oynatma etkin');
    });
    d.btnAddFollowStep?.addEventListener('click', () => {
      const targetCharacterId = d.timelineFollowTarget?.value;
      if (!targetCharacterId || targetCharacterId === this.characters.selectedId) {
        this.showToast('Takip için farklı bir hedef karakter seçin.');
        return;
      }
      this.timeline.addStep('FOLLOW', { targetCharacterId, offset: { x: 0, y: 0, z: 1.2 } }, 'Karakteri Takip Et', this.getTimelineActionOptions());
      this.showToast('Takip aksiyonu zaman çizelgesine eklendi');
    });
    d.btnAddHideStep?.addEventListener('click', () => {
      this.timeline.addStep('SET_VISIBILITY', { visible: false }, 'Karakteri Gizle', this.getTimelineActionOptions());
      this.showToast('Gizleme aksiyonu zaman çizelgesine eklendi');
    });

    // JSON İçe / Dışa Aktarma
    if (d.btnExportJSON) {
      d.btnExportJSON.addEventListener('click', async () => {
        d.btnExportJSON.disabled = true;
        this.showToast('Proje JSON’u hazırlanıyor…', { duration: 0 });
        try {
          const sprites = await this.sprites.exportAssets();
          this.sprites.constructor.validateProjectAssets(sprites);
          const timeline = JSON.parse(this.timeline.exportSequence());
          const mapAsset = this.mapLoader?.exportStateForStorage?.() || null;
          const worldState = await this.worldSprites?.exportProjectStateForStorage?.() || { templates: [], actors: [] };
          const totalBytes = calculateProjectBytes(timeline, sprites, mapAsset, worldState.templates);
          const exportLimit = getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes;
          if (totalBytes > exportLimit) throw new Error(`Bu cihazda proje JSON görsel varlık sınırı ${Math.floor(exportLimit / (1024 * 1024))} MiB.`);
          let portableMap = null;
          if (mapAsset) portableMap = { ...mapAsset, blob: undefined, data: await blobToBase64(mapAsset.blob) };
          const portableTemplates = [];
          for (const template of worldState.templates) {
            const { blob, ...metadata } = template;
            portableTemplates.push({ ...metadata, data: await blobToBase64(blob) });
          }
          const payload = {
            ...timeline,
            format: 'animationer-project', schemaVersion: PROJECT_SCHEMA_VERSION, projectVersion: PROJECT_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            scope: { timeline: true, sprites2d: true, characterTransforms: false, mapAssets: Boolean(mapAsset), worldCharacters: true, cameraPreferences: false },
            sprites,
            mapAsset: portableMap,
            worldCharacterTemplates: portableTemplates,
            worldCharacters: worldState.actors,
          };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const result = await saveGeneratedFile(blob, 'animationer-project.json', {
            onProgress: (progress) => this._reportFileProgress('Proje JSON’u', progress),
          });
          this._showSavedFileToast('Reji + 2D proje JSON’u', result, blob);
        } catch (error) {
          this.showToast(`Proje kaydedilemedi: ${error.message}`);
        } finally {
          d.btnExportJSON.disabled = false;
        }
      });
    }

    if (d.btnImportJSON && d.fileInputJSON) {
      d.btnImportJSON.addEventListener('click', () => d.fileInputJSON.click());
      d.fileInputJSON.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          if (file.size > 140 * 1024 * 1024) {
            this.showToast('Proje JSON’u 140 MB dosya sınırını aşıyor; mevcut proje korunuyor.');
            d.fileInputJSON.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = async (evt) => {
            try {
              const payload = JSON.parse(evt.target.result);
              if (payload?.format === 'animationer-project') {
                if (![1, 2, 3].includes(payload.schemaVersion || payload.projectVersion || 1)) throw new Error('Bu proje sürümü desteklenmiyor.');
                const migrated = migrateProjectRecord(payload);
                const importBytes = calculateProjectBytes(migrated.timeline, migrated.sprites, migrated.mapAsset, migrated.worldCharacterTemplates);
                const importLimit = getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes;
                if (importBytes > importLimit) throw new Error(`Bu proje cihazın ${Math.floor(importLimit / (1024 * 1024))} MiB görsel bellek sınırını aşıyor; daha küçük dosyalarla yeniden dışa aktarın.`);
                const assets = [];
                for (const asset of migrated.sprites) assets.push(asset.data
                  ? { ...asset, blob: base64ToBlob(asset.data, asset.mimeType), data: undefined }
                  : asset);
                const worldCharacterTemplates = [];
                for (const template of migrated.worldCharacterTemplates) worldCharacterTemplates.push(template.data
                  ? { ...template, blob: base64ToBlob(template.data, template.mimeType), data: undefined }
                  : template);
                const mapAsset = migrated.mapAsset?.data
                  ? { ...migrated.mapAsset, blob: base64ToBlob(migrated.mapAsset.data, migrated.mapAsset.mimeType), data: undefined }
                  : migrated.mapAsset;
                const normalized = migrateProjectRecord({ ...migrated, sprites: assets, worldCharacterTemplates, mapAsset });
                const assetIds = this.sprites.constructor.validateProjectAssets(assets);
                const candidateTimeline = new this.timeline.constructor({});
                candidateTimeline.importSequence(normalized.timeline);
                const missing = candidateTimeline.steps.find((step) => step.type === 'PLAY_SPRITE_ANIMATION' && !assetIds.has(step.actorId));
                if (missing) throw new Error(`'${missing.actorId}' sprite dosyası projede yok; mevcut sahne korundu.`);

                // Each resource manager stages/decode-validates its input before replacing that resource.
                await this.worldSprites?.importProjectState?.({ templates: normalized.worldCharacterTemplates, actors: normalized.worldCharacters }, { replaceTemplates: true });
                await this.sprites.importAssets(assets);
                await this.mapLoader?.restoreProjectState?.(mapAsset);
                this.timeline.stop();
                this.timeline.steps = candidateTimeline.steps;
                this.timeline.playMode = candidateTimeline.playMode;
                this.timeline._notify();
                this.autosave?.schedule();
                this.showToast('Proje; 2D ortam, zaman çizelgesi ve karakterlerle yüklendi');
              } else { this.timeline.importSequence(payload); this.showToast('Eski biçim zaman çizelgesi yüklendi (görseller bu dosyada bulunmuyor)'); }
            } catch (err) {
              this.showToast(`Proje yüklenemedi; mevcut sahne korundu: ${err.message || 'geçersiz dosya'}`);
            }
          };
          reader.readAsText(file);
          d.fileInputJSON.value = '';
        }
      });
    }

    if (d.btnClearTimeline) {
      d.btnClearTimeline.addEventListener('click', () => {
        this.timeline.clear();
        this.showToast('Yeni boş akış hazır.');
      });
    }

    d.characterSelect?.addEventListener('change', () => {
      this.characters.select(d.characterSelect.value);
      const actor = this.characters.selectedCharacter;
      if (actor && d.sliderSpeed) d.sliderSpeed.value = actor.walkSpeed;
      if (actor && d.sliderWobble) d.sliderWobble.value = actor.wobbleIntensity;
      if (d.labelSpeedVal && actor) d.labelSpeedVal.textContent = `${actor.walkSpeed.toFixed(1)} m/s`;
      if (d.labelWobbleVal && actor) d.labelWobbleVal.textContent = `${actor.wobbleIntensity.toFixed(1)}x`;
    });
    d.btnAddCharacter?.addEventListener('click', () => {
      try {
        const actor = this.characters.addCharacter();
        this.characters.select(actor.id);
        this.showToast(`${actor.name} eklendi ve seçildi`);
      } catch (error) {
        this.showToast(error.message);
      }
    });
    d.btnRemoveCharacter?.addEventListener('click', () => {
      const actor = this.characters.getActor();
      if (!this.characters.removeCharacter()) this.showToast('Sahnede en az bir karakter kalmalı.');
      else this.showToast(`${actor?.name || 'Karakter'} silindi`);
    });
    d.btnLoadCharacter?.addEventListener('click', () => d.characterFilePicker?.click());
    d.characterFilePicker?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      this.showToast('GLB karakter yükleniyor…');
      try {
        const actor = await this.characters.loadCharacterFile(file);
        this.showToast(`${actor.name} yüklendi ve seçildi`);
      } catch (error) {
        this.showToast(error.message || 'GLB karakter yüklenemedi.');
      } finally {
        d.characterFilePicker.value = '';
      }
    });
    d.btnLoadSpriteSheet?.addEventListener('click', () => d.spriteFilePicker?.click());
    d.spriteFilePicker?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      this.showToast('2D spritesheet yükleniyor…');
      try {
        const actor = await this.sprites.addSpriteSheet(file, {
          columns: Number(d.spriteColumns?.value),
          rows: Number(d.spriteRows?.value),
          fps: Number(d.spriteFps?.value),
        });
        this.showToast(`${actor.name} 2D sahneye eklendi`);
      } catch (error) {
        this.showToast(error.message || 'Spritesheet yüklenemedi.');
      } finally {
        d.spriteFilePicker.value = '';
      }
    });
    d.spriteActorSelect?.addEventListener('change', () => {
      this.sprites?.select(d.spriteActorSelect.value);
      this.updateSpriteList();
    });
    d.btnApplySpriteTransform?.addEventListener('click', () => {
      const actor = this.sprites?.getActor();
      if (!actor) return this.showToast('Önce bir 2D spritesheet yükleyin.');
      this.sprites.setTransform(actor.id, {
        x: Number(d.spritePositionX?.value),
        y: Number(d.spritePositionY?.value),
        height: Number(d.spriteDisplayHeight?.value),
      });
      this.showToast('2D karakter konumu ve boyutu güncellendi');
    });
    d.btnPreviewSprite?.addEventListener('click', () => {
      const actor = this.sprites?.getActor();
      if (!actor) return this.showToast('Önizleme için spritesheet yükleyin.');
      if (actor.isPlaying) this.sprites.stopAnimation(actor.id);
      else this.sprites.playAnimation(actor.id, { duration: null, fps: Number(d.spriteFps?.value), loop: true });
    });
    d.btnAddSpriteTimelineStep?.addEventListener('click', () => {
      const actor = this.sprites?.getActor();
      if (!actor) return this.showToast('Zaman çizelgesine eklemek için spritesheet yükleyin.');
      const options = this.getTimelineActionOptions(actor.id);
      if (!options.duration) options.duration = 2;
      this.timeline.addStep('PLAY_SPRITE_ANIMATION', {
        fps: Number(d.spriteFps?.value) || actor.fps,
        loop: true,
      }, `2D Animasyon: ${actor.name}`, options);
      this.showToast('2D animasyon adımı zaman çizelgesine eklendi');
    });
    d.btnRemoveSprite?.addEventListener('click', () => {
      const actor = this.sprites?.getActor();
      if (!actor) return this.showToast('Silinecek 2D karakter yok.');
      this.sprites.remove(actor.id);
      this.showToast(`${actor.name} 2D sahneden silindi`);
    });
    d.btnSaveWorldSpriteTemplate?.addEventListener('click', () => d.worldSpriteFilePicker?.click());
    d.worldSpriteFilePicker?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      this.showToast('2D karakter kitaplığa kaydediliyor…');
      try {
        const template = await this.worldSprites.addTemplate(file, {
          name: d.worldSpriteName?.value,
          columns: Number(d.worldSpriteColumns?.value),
          rows: Number(d.worldSpriteRows?.value),
          fps: Number(d.worldSpriteFps?.value),
        });
        if (d.worldSpriteName) d.worldSpriteName.value = template.name;
        this.showToast(`“${template.name}” karakteri kaydedildi; şimdi dünyaya ekleyebilirsiniz.`);
      } catch (error) {
        this.showToast(error.message || '2D karakter kitaplığa kaydedilemedi.');
      } finally {
        d.worldSpriteFilePicker.value = '';
      }
    });
    d.worldSpriteTemplateSelect?.addEventListener('change', () => {
      this.worldSprites?.selectTemplate(d.worldSpriteTemplateSelect.value);
      this.updateWorldSpriteUI();
    });
    d.btnSpawnWorldSprite?.addEventListener('click', async () => {
      try {
        const template = this.worldSprites?.templates.get(d.worldSpriteTemplateSelect?.value);
        const actor = await this.worldSprites?.spawn(d.worldSpriteTemplateSelect?.value);
        this.showToast(`“${template?.name || actor?.name}” 3D dünyaya eklendi.`);
      } catch (error) {
        this.showToast(error.message || '2D karakter dünyaya eklenemedi.');
      }
    });
    d.btnDeleteWorldSpriteTemplate?.addEventListener('click', async () => {
      const template = this.worldSprites?.templates.get(d.worldSpriteTemplateSelect?.value);
      if (!template || !window.confirm(`“${template.name}” karakterini kalıcı kitaplıktan silmek istiyor musunuz? Bu kaynağı kullanan sahne karakterleri varsa önce onları kaldırmanız gerekir.`)) return;
      try {
        await this.worldSprites.deleteTemplate(template.id);
        this.showToast(`“${template.name}” kitaplıktan silindi.`);
      } catch (error) {
        this.showToast(error.message || 'Karakter kitaplıktan silinemedi.');
      }
    });
    d.worldSpriteActorSelect?.addEventListener('change', () => {
      this.worldSprites?.select(d.worldSpriteActorSelect.value);
      this.updateWorldSpriteUI();
    });
    d.btnWorldSpriteControl?.addEventListener('click', () => {
      const activating = !this.worldSprites?.activeControl;
      if (activating) this.characters?.selectedCharacter?.stopMotion?.();
      this.worldSprites?.setControlMode(activating);
      this.updateWorldSpriteUI();
      this.showToast(this.worldSprites?.activeControl ? '2D karakter hareket modu açık: zemine dokunarak yürütün.' : '2D karakter hareket modu kapalı.');
    });
    d.btnRemoveWorldSprite?.addEventListener('click', () => {
      const actor = this.worldSprites?.getActor(d.worldSpriteActorSelect?.value);
      if (!actor) return this.showToast('Sahnede seçili bir 2D dünya karakteri yok.');
      this.worldSprites.remove(actor.id);
      this.showToast(`“${actor.name}” sahneden kaldırıldı; kitaplıktaki kayıt korundu.`);
    });
    d.controlModeSelect?.addEventListener('change', () => {
      this.onControlModeChange(d.controlModeSelect.value);
      this.showToast(`Kontrol yöntemi: ${d.controlModeSelect.selectedOptions[0]?.textContent || d.controlModeSelect.value}`);
    });
    d.btnShowCharacter?.addEventListener('click', () => {
      this.characters.setVisible(this.characters.selectedId, true);
      this.showToast('Seçili karakter yeniden görünür.');
    });

    // --- SEKME 2: SAHNE / HARİTA ---
    if (d.btnTriggerFile && d.filePicker) {
      d.btnTriggerFile.addEventListener('click', () => d.filePicker.click());
      d.filePicker.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          try { await this.mapLoader.loadFile(file); }
          catch (error) { this.showToast(error.message || 'Harita yüklenemedi; önceki ortam korundu.'); }
          d.filePicker.value = '';
        }
      });
    }

    if (d.dropZone && d.filePicker) {
      d.dropZone.addEventListener('click', () => d.filePicker.click());
    }

    // 2D Yönelim Değiştirme
    if (d.btnOrientHorizontal) {
      d.btnOrientHorizontal.addEventListener('click', () => {
        this.mapLoader.setImageOrientation('horizontal');
        d.btnOrientHorizontal.classList.add('active');
        d.btnOrientVertical.classList.remove('active');
        this.showToast('Görsel Yatay (Zemin) moduna alındı');
      });
    }

    if (d.btnOrientVertical) {
      d.btnOrientVertical.addEventListener('click', () => {
        this.mapLoader.setImageOrientation('vertical');
        d.btnOrientVertical.classList.add('active');
        d.btnOrientHorizontal.classList.remove('active');
        this.showToast('Görsel Dikey (Duvar) moduna alındı');
      });
    }

    if (d.sliderImageSize) {
      d.sliderImageSize.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.mapLoader.setImageSize(val);
        if (d.labelImageSize) d.labelImageSize.textContent = `${val}m`;
      });
    }

    if (d.sliderImageAlpha) {
      d.sliderImageAlpha.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.mapLoader.setImageOpacity(val);
        if (d.labelImageAlpha) d.labelImageAlpha.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // Izgara & Işık Toggle
    if (d.btnToggleGrid) {
      d.btnToggleGrid.addEventListener('click', () => {
        if (this.sceneHelpers.gridHelper) {
          const v = !this.sceneHelpers.gridHelper.visible;
          this.sceneHelpers.gridHelper.visible = v;
          d.btnToggleGrid.classList.toggle('active', v);
          this.showToast(`Zemin Izgarası: ${v ? 'Açık' : 'Kapalı'}`);
        }
      });
    }

    if (d.btnToggleLights) {
      d.btnToggleLights.addEventListener('click', () => {
        if (this.sceneHelpers.dirLight) {
          const v = !this.sceneHelpers.dirLight.visible;
          this.sceneHelpers.dirLight.visible = v;
          if (this.sceneHelpers.hemiLight) this.sceneHelpers.hemiLight.visible = v;
          d.btnToggleLights.classList.toggle('active', v);
          this.showToast(`Işıklar: ${v ? 'Açık' : 'Kapalı'}`);
        }
      });
    }

    if (d.btnDemoFloorplan) {
      d.btnDemoFloorplan.addEventListener('click', () => {
        this.mapLoader.loadProceduralFloorPlan();
        if (d.panelImageControls) d.panelImageControls.style.display = 'block';
        this.showToast('2D Kat Planı Zemini Yüklendi');
      });
    }

    if (d.btnDemoGallery) {
      d.btnDemoGallery.addEventListener('click', () => {
        this.mapLoader.loadProceduralGallery();
        this.showToast('3D Monokrom Galeri Yüklendi');
      });
    }

    if (d.btnFocusMap) {
      d.btnFocusMap.addEventListener('click', () => {
        const target = this.mapLoader.focusCameraOnMap(this.cameraManager.camera);
        if (target) {
          this.cameraManager.controls.target.copy(target);
          this.cameraManager.setFreeMode();
          this.showToast('Kamera Haritaya Odaklandı');
        }
      });
    }

    if (d.btnClearMap) {
      d.btnClearMap.addEventListener('click', () => {
        this.mapLoader.clear();
        if (d.panelImageControls) d.panelImageControls.style.display = 'none';
        this.showToast('Harita Temizlendi');
      });
    }

    if (d.btnAddWallBox) {
      d.btnAddWallBox.addEventListener('click', () => {
        const charPos = this.character.getPosition();
        const box = this.mapLoader.addWallBox(charPos.x + 1.8, charPos.z, 2.0, 1.8, 0.4);
        this.updateWallBoxList();
        this.showToast(`Engel Kutusu Eklendi (#${box.id})`);
      });
    }

    if (d.btnClearWallBoxes) {
      d.btnClearWallBoxes.addEventListener('click', () => {
        this.mapLoader.clearWallBoxes();
        this.updateWallBoxList();
        this.showToast('Tüm Engel Kutuları Silindi');
      });
    }

    this.updateWallBoxList();

    // --- SEKME 3: KAMERALAR ---
    if (d.btnFreeOrbit) {
      d.btnFreeOrbit.addEventListener('click', () => {
        this.cameraManager.setFreeMode();
        this.showToast('Serbest Orbit Kamerasına Geçildi');
      });
    }

    if (d.btnAddCamera) {
      d.btnAddCamera.addEventListener('click', () => {
        const st = this.cameraManager.addCurrentAsStation();
        this.showToast(`Yeni İstasyon Kaydedildi: ${st.name}`);
      });
    }

    d.cameraPresetButtons?.forEach((button) => {
      button.addEventListener('click', () => {
        const target = this.characters.getPosition().clone();
        target.y += 0.8;
        if (this.cameraManager.transitionToPreset(button.dataset.cameraPreset, target)) {
          this.showToast(`${button.textContent.trim()} kamera kadrajına geçildi`);
        }
      });
    });

    d.btnToggleCctvPreview?.addEventListener('click', () => {
      const show = Boolean(d.cctvPreview?.hidden);
      if (d.cctvPreview) d.cctvPreview.hidden = !show;
      d.btnToggleCctvPreview.setAttribute('aria-pressed', String(show));
      d.btnToggleCctvPreview.textContent = `CCTV Mini Görünümü: ${show ? 'Açık' : 'Kapalı'}`;
      this.showToast(`Bağımsız CCTV mini görünümü ${show ? 'açıldı' : 'kapatıldı'}`);
    });

    if (d.btnToggleFollow) {
      d.btnToggleFollow.addEventListener('click', () => {
        const f = !this.cameraManager.followCharacter;
        this.cameraManager.setFollow(f);
        d.btnToggleFollow.classList.toggle('primary', f);
        d.btnToggleFollow.textContent = `◉ Karakteri Takip Et: [${f ? 'AÇIK' : 'KAPALI'}]`;
        this.showToast(`Karakter Takibi: ${f ? 'Açık' : 'Kapalı'}`);
      });
    }

    if (d.btnToggleTour) {
      d.btnToggleTour.addEventListener('click', () => {
        if (this.cameraManager.isTourActive) {
          this.cameraManager.stopTour();
          if (d.labelTourBtn) d.labelTourBtn.textContent = 'Kamera Turunu Başlat';
          this.showToast('Kamera Turu Durduruldu');
        } else {
          this.cameraManager.startTour();
          if (d.labelTourBtn) d.labelTourBtn.textContent = 'Kamera Turunu Durdur';
          this.showToast('Kamera Turu Başlatıldı');
        }
      });
    }

    // --- SEKME 4: KARAKTER & MERDİVEN ---
    if (d.sliderSpeed) {
      d.sliderSpeed.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.character.setSpeed(val);
        if (d.labelSpeedVal) d.labelSpeedVal.textContent = `${val.toFixed(1)} m/s`;
      });
    }

    if (d.sliderWobble) {
      d.sliderWobble.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.character.setWobbleIntensity(val);
        if (d.labelWobbleVal) d.labelWobbleVal.textContent = `${val.toFixed(1)}x`;
      });
    }

    if (d.btnResetSpawn) {
      d.btnResetSpawn.addEventListener('click', () => {
        this.character.teleportTo(0, 0, 0);
        this.showToast('Karakter Başlangıç Noktasına (0,0,0) Işınlandı');
      });
    }

    if (d.btnEmoteJump) {
      d.btnEmoteJump.addEventListener('click', () => {
        this.character.playEmotePromise('jump');
        this.showToast('Emote: Zıplama!');
      });
    }

    if (d.btnEmoteWave) {
      d.btnEmoteWave.addEventListener('click', () => {
        this.character.playEmotePromise('wave');
        this.showToast('Emote: Selam Ver!');
      });
    }

    if (d.btnEmoteSpin) {
      d.btnEmoteSpin.addEventListener('click', () => {
        this.character.playEmotePromise('spin');
        this.showToast('Emote: 360° Dönüş!');
      });
    }

    // --- SEKME 5: DIŞA AKTAR / RENDER ---
    if (d.btnTakeScreenshot) {
      d.btnTakeScreenshot.addEventListener('click', async () => {
        if (!this.recorder || d.btnTakeScreenshot.disabled) return;
        d.btnTakeScreenshot.disabled = true;
        this.showToast('PNG görüntüsü hazırlanıyor…', { duration: 0 });
        try {
          const result = await this.recorder.takeScreenshot(undefined, (progress) => this._reportFileProgress('PNG görüntüsü', progress));
          this._showSavedFileToast('PNG ekran görüntüsü', result, result.blob);
        } catch (error) {
          this.showToast(`PNG kaydedilemedi: ${error.message}`);
        } finally {
          d.btnTakeScreenshot.disabled = false;
        }
      });
    }

    if (d.btnQuality720p && d.btnQuality1080p) {
      d.btnQuality720p.addEventListener('click', () => {
        if (this.recorder) this.recorder.setQuality('standard');
        d.btnQuality720p.classList.add('active');
        d.btnQuality1080p.classList.remove('active');
        if (d.labelRenderRes) d.labelRenderRes.textContent = 'Standart (4 Mbps)';
        this.showToast('Bitrate profili: Standart (4 Mbps)');
      });

      d.btnQuality1080p.addEventListener('click', () => {
        if (this.recorder) this.recorder.setQuality('high');
        d.btnQuality1080p.classList.add('active');
        d.btnQuality720p.classList.remove('active');
        if (d.labelRenderRes) d.labelRenderRes.textContent = 'Yüksek (8.5 Mbps)';
        this.showToast('Bitrate profili: Yüksek (8.5 Mbps)');
      });
    }

    d.btnFrameRate30?.addEventListener('click', () => this._setRecorderFrameRate(30));
    d.btnFrameRate60?.addEventListener('click', () => this._setRecorderFrameRate(60));

    if (d.btnToggleVideoRecord) {
      d.btnToggleVideoRecord.addEventListener('click', async () => {
        if (!this.recorder) return;
        if (this.recorder.isFinalizing) return;
        if (this.recorder.isRecording) {
          this.showToast('Kayıt durduruldu; video hazırlanıyor ve kaydediliyor…');
          await this.recorder.stopRecording();
        } else {
          this._dismissRecordingPreview();
          const ok = this.recorder.startRecording();
          if (ok) {
            this.showToast(`Video kaydı başladı (${this.recorder.frameRate} FPS). Süre üst göstergede; bitirmek için Kaydı Durdur’a dokunun.`);
          } else {
            this.showToast('HATA: Video kaydı başlatılamadı!');
          }
        }
      });
    }

    if (d.btnRecordSequence) {
      d.btnRecordSequence.addEventListener('click', () => {
        if (!this.recorder || this.recorder.isRecording || this.recorder.isFinalizing) return;

        this.showToast('🎬 Reji Kaydı Başlatılıyor (Sinematik Tam Ekran)...');

        this.recorder.recordTimelineSequence(this.timeline, {
          onBeforeStart: () => {
            this._dismissRecordingPreview();
            // Kayıt esnasında arayüz görünmesin (Sinematik mod)
            if (!this.isPanelHidden) {
              this.togglePanelVisibility();
            }
          },
          onAfterFinish: ({ success, error } = {}) => {
            // Kayıt bitince paneli geri getir
            if (this.isPanelHidden) {
              this.togglePanelVisibility();
            }
            if (success) this.dom.recordingPreviewPanel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            else this.showToast(`Reji videosu kaydedilemedi: ${error || 'Bilinmeyen hata'}`);
          },
        });
      });
    }

    if (d.btnDismissVideoPreview) {
      d.btnDismissVideoPreview.addEventListener('click', () => this._dismissRecordingPreview());
    }
    if (d.recordingVideoPreview) {
      d.recordingVideoPreview.addEventListener('error', () => {
        if (d.recordingStatus) {
          d.recordingStatus.textContent = this.recorder?.lastDownloadResult?.saved
            ? 'Video dosyası kaydedildi; bu ortam önizlemeyi oynatamadı. Dosyayı başka bir oynatıcıda açabilirsiniz.'
            : 'Video önizlemesi bu ortamda oynatılamadı.';
        }
      });
    }

    // Kapı Hızlı Aç/Kapat Butonu
    if (d.btnQuickDoor) {
      d.btnQuickDoor.addEventListener('click', () => {
        this.door.toggle();
        this.showToast(`Kapı ${this.door.isOpen ? 'Açıldı' : 'Kapatıldı'}`);
      });
    }

    // Yardım Modalı
    if (d.btnOpenHelp && d.modalHelp) {
      d.btnOpenHelp.addEventListener('click', () => {
        d.modalHelp.classList.add('active');
      });
    }
    if (d.btnCloseHelp && d.modalHelp) {
      d.btnCloseHelp.addEventListener('click', () => {
        d.modalHelp.classList.remove('active');
      });
    }
  }

  /**
   * RecorderManager durum değişikliklerini arayüze yansıtır
   */
  _setRecorderFrameRate(frameRate) {
    if (!this.recorder || this.recorder.isRecording || this.recorder.isFinalizing) return;
    const selected = this.recorder.setFrameRate(frameRate);
    const d = this.dom;
    d.btnFrameRate30?.classList.toggle('active', selected === 30);
    d.btnFrameRate30?.setAttribute('aria-pressed', String(selected === 30));
    d.btnFrameRate60?.classList.toggle('active', selected === 60);
    d.btnFrameRate60?.setAttribute('aria-pressed', String(selected === 60));
    if (d.labelRenderFps) d.labelRenderFps.textContent = selected === 30 ? '30 FPS · Daha verimli' : '60 FPS · Daha akıcı';
    this.showToast(`Video kare hızı: ${selected} FPS`);
  }

  updateRecorderUI({
    isRecording = false,
    isFinalizing = false,
    duration,
    formattedDuration,
    filename,
    error,
    canceled,
    downloadResult,
    blob,
    sizeBytes = 0,
    maxRecordingBytes = 128 * 1024 * 1024,
    maxDurationSeconds = 180,
    frameRate = this.recorder?.frameRate || 30,
    maxFrameRate = this.recorder?.maxFrameRate || 60,
    width = this.recorder?.canvas?.width,
    height = this.recorder?.canvas?.height,
    progress,
    stopReason,
  }) {
    const d = this.dom;
    const isBusy = isRecording || isFinalizing;

    // Üst rozet
    if (d.badgeRecorderMode) {
      d.badgeRecorderMode.style.display = isBusy ? 'inline-flex' : 'none';
      if (d.labelRecorderMode) {
        d.labelRecorderMode.textContent = isFinalizing
          ? `● KAYDEDİLİYOR ${formattedDuration || '00:00'}`
          : `● REC ${formattedDuration || '00:00'}`;
      }
    }

    // Tab 5 buton ve banner
    if (d.btnToggleVideoRecord) {
      d.btnToggleVideoRecord.disabled = isFinalizing;
      if (isRecording) {
        d.btnToggleVideoRecord.classList.add('recording-active');
        d.btnToggleVideoRecord.textContent = `⏹ Kaydı Durdur (${formattedDuration || '00:00'})`;
      } else if (isFinalizing) {
        d.btnToggleVideoRecord.classList.remove('recording-active');
        d.btnToggleVideoRecord.textContent = '⌛ Video kaydediliyor…';
      } else {
        d.btnToggleVideoRecord.classList.remove('recording-active');
        d.btnToggleVideoRecord.textContent = '● Manuel Video Kaydı Başlat';
      }
    }
    if (d.btnRecordSequence) d.btnRecordSequence.disabled = isBusy;
    if (d.btnQuality720p) d.btnQuality720p.disabled = isBusy;
    if (d.btnQuality1080p) d.btnQuality1080p.disabled = isBusy;
    if (d.btnFrameRate30) d.btnFrameRate30.disabled = isBusy;
    if (d.btnFrameRate60) {
      d.btnFrameRate60.disabled = isBusy || maxFrameRate < 60;
      d.btnFrameRate60.title = maxFrameRate < 60
        ? 'Bu cihazın düşük bellek profili nedeniyle 60 FPS devre dışı; 30 FPS kullanılıyor.'
        : 'Daha akıcı hareket; daha fazla işlemci ve pil kullanımı';
    }

    if (d.renderRecordingBanner) {
      d.renderRecordingBanner.style.display = isBusy ? 'flex' : 'none';
      if (d.labelBannerTimer) {
        d.labelBannerTimer.textContent = isFinalizing
          ? 'VİDEO HAZIRLANIYOR VE KAYDEDİLİYOR…'
          : `CANVAS KAYDEDİLİYOR: ${formattedDuration || '00:00'}`;
      }
    }

    if (d.recordingStatus) {
      const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
      const maxSizeMb = (maxRecordingBytes / (1024 * 1024)).toFixed(0);
      if (d.recordingHeading) d.recordingHeading.textContent = `VİDEO KAYDI (AZAMİ ${Math.ceil(maxDurationSeconds / 60)} DAKİKA / ${maxSizeMb} MiB; CİHAZ PROFİLİNE GÖRE)`;
      const outputSize = Number.isFinite(width) && Number.isFinite(height) ? ` · ${width}×${height}px` : '';
      const fpsLimitNote = maxFrameRate < 60 ? ' · düşük bellek profili' : '';
      if (isRecording) d.recordingStatus.textContent = `Video kaydı sürüyor · ${formattedDuration || '00:00'} · ${frameRate} FPS${outputSize}${fpsLimitNote} · ${sizeMb}/${maxSizeMb} MiB. En çok ${Math.ceil(maxDurationSeconds / 60)} dakika; sınırda otomatik durur.`;
      else if (isFinalizing && progress?.stage === 'waiting-for-destination') d.recordingStatus.textContent = 'Dosya kaydetme penceresinde konum seçin; kayıt bellekte tutuluyor.';
      else if (isFinalizing && progress) d.recordingStatus.textContent = `Video hazırlanıyor ve kaydediliyor · ${progress.percent}% (${(progress.bytesWritten / (1024 * 1024)).toFixed(1)}/${(progress.totalBytes / (1024 * 1024)).toFixed(1)} MiB).`;
      else if (isFinalizing) d.recordingStatus.textContent = 'Kayıt durduruldu. Video hazırlanıyor ve dosyaya yazılıyor; lütfen bekleyin.';
      else if (error) d.recordingStatus.textContent = `Kayıt başarısız: ${error}`;
      else if (canceled) d.recordingStatus.textContent = 'Dosyayı kaydetme iptal edildi; oluşturulan video önizleme alanında kullanılabilir.';
      else if (filename) {
        const savedMessage = saveResultMessage('Video', downloadResult || { saved: true, filename });
        d.recordingStatus.textContent = stopReason === 'duration-limit' || stopReason === 'size-limit'
          ? `${savedMessage} Kayıt güvenlik sınırına ulaştığı için otomatik durduruldu.`
          : savedMessage;
      } else d.recordingStatus.textContent = 'Kayıt hazır. Kaydettiğiniz video tamamlanınca burada önizleyebilirsiniz.';
    }
    if (blob instanceof Blob && blob.size > 0) {
      const previewLimit = Math.min(MAX_INLINE_PREVIEW_BYTES, maxRecordingBytes / 2);
      if (blob.size <= previewLimit) this._showRecordingPreview(blob);
      else {
        this._dismissRecordingPreview();
        if (d.recordingStatus) d.recordingStatus.textContent += ' Büyük dosyanın önizlemesi belleği korumak için açılmadı; kaydedilen videoyu dosyalar uygulamasından oynatabilirsiniz.';
      }
    }
    if (filename && !isBusy) this._showSavedFileToast('Video', downloadResult || { saved: true, filename }, blob);
    if (canceled) this.showToast('Video dosyasını kaydetme işlemi iptal edildi.');
    if (error) this.showToast(`Kayıt hatası: ${error}`);
  }

  _showSavedFileToast(label, result, blob) {
    const message = saveResultMessage(label, result);
    let canShare = result?.method === 'capacitor' && Boolean(result.uri);
    if (!canShare && blob instanceof Blob && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], result.filename || 'animationer-export', { type: blob.type || 'application/octet-stream' });
        canShare = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });
      } catch {
        canShare = false;
      }
    }

    if (!canShare) {
      this.showToast(message);
      return;
    }

    const shareBlob = result?.method === 'capacitor' && result.uri ? null : blob;

    this.showToast(message, {
      actionLabel: 'Paylaş',
      action: async () => {
        try {
          await shareGeneratedFile(shareBlob, result);
          this.showToast(`${result.filename || label} için paylaşım seçenekleri açıldı.`);
        } catch (error) {
          this.showToast(error.name === 'AbortError' ? 'Dosya paylaşımı iptal edildi.' : `Dosya paylaşılamadı: ${error.message}`);
        }
      },
    });
  }

  _reportFileProgress(label, progress) {
    if (!progress) return;
    if (progress.stage === 'waiting-for-destination') {
      this.showToast(`${label}: Dosya kaydetme penceresinde konum seçin.`, { duration: 0 });
      return;
    }
    const written = (progress.bytesWritten / (1024 * 1024)).toFixed(1);
    const total = (progress.totalBytes / (1024 * 1024)).toFixed(1);
    this.showToast(`${label} kaydediliyor · ${progress.percent}% (${written}/${total} MiB)`, { duration: 0 });
    if (this.dom.toastProgress) {
      this.dom.toastProgress.hidden = false;
      this.dom.toastProgress.value = progress.percent;
    }
  }

  _showRecordingPreview(blob) {
    const video = this.dom.recordingVideoPreview;
    const panel = this.dom.recordingPreviewPanel;
    if (!video || !panel) return;
    if (this.recordingPreviewUrl) URL.revokeObjectURL(this.recordingPreviewUrl);
    this.recordingPreviewUrl = URL.createObjectURL(blob);
    video.src = this.recordingPreviewUrl;
    video.load();
    panel.hidden = false;
    if (!this.isPanelHidden) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  _dismissRecordingPreview() {
    const video = this.dom.recordingVideoPreview;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    if (this.recordingPreviewUrl) {
      URL.revokeObjectURL(this.recordingPreviewUrl);
      this.recordingPreviewUrl = null;
    }
    if (this.dom.recordingPreviewPanel) this.dom.recordingPreviewPanel.hidden = true;
  }

  /**
   * Klavye Kısayolları ('H' ile sinematik mod)
   * @private
   */
  _initShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Eğer kullanıcı metin kutusuna yazmıyorsa
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key === 'h' || e.key === 'H') {
        this.togglePanelVisibility();
      } else if (e.key === ' ' || e.code === 'Space') {
        // Space tuşu ile Reji Play/Pause
        e.preventDefault();
        if (this.timeline.isPlaying) {
          this.timeline.pause();
          this.showToast('Reji Duraklatıldı ⏸');
        } else {
          this.timeline.play();
          this.showToast('Reji Oynatılıyor ▶');
        }
      }
    });
  }

  /**
   * Sekme değiştirme
   * @param {string} tabId
   */
  switchTab(tabId) {
    this.activeTab = tabId;
    this.dom.tabButtons.forEach((btn) => {
      const isMatch = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isMatch);
    });
    this.dom.tabPanes.forEach((pane) => {
      const isMatch = pane.id === tabId;
      pane.style.display = isMatch ? 'block' : 'none';
    });
  }

  /**
   * Mobilde paneli daraltıp genişletir
   */
  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    if (this.dom.panelBody) {
      this.dom.panelBody.classList.toggle('collapsed', this.isCollapsed);
      this.dom.panelBody.setAttribute('aria-hidden', String(this.isCollapsed));
      this.dom.panelBody.inert = this.isCollapsed;
    }
    this.dom.btnCollapseHeader?.setAttribute('aria-expanded', String(!this.isCollapsed));
    this.dom.btnCollapseHeader?.setAttribute('aria-label', this.isCollapsed ? 'Paneli genişlet' : 'Paneli daralt');
    if (this.dom.panelCollapseArrow) {
      this.dom.panelCollapseArrow.textContent = this.isCollapsed ? '▴' : '▾';
    }
  }

  /**
   * Paneli tamamen gizler / gösterir ('H' tuşu veya Sinematik Mod)
   */
  togglePanelVisibility() {
    this.isPanelHidden = !this.isPanelHidden;
    if (this.dom.studioPanel) {
      this.dom.studioPanel.classList.toggle('hidden-cinematic', this.isPanelHidden);
      this.dom.studioPanel.setAttribute('aria-hidden', String(this.isPanelHidden));
      this.dom.studioPanel.inert = this.isPanelHidden;
    }
    if (this.dom.btnRestorePanel) {
      this.dom.btnRestorePanel.hidden = !this.isPanelHidden;
      this.dom.btnRestorePanel.setAttribute('aria-expanded', String(!this.isPanelHidden));
      this.dom.btnRestorePanel.setAttribute('aria-label', this.isPanelHidden ? 'Kontrol panelini aç' : 'Kontrol paneli açık');
    }
    if (this.dom.btnToggleVisibility) {
      this.dom.btnToggleVisibility.textContent = this.isPanelHidden ? 'Paneli Aç [H]' : 'Tam Ekran [H]';
      this.dom.btnToggleVisibility.setAttribute('aria-pressed', String(this.isPanelHidden));
    }
    if (this.isPanelHidden) this.dom.btnRestorePanel?.focus({ preventScroll: true });
    else this.dom.btnToggleVisibility?.focus({ preventScroll: true });
    this.showToast(this.isPanelHidden ? 'Sinematik görünüm açık. Kontrolleri aç düğmesiyle geri dönün.' : 'Stüdyo paneli açıldı.');
  }

  /**
   * Reji kayıt butonu durumunu günceller
   */
  updateRecordModeButton(isRecording) {
    const btn = this.dom.btnToggleRecord;
    if (btn) {
      btn.classList.toggle('recording-active', isRecording);
      btn.textContent = isRecording ? '● Adım Kaydediliyor (AÇIK)' : '○ Adım Kayıt Modu (KAPALI)';
    }
    if (this.dom.badgeRecordMode) {
      this.dom.badgeRecordMode.style.display = isRecording ? 'inline-flex' : 'none';
    }
  }

  getTimelineActionOptions(actorId = this.characters?.selectedId) {
    const options = { actorId };
    const duration = Number(this.dom.timelineDuration?.value);
    if (Number.isFinite(duration) && duration > 0) options.duration = duration;
    if (this.timeline.playMode === 'scheduled') {
      const startAt = Number(this.dom.timelineStartAt?.value);
      options.startAt = Number.isFinite(startAt) ? Math.max(0, startAt) : 0;
    }
    return options;
  }

  updateSpriteList(actors = this.sprites?.list?.() || [], selectedId = this.sprites?.selectedId) {
    const select = this.dom.spriteActorSelect;
    if (select) {
      select.replaceChildren();
      if (actors.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Önce spritesheet yükleyin';
        select.appendChild(option);
      } else {
        actors.forEach((actor) => {
          const option = document.createElement('option');
          option.value = actor.id;
          option.textContent = `${actor.name} (${actor.frameCount} kare)`;
          select.appendChild(option);
        });
        if (actors.some((actor) => actor.id === selectedId)) select.value = selectedId;
      }
      select.disabled = actors.length === 0;
    }

    const actor = actors.find((item) => item.id === selectedId) || null;
    if (actor) {
      if (this.dom.spritePositionX) this.dom.spritePositionX.value = Math.round(actor.x);
      if (this.dom.spritePositionY) this.dom.spritePositionY.value = Math.round(actor.y);
      if (this.dom.spriteDisplayHeight) this.dom.spriteDisplayHeight.value = Math.round(actor.displayHeight);
      if (this.dom.btnPreviewSprite) this.dom.btnPreviewSprite.textContent = actor.isPlaying ? '■ Durdur' : '▶ Önizle';
    } else if (this.dom.btnPreviewSprite) {
      this.dom.btnPreviewSprite.textContent = '▶ Önizle';
    }
    if (this.dom.btnRemoveSprite) this.dom.btnRemoveSprite.disabled = !actor;
    if (this.dom.btnApplySpriteTransform) this.dom.btnApplySpriteTransform.disabled = !actor;
    if (this.dom.btnPreviewSprite) this.dom.btnPreviewSprite.disabled = !actor;
    if (this.dom.btnAddSpriteTimelineStep) this.dom.btnAddSpriteTimelineStep.disabled = !actor;

    const list = this.dom.spriteListContainer;
    if (list) {
      list.replaceChildren();
      actors.forEach((item) => {
        const row = document.createElement('div');
        row.className = `sprite-list-item${item.id === selectedId ? ' active' : ''}`;
        const name = document.createElement('span');
        name.textContent = item.name;
        const meta = document.createElement('span');
        meta.className = 'sprite-list-meta';
        meta.textContent = `${item.columns}×${item.rows} · ${item.fps} FPS${item.isPlaying ? ' · oynuyor' : ''}`;
        row.append(name, meta);
        list.appendChild(row);
      });
    }
  }

  updateWorldSpriteUI(
    templates = this.worldSprites?.listTemplates?.() || [],
    actors = this.worldSprites?.listActors?.() || [],
    selectedId = this.worldSprites?.selectedId,
    selectedTemplateId = this.worldSprites?.selectedTemplateId,
    activeControl = this.worldSprites?.activeControl || false
  ) {
    const fill = (select, items, selectedValue, emptyText, labelFor) => {
      if (!select) return;
      select.replaceChildren();
      if (!items.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = emptyText;
        select.appendChild(option);
      } else {
        for (const item of items) {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = labelFor(item);
          select.appendChild(option);
        }
        if (items.some((item) => item.id === selectedValue)) select.value = selectedValue;
      }
      select.disabled = items.length === 0;
    };
    fill(this.dom.worldSpriteTemplateSelect, templates, selectedTemplateId, 'Önce kitaplığa spritesheet ekleyin', (item) => `${item.name} (${item.columns}×${item.rows})`);
    fill(this.dom.worldSpriteActorSelect, actors, selectedId, 'Henüz dünyaya karakter eklenmedi', (item) => item.name);
    if (this.dom.btnSpawnWorldSprite) this.dom.btnSpawnWorldSprite.disabled = templates.length === 0;
    if (this.dom.btnDeleteWorldSpriteTemplate) this.dom.btnDeleteWorldSpriteTemplate.disabled = templates.length === 0;
    if (this.dom.btnRemoveWorldSprite) this.dom.btnRemoveWorldSprite.disabled = actors.length === 0;
    if (this.dom.btnWorldSpriteControl) {
      this.dom.btnWorldSpriteControl.textContent = activeControl ? '2D Hareket Modu: Açık' : '2D Hareket Modu: Kapalı';
      this.dom.btnWorldSpriteControl.setAttribute('aria-pressed', String(Boolean(activeControl)));
      this.dom.btnWorldSpriteControl.disabled = actors.length === 0;
    }
    const list = this.dom.worldSpriteListContainer;
    if (list) {
      list.replaceChildren();
      for (const actor of actors) {
        const row = document.createElement('div');
        row.className = `sprite-list-item${actor.id === selectedId ? ' active' : ''}`;
        const name = document.createElement('span');
        name.textContent = actor.name;
        const position = document.createElement('span');
        position.className = 'sprite-list-meta';
        position.textContent = `X ${actor.x.toFixed(1)} · Y ${actor.y.toFixed(1)} · Z ${actor.z.toFixed(1)}${actor.isMoving ? ' · yürüyor' : ''}`;
        row.append(name, position);
        list.appendChild(row);
      }
    }
  }

  updateCharacterList(actors = this.characters?.list?.() || []) {
    const currentSelection = this.characters?.selectedId;
    const currentTarget = this.dom.timelineFollowTarget?.value;
    const fill = (element, rows, selectedValue) => {
      if (!element) return;
      element.replaceChildren();
      rows.forEach((actor) => {
        const option = document.createElement('option');
        option.value = actor.id;
        option.textContent = actor.name;
        element.appendChild(option);
      });
      if (rows.some((actor) => actor.id === selectedValue)) element.value = selectedValue;
    };
    fill(this.dom.characterSelect, actors, currentSelection);
    fill(this.dom.timelineFollowTarget, actors.filter((actor) => actor.id !== currentSelection), currentTarget);
    const activeCharacter = this.characters?.selectedCharacter;
    if (activeCharacter && this.dom.sliderSpeed) this.dom.sliderSpeed.value = activeCharacter.walkSpeed;
    if (activeCharacter && this.dom.sliderWobble) this.dom.sliderWobble.value = activeCharacter.wobbleIntensity;
    if (activeCharacter && this.dom.labelSpeedVal) this.dom.labelSpeedVal.textContent = `${activeCharacter.walkSpeed.toFixed(1)} m/s`;
    if (activeCharacter && this.dom.labelWobbleVal) this.dom.labelWobbleVal.textContent = `${activeCharacter.wobbleIntensity.toFixed(1)}x`;
    if (this.dom.btnRemoveCharacter) this.dom.btnRemoveCharacter.disabled = actors.length <= 1;
    if (this.dom.btnAddFollowStep) this.dom.btnAddFollowStep.disabled = actors.length <= 1;
  }

  /**
   * Timeline UI listesini ve butonlarını günceller
   */
  updateTimelineUI() {
    const list = this.dom.timelineListContainer;
    if (!list) return;
    if (this.dom.timelinePlayMode) this.dom.timelinePlayMode.value = this.timeline.playMode;

    list.innerHTML = '';

    if (this.timeline.steps.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'timeline-empty-msg';
      emptyMsg.textContent = 'Kuyruk boş. Kayıt modunu açıp sahneye tıklayın veya "+ Adım Ekle" butonlarını kullanın.';
      list.appendChild(emptyMsg);
      return;
    }

    this.timeline.steps.forEach((step, idx) => {
      const item = document.createElement('div');
      item.className = 'timeline-step-card';
      if (idx === this.timeline.currentStepIndex && this.timeline.isPlaying) {
        item.classList.add('step-active');
      }

      let typeBadge = 'EYLEM';
      if (step.type === 'MOVE_TO') typeBadge = 'YÜRÜ';
      else if (step.type === 'WAIT') typeBadge = 'BEKLE';
      else if (step.type === 'TRIGGER_DOOR') typeBadge = 'KAPI';
      else if (step.type === 'SWITCH_CAMERA') typeBadge = 'KAMERA';
      else if (step.type === 'PLAY_EMOTE') typeBadge = 'EMOTE';
      else if (step.type === 'FOLLOW') typeBadge = 'TAKİP';
      else if (step.type === 'SET_VISIBILITY') typeBadge = step.data.visible ? 'GÖSTER' : 'GİZLE';
      else if (step.type === 'PLAY_SPRITE_ANIMATION') typeBadge = '2D ANİM';

      item.innerHTML = `
        <div class="step-num">${idx + 1}</div>
        <div class="step-content">
          <button type="button" class="step-run-button">
            <span class="step-badge">${typeBadge}</span>
            <span class="step-title"></span>
            <span class="step-meta"></span>
          </button>
        </div>
        <div class="step-actions">
          <button class="step-btn-icon btn-step-up" title="Yukarı Taşı">▲</button>
          <button class="step-btn-icon btn-step-down" title="Aşağı Taşı">▼</button>
          <button class="step-btn-icon btn-step-delete" title="Sil">✕</button>
        </div>
      `;
      if (step.type === 'PLAY_SPRITE_ANIMATION') {
        const editor = document.createElement('div'); editor.className = 'timeline-sprite-editor';
        const spriteSelect = document.createElement('select'); spriteSelect.className = 'hud-select'; spriteSelect.setAttribute('aria-label', 'Animasyon spritesheet');
        for (const sprite of this.sprites?.list?.() || []) { const option = document.createElement('option'); option.value = sprite.id; option.textContent = sprite.name; spriteSelect.appendChild(option); }
        spriteSelect.value = step.actorId || ''; spriteSelect.addEventListener('change', (event) => { event.stopPropagation(); step.actorId = spriteSelect.value; });
        const duration = document.createElement('input'); duration.type = 'number'; duration.min = '0.01'; duration.max = '3600'; duration.step = '0.1'; duration.value = step.duration ?? 2; duration.setAttribute('aria-label', 'Süre (s)');
        duration.addEventListener('change', (event) => { event.stopPropagation(); const value = Number(duration.value); if (Number.isFinite(value) && value > 0) step.duration = value; else duration.value = step.duration ?? 2; });
        const start = document.createElement('input'); start.type = 'number'; start.min = '0'; start.max = '3600'; start.step = '0.1'; start.value = step.startAt ?? 0; start.setAttribute('aria-label', 'Başlangıç (s)');
        start.addEventListener('change', (event) => { event.stopPropagation(); const value = Number(start.value); if (Number.isFinite(value) && value >= 0) step.startAt = value; else start.value = step.startAt ?? 0; });
        const loop = document.createElement('select'); loop.className = 'hud-select'; loop.setAttribute('aria-label', 'Oynatma biçimi');
        for (const [value, label] of [['true', 'Loop'], ['false', 'Tek sefer']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; loop.appendChild(option); }
        loop.value = String(step.data?.loop !== false); loop.addEventListener('change', (event) => { event.stopPropagation(); step.data.loop = loop.value === 'true'; });
        for (const control of [spriteSelect, duration, start, loop]) control.addEventListener('click', (event) => event.stopPropagation());
        editor.append(spriteSelect, duration, start, loop); item.querySelector('.step-content').appendChild(editor);
      }
      item.querySelector('.step-title').textContent = step.title || 'Adım';
      const actorName = this.characters?.getActor?.(step.actorId)?.name || this.sprites?.getActor?.(step.actorId)?.name || (step.actorId ? 'Karakter' : 'Aktif karakter');
      const meta = [actorName];
      if (Number.isFinite(step.startAt)) meta.push(`başlangıç ${step.startAt}s`);
      if (Number.isFinite(step.duration)) meta.push(`süre ${step.duration}s`);
      item.querySelector('.step-meta').textContent = meta.join(' · ');

      item.querySelector('.btn-step-up').addEventListener('click', (e) => {
        e.stopPropagation();
        this.timeline.moveStep(idx, idx - 1);
      });
      item.querySelector('.btn-step-down').addEventListener('click', (e) => {
        e.stopPropagation();
        this.timeline.moveStep(idx, idx + 1);
      });
      item.querySelector('.btn-step-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.timeline.removeStep(idx);
      });

      const runButton = item.querySelector('.step-run-button');
      runButton.setAttribute('aria-label', `Çalıştır: ${idx + 1}. adım, ${step.title || 'Adım'}`);
      runButton.addEventListener('click', () => {
        this.timeline.currentStepIndex = idx;
        this.timeline._executeStep(step);
        this.showToast(`${idx + 1}. Adım Çalıştırıldı: ${step.title}`);
      });

      list.appendChild(item);
    });

    if (this.dom.labelTimelineStatus) {
      if (this.timeline.isPlaying) {
        this.dom.labelTimelineStatus.textContent = `Reji: Adım ${this.timeline.currentStepIndex + 1}/${this.timeline.steps.length}`;
      } else if (this.timeline.isPaused) {
        this.dom.labelTimelineStatus.textContent = `Reji: Duraklatıldı (${this.timeline.currentStepIndex + 1})`;
      } else {
        this.dom.labelTimelineStatus.textContent = `Reji: Hazır (${this.timeline.steps.length} Adım)`;
      }
    }
  }

  updateWallBoxList() {
    const list = this.dom.wallBoxList;
    if (!list) return;
    list.replaceChildren();
    const boxes = this.mapLoader?.collisionManager?.wallBoxes || [];
    if (!boxes.length) {
      const empty = document.createElement('div');
      empty.className = 'studio-info-text';
      empty.textContent = 'Henüz engel kutusu eklenmedi.';
      list.appendChild(empty);
      return;
    }
    boxes.forEach((box, index) => {
      const row = document.createElement('div');
      row.className = 'studio-wall-box-row';
      const details = document.createElement('span');
      const meta = box.userData || {};
      details.textContent = `#${index + 1} · X ${box.position.x.toFixed(1)}, Z ${box.position.z.toFixed(1)} · ${meta.width}×${meta.depth}×${meta.height} m`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'station-action-btn';
      remove.title = `Engel #${index + 1} sil`;
      remove.setAttribute('aria-label', `Engel #${index + 1} sil`);
      remove.textContent = '✕';
      remove.addEventListener('click', () => {
        this.mapLoader.removeWallBox(box);
        this.updateWallBoxList();
        this.showToast(`Engel Kutusu #${index + 1} Silindi`);
      });
      row.append(details, remove);
      list.appendChild(row);
    });
  }

  /**
   * Kamera istasyonları listesini render eder
   */
  updateCameraList(stations, activeId) {
    const container = this.dom.cameraListContainer;
    if (!container) return;

    container.innerHTML = '';

    stations.forEach((st, idx) => {
      const card = document.createElement('div');
      card.className = 'station-card';
      if (st.id === activeId) {
        card.classList.add('active');
      }

      card.innerHTML = `
        <div class="station-card-left">
          <span class="station-dot"></span>
          <span class="station-name">${st.name}</span>
          ${st.isAutoTrigger ? '<span class="station-auto-badge">OTO</span>' : ''}
        </div>
        <div class="station-card-actions">
          <button class="station-action-btn btn-update" title="Açıyı Güncelle">↻</button>
          ${!st.isAutoTrigger ? '<button class="station-action-btn btn-delete" title="Sil">✕</button>' : ''}
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') {
          this.cameraManager.transitionToStation(st);
          this.showToast(`${st.name} Kamerasına Geçildi`);
        }
      });

      const btnUpd = card.querySelector('.btn-update');
      if (btnUpd) {
        btnUpd.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cameraManager.updateStation(st.id);
          this.showToast(`${st.name} Açısı Güncellendi`);
        });
      }

      const btnDel = card.querySelector('.btn-delete');
      if (btnDel) {
        btnDel.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cameraManager.removeStation(st.id);
          this.showToast(`${st.name} Silindi`);
        });
      }

      container.appendChild(card);
    });
  }

  /**
   * Monokrom Toast Bildirimi Gösterir
   * @param {string} msg
   */
  showToast(msg, { actionLabel, action, duration = 4500 } = {}) {
    const toast = this.dom.toast;
    if (!toast) return;

    if (this.dom.toastMessage) this.dom.toastMessage.textContent = msg;
    else toast.textContent = msg;
    if (this.dom.toastProgress) {
      this.dom.toastProgress.hidden = true;
      this.dom.toastProgress.value = 0;
    }
    if (this.dom.toastAction) {
      this.dom.toastAction.hidden = typeof action !== 'function';
      this.dom.toastAction.textContent = actionLabel || '';
      this.dom.toastAction.disabled = false;
      this.dom.toastAction.onclick = typeof action === 'function' ? async () => {
        this.dom.toastAction.disabled = true;
        try {
          await action();
        } catch (error) {
          this.showToast(`İşlem tamamlanamadı: ${error.message || 'bilinmeyen hata'}`);
        } finally {
          if (this.dom.toastAction) this.dom.toastAction.disabled = false;
        }
      } : null;
    }
    toast.classList.add('show');

    clearTimeout(this.toastTimer);
    if (duration > 0) {
      this.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    }
  }
}
