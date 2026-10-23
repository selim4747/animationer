/**
 * UIManager.js
 * Monokrom Stüdyo HUD Panelini yöneten arayüz sınıfı.
 * Sekmeler (Sahne, Kameralar, Karakter, Reji/Timeline, Render/Dışa Aktar),
 * kaydırıcılar, sinematik mod ('H' kısayolu), bildirimler (Toast) ve
 * video/ekran görüntüsü dışa aktarma (RecorderManager) kontrollerini yönetir.
 */

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
  constructor({ timelineManager, character, door, cameraManager, mapLoader, recorderManager, sceneHelpers }) {
    this.timeline = timelineManager;
    this.character = character;
    this.door = door;
    this.cameraManager = cameraManager;
    this.mapLoader = mapLoader;
    this.recorder = recorderManager;
    this.sceneHelpers = sceneHelpers || {};

    this.isPanelHidden = false; // 'H' tuşu ve sinematik mod
    this.isCollapsed = false; // Mobilde paneli küçültme
    this.activeTab = 'tab-timeline'; // Başlangıçta Reji/Timeline açık olsun

    this._cacheDOM();
    this._bindEvents();
    this._initShortcuts();

    // İlk durum senkronizasyonu
    this.updateTimelineUI();
    this.updateCameraList(this.cameraManager.stations, this.cameraManager.activeStationId);
  }

  setRecorder(recorderManager) {
    this.recorder = recorderManager;
  }

  _cacheDOM() {
    this.dom = {
      // Ana Panel & Başlık
      studioPanel: document.getElementById('studio-panel'),
      btnToggleVisibility: document.getElementById('btn-toggle-hud-vis'),
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

      // Sekme Butonları & Panelleri
      tabButtons: document.querySelectorAll('.studio-tab-btn'),
      tabPanes: document.querySelectorAll('.studio-tab-pane'),

      // Sekme 1: REJİ / TIMELINE
      timelineListContainer: document.getElementById('timeline-steps-list'),
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

      // Sekme 3: KAMERALAR
      btnFreeOrbit: document.getElementById('btn-free-orbit'),
      btnAddCamera: document.getElementById('btn-add-camera'),
      btnToggleFollow: document.getElementById('btn-toggle-follow'),
      btnToggleTour: document.getElementById('btn-toggle-tour'),
      labelTourBtn: document.getElementById('label-tour-btn'),
      cameraListContainer: document.getElementById('studio-camera-list'),

      // Sekme 4: KARAKTER & MERDİVEN
      sliderSpeed: document.getElementById('slider-character-speed'),
      labelSpeedVal: document.getElementById('label-speed-val'),
      sliderWobble: document.getElementById('slider-wobble-intensity'),
      labelWobbleVal: document.getElementById('label-wobble-val'),
      btnResetSpawn: document.getElementById('btn-reset-spawn'),
      btnEmoteJump: document.getElementById('btn-emote-jump'),
      btnEmoteWave: document.getElementById('btn-emote-wave'),
      btnEmoteSpin: document.getElementById('btn-emote-spin'),

      // Sekme 5: DIŞA AKTAR / RENDER
      btnTakeScreenshot: document.getElementById('btn-take-screenshot'),
      btnQuality720p: document.getElementById('btn-quality-720p'),
      btnQuality1080p: document.getElementById('btn-quality-1080p'),
      labelRenderRes: document.getElementById('label-render-res'),
      btnToggleVideoRecord: document.getElementById('btn-toggle-video-record'),
      btnRecordSequence: document.getElementById('btn-record-sequence'),
      renderRecordingBanner: document.getElementById('render-recording-banner'),
      labelBannerTimer: document.getElementById('label-banner-timer'),

      // Toast & Modallar
      toast: document.getElementById('toast'),
      modalHelp: document.getElementById('modal-help'),
      btnOpenHelp: document.getElementById('btn-open-help'),
      btnCloseHelp: document.getElementById('btn-close-help'),
      dragOverlay: document.getElementById('drag-overlay'),
    };
  }

  _bindEvents() {
    const d = this.dom;

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
        this.showToast('Reji Durduruldu ve Başa Alındı ⏹');
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
        this.timeline.addStep('WAIT', { duration: 2 }, '2 Saniye Durakla');
        this.showToast('Kuyruğa 2s Bekleme Adımı Eklendi');
      });
    }

    if (d.btnAddDoorStep) {
      d.btnAddDoorStep.addEventListener('click', () => {
        this.timeline.addStep('TRIGGER_DOOR', { action: 'toggle' }, 'Kapıyı Tetikle (Aç/Kapat)');
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
          `Kameraya Geç: ${st ? st.name : 'Kamera 1'}`
        );
        this.showToast('Kuyruğa Kamera Değişimi Eklendi');
      });
    }

    if (d.btnAddEmoteStep) {
      d.btnAddEmoteStep.addEventListener('click', () => {
        this.timeline.addStep('PLAY_EMOTE', { emote: 'jump' }, 'Karakter Zıplasın (Emote)');
        this.showToast('Kuyruğa Emote Adımı Eklendi');
      });
    }

    // JSON İçe / Dışa Aktarma
    if (d.btnExportJSON) {
      d.btnExportJSON.addEventListener('click', () => {
        this.timeline.downloadSequenceJSON('studio-timeline-sequence.json');
        this.showToast('Zaman Çizelgesi JSON Olarak İndirildi');
      });
    }

    if (d.btnImportJSON && d.fileInputJSON) {
      d.btnImportJSON.addEventListener('click', () => d.fileInputJSON.click());
      d.fileInputJSON.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              this.timeline.importSequence(evt.target.result);
              this.showToast('Zaman Çizelgesi Başarıyla Yüklendi');
            } catch (err) {
              this.showToast('HATA: Geçersiz JSON Dosyası!');
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
        this.showToast('Kuyruk Temizlendi');
      });
    }

    // --- SEKME 2: SAHNE / HARİTA ---
    if (d.btnTriggerFile && d.filePicker) {
      d.btnTriggerFile.addEventListener('click', () => d.filePicker.click());
      d.filePicker.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          this.mapLoader.loadFile(file);
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
        this.showToast(`Engel Kutusu Eklendi (#${box.id})`);
      });
    }

    if (d.btnClearWallBoxes) {
      d.btnClearWallBoxes.addEventListener('click', () => {
        this.mapLoader.clearWallBoxes();
        this.showToast('Tüm Engel Kutuları Silindi');
      });
    }

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
      d.btnTakeScreenshot.addEventListener('click', () => {
        if (this.recorder) {
          const fn = this.recorder.takeScreenshot();
          if (fn) {
            this.showToast(`📸 Ekran Görüntüsü İndirildi (${fn})`);
          }
        }
      });
    }

    if (d.btnQuality720p && d.btnQuality1080p) {
      d.btnQuality720p.addEventListener('click', () => {
        if (this.recorder) this.recorder.setQuality('720p');
        d.btnQuality720p.classList.add('active');
        d.btnQuality1080p.classList.remove('active');
        if (d.labelRenderRes) d.labelRenderRes.textContent = '720p (4.0 Mbps)';
        this.showToast('Render Kalitesi: 720p');
      });

      d.btnQuality1080p.addEventListener('click', () => {
        if (this.recorder) this.recorder.setQuality('1080p');
        d.btnQuality1080p.classList.add('active');
        d.btnQuality720p.classList.remove('active');
        if (d.labelRenderRes) d.labelRenderRes.textContent = '1080p HD (8.5 Mbps)';
        this.showToast('Render Kalitesi: 1080p HD (60 FPS)');
      });
    }

    if (d.btnToggleVideoRecord) {
      d.btnToggleVideoRecord.addEventListener('click', () => {
        if (!this.recorder) return;
        if (this.recorder.isRecording) {
          this.recorder.stopRecording();
          this.showToast('Video kaydı durduruluyor ve indiriliyor...');
        } else {
          const ok = this.recorder.startRecording();
          if (ok) {
            this.showToast('● 60 FPS Video Kaydı Başlatıldı');
          } else {
            this.showToast('HATA: Video kaydı başlatılamadı!');
          }
        }
      });
    }

    if (d.btnRecordSequence) {
      d.btnRecordSequence.addEventListener('click', () => {
        if (!this.recorder || this.recorder.isRecording) return;

        this.showToast('🎬 Reji Kaydı Başlatılıyor (Sinematik Tam Ekran)...');

        this.recorder.recordTimelineSequence(this.timeline, {
          onBeforeStart: () => {
            // Kayıt esnasında arayüz görünmesin (Sinematik mod)
            if (!this.isPanelHidden) {
              this.togglePanelVisibility();
            }
          },
          onAfterFinish: () => {
            // Kayıt bitince paneli geri getir
            if (this.isPanelHidden) {
              this.togglePanelVisibility();
            }
            this.showToast('🎬 Reji Videosu Başarıyla İndirildi!');
          },
        });
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
  updateRecorderUI({ isRecording, duration, formattedDuration, filename }) {
    const d = this.dom;

    // Üst rozet
    if (d.badgeRecorderMode) {
      d.badgeRecorderMode.style.display = isRecording ? 'inline-flex' : 'none';
      if (d.labelRecorderMode) {
        d.labelRecorderMode.textContent = `● REC ${formattedDuration || '00:00'}`;
      }
    }

    // Tab 5 buton ve banner
    if (d.btnToggleVideoRecord) {
      if (isRecording) {
        d.btnToggleVideoRecord.classList.add('recording-active');
        d.btnToggleVideoRecord.textContent = `⏹ Kaydı Durdur (${formattedDuration || '00:00'})`;
      } else {
        d.btnToggleVideoRecord.classList.remove('recording-active');
        d.btnToggleVideoRecord.textContent = '● Manuel Video Kaydı Başlat';
      }
    }

    if (d.renderRecordingBanner) {
      d.renderRecordingBanner.style.display = isRecording ? 'flex' : 'none';
      if (d.labelBannerTimer) {
        d.labelBannerTimer.textContent = `CANVAS KAYDEDİLİYOR: ${formattedDuration || '00:00'}`;
      }
    }

    if (filename && !isRecording) {
      this.showToast(`Video Kaydedildi: ${filename}`);
    }
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
    }
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
    }
    if (this.dom.btnToggleVisibility) {
      this.dom.btnToggleVisibility.textContent = this.isPanelHidden ? 'Paneli Aç [H]' : 'Tam Ekran [H]';
    }
    this.showToast(this.isPanelHidden ? 'Sinematik Tam Ekran Modu (Geri dönmek için H)' : 'Stüdyo Paneli Açıldı');
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

  /**
   * Timeline UI listesini ve butonlarını günceller
   */
  updateTimelineUI() {
    const list = this.dom.timelineListContainer;
    if (!list) return;

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

      item.innerHTML = `
        <div class="step-num">${idx + 1}</div>
        <div class="step-content">
          <div class="step-badge">${typeBadge}</div>
          <div class="step-title">${step.title || 'Adım'}</div>
        </div>
        <div class="step-actions">
          <button class="step-btn-icon btn-step-up" title="Yukarı Taşı">▲</button>
          <button class="step-btn-icon btn-step-down" title="Aşağı Taşı">▼</button>
          <button class="step-btn-icon btn-step-delete" title="Sil">✕</button>
        </div>
      `;

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

      item.addEventListener('click', () => {
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
  showToast(msg) {
    const toast = this.dom.toast;
    if (!toast) return;

    toast.textContent = msg;
    toast.classList.add('show');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }
}
