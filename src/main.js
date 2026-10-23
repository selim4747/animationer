/**
 * main.js
 * Modüler Three.js WebGL & Capacitor mimarisini başlatan ana giriş noktası.
 * MapLoader, Character, Door ve CameraManager bileşenlerini koordine eder.
 */

import * as THREE from 'three';
import { MapLoader } from './components/MapLoader.js';
import { Character } from './components/Character.js';
import { Door } from './components/Door.js';
import { CameraManager } from './components/CameraManager.js';

class App {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.clock = new THREE.Clock();

    // Dokunma (Tap) vs Sürükleme (Drag) ayrımı için değişkenler
    this.pointerDownPos = { x: 0, y: 0 };
    this.pointerDownTime = 0;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this._initScene();
    this._initLightingAndEnvironment();
    this._initComponents();
    this._initUI();
    this._bindEvents();

    this._animate();
  }

  /**
   * Three.js sahne, kamera ve render motorunu başlatır
   * @private
   */
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080808);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(12, 10, 16);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);
  }

  /**
   * Katı monokrom ışıklandırma ve referans zemin ızgarası
   * @private
   */
  _initLightingAndEnvironment() {
    // 1. Ortam Işığı (Nötr Beyaz & Koyu Gri)
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x111111, 1.0);
    this.scene.add(this.hemiLight);

    // 2. Yön Işığı (Güneş - Yumuşak Gölge)
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.dirLight.position.set(16, 26, 14);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.bias = -0.0004;

    const d = 26;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 100;
    this.scene.add(this.dirLight);

    // 3. Monokrom Referans Zemin Izgarası
    this.gridHelper = new THREE.GridHelper(36, 36, 0x444444, 0x1a1a1a);
    this.gridHelper.position.y = -0.002;
    this.scene.add(this.gridHelper);

    // 4. Zemin Gölge Düzlemi (ShadowMaterial)
    const shadowGeo = new THREE.PlaneGeometry(100, 100);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.groundShadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    this.groundShadowPlane.rotation.x = -Math.PI / 2;
    this.groundShadowPlane.position.y = -0.003;
    this.groundShadowPlane.receiveShadow = true;
    this.scene.add(this.groundShadowPlane);
  }

  /**
   * Modüler bileşenleri ilklendirir
   * @private
   */
  _initComponents() {
    // 1. Menteşeli Kapı & Kesit Mimarisi
    this.door = new Door(this.scene, (state) => {
      this._updateDoorHUD(state.isOpen);
    });

    // 2. Prosedürel Karakter
    this.character = new Character(this.scene, (state) => {
      this._updateCharacterHUD(state.isMoving);
    });

    // 3. Kamera Yöneticisi & CCTV İstasyonları
    this.cameraManager = new CameraManager(
      this.camera,
      this.renderer.domElement,
      (state) => {
        this._updateCameraHUD(state);
      }
    );

    // 4. Harita / Model Yükleyici
    this.mapLoader = new MapLoader(this.scene, (status) => {
      this._updateMapHUD(status);
    });
  }

  /**
   * HUD arayüz öğeleri ve olay bağlayıcıları
   * @private
   */
  _initUI() {
    // Rozet Öğeleri
    this.badgeCamText = document.getElementById('label-camera-mode');
    this.badgeCharText = document.getElementById('label-char-mode');
    this.badgeCharEl = document.getElementById('badge-char-mode');
    this.badgeDoorText = document.getElementById('label-door-mode');
    this.badgeDoorEl = document.getElementById('badge-door-mode');
    this.toastEl = document.getElementById('toast');

    // İstasyon listesi container
    this.stationGridEl = document.getElementById('station-cards-grid');

    // İlk istasyon listesini çiz
    this._renderStationsList(this.cameraManager.stations, null);
  }

  /**
   * Kullanıcı giriş olaylarını bağlar
   * @private
   */
  _bindEvents() {
    // 1. Dokunma / Tıklama Tespiti (Tap vs Drag)
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.pointerDownTime = performance.now();
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      const dist = Math.hypot(dx, dy);
      const elapsed = performance.now() - this.pointerDownTime;

      // Eğer kullanıcı kamerayı çevirmek yerine ekrana dokunup bıraktıysa (Tap)
      if (dist < 8 && elapsed < 400) {
        this._handleCanvasTap(e);
      }
    });

    // 2. Pencere Boyutlandırma
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 3. Dock Sekmeleri
    document.querySelectorAll('.dock-tab-btn').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dock-tab-btn').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.dock-tab-pane').forEach((p) => (p.style.display = 'none'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).style.display = 'block';
      });
    });

    // 4. Dock Katlama (Collapse)
    const dock = document.getElementById('hud-dock');
    const dockTrigger = document.getElementById('btn-toggle-dock');
    const dockArrow = document.getElementById('dock-collapse-arrow');
    const dockLabel = document.getElementById('dock-collapse-label');
    dockTrigger.addEventListener('click', () => {
      const isCol = dock.classList.toggle('collapsed');
      dockArrow.textContent = isCol ? '▴' : '▾';
      dockLabel.textContent = isCol ? 'Panel [Aç]' : 'Panel [Gizle]';
    });

    // 5. Kapı Aç/Kapat Butonları
    const handleDoorToggle = () => this.door.toggle();
    document.getElementById('btn-toggle-door').addEventListener('click', handleDoorToggle);
    document.getElementById('btn-toggle-door-panel').addEventListener('click', handleDoorToggle);

    // 6. Karakter Takip Toggle
    const btnFollow = document.getElementById('btn-toggle-follow');
    btnFollow.addEventListener('click', () => {
      const current = this.cameraManager.followCharacter;
      this.cameraManager.setFollow(!current);
      btnFollow.classList.toggle('primary', !current);
      btnFollow.textContent = `◉ Karakteri Takip Et: [${!current ? 'AÇIK' : 'KAPALI'}]`;
      this.showToast(`Kamera takibi: ${!current ? 'Açık' : 'Kapalı'}`);
    });

    // 7. Karakter Hızı Döngüsü
    const btnSpeed = document.getElementById('btn-cycle-speed');
    const labelSpeed = document.getElementById('label-speed-val');
    btnSpeed.addEventListener('click', () => {
      if (this.character.walkSpeed === 4.2) {
        this.character.setSpeed(7.0);
        labelSpeed.textContent = 'Koşu (7.0m/s)';
      } else if (this.character.walkSpeed === 7.0) {
        this.character.setSpeed(2.4);
        labelSpeed.textContent = 'Adım (2.4m/s)';
      } else {
        this.character.setSpeed(4.2);
        labelSpeed.textContent = 'Normal (4.2m/s)';
      }
      this.showToast(`Hız: ${labelSpeed.textContent}`);
    });

    // 8. Karakteri Sıfırla
    document.getElementById('btn-reset-character').addEventListener('click', () => {
      this.character.resetPosition(0, 0, 0);
      this.showToast('Karakter (0, 0, 0) noktasına sıfırlandı.');
    });

    // 9. Kamera İstasyon Butonları
    document.getElementById('btn-add-camera').addEventListener('click', () => {
      const st = this.cameraManager.addCurrentAsStation();
      this.showToast(`${st.name} kaydedildi.`);
    });

    document.getElementById('btn-free-orbit').addEventListener('click', () => {
      this.cameraManager.setFreeMode();
      this.showToast('Serbest kamera moduna geçildi.');
    });

    const btnTour = document.getElementById('btn-toggle-tour');
    const labelTour = document.getElementById('label-tour-btn');
    btnTour.addEventListener('click', () => {
      if (this.cameraManager.isTourActive) {
        this.cameraManager.stopTour();
        labelTour.textContent = 'Kamera Turu';
        this.showToast('Tur durduruldu.');
      } else {
        if (this.cameraManager.stations.length < 2) {
          this.showToast('Tur için en az 2 istasyon gerekir!');
          return;
        }
        this.cameraManager.startTour();
        labelTour.textContent = 'Turu Durdur';
        this.showToast('Kamera turu başlatıldı.');
      }
    });

    document.getElementById('btn-clear-stations').addEventListener('click', () => {
      if (confirm('Tüm kayıtlı istasyonları silmek istiyor musunuz?')) {
        this.cameraManager.stations = [];
        this.cameraManager.setFreeMode();
        this._renderStationsList([], null);
        this.showToast('İstasyonlar silindi.');
      }
    });

    // 10. Dosya Yükleme & Sürükle-Bırak
    const filePicker = document.getElementById('file-picker');
    const dropZone = document.getElementById('drop-zone');
    const dragOverlay = document.getElementById('drag-overlay');

    dropZone.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.mapLoader.handleFile(e.target.files[0]);
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      dragOverlay.classList.add('active');
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) dragOverlay.classList.remove('active');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragOverlay.classList.remove('active');
      if (e.dataTransfer && e.dataTransfer.files[0]) {
        this.mapLoader.handleFile(e.dataTransfer.files[0]);
      }
    });

    // 11. 2D Yönelim & Kaydırıcılar
    const btnHoriz = document.getElementById('btn-orient-horizontal');
    const btnVert = document.getElementById('btn-orient-vertical');
    btnHoriz.addEventListener('click', () => {
      this.mapLoader.setOrientation(true);
      btnHoriz.classList.add('active');
      btnVert.classList.remove('active');
      this.showToast('Görsel zemin (XZ) moduna alındı.');
    });
    btnVert.addEventListener('click', () => {
      this.mapLoader.setOrientation(false);
      btnVert.classList.add('active');
      btnHoriz.classList.remove('active');
      this.showToast('Görsel duvar (XY) moduna alındı.');
    });

    document.getElementById('slider-image-size').addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('label-image-size').textContent = val + 'm';
      this.mapLoader.setScale(val);
    });

    document.getElementById('slider-image-alpha').addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('label-image-alpha').textContent = Math.round(val * 100) + '%';
      this.mapLoader.setOpacity(val);
    });

    // 12. Haritaya Odaklan & Temizle
    document.getElementById('btn-focus-map').addEventListener('click', () => {
      this.camera.position.set(12, 10, 16);
      this.cameraManager.controls.target.set(0, 1.2, 0);
      this.showToast('Harita merkezine odaklanıldı.');
    });
    document.getElementById('btn-clear-map').addEventListener('click', () => {
      this.mapLoader.clear();
      document.getElementById('panel-image-options').style.display = 'none';
      this.showToast('Yüklü harita kaldırıldı.');
    });

    // 13. Hızlı Demolar
    document.getElementById('btn-load-floorplan').addEventListener('click', () => {
      this.mapLoader.loadDemoFloorPlan();
      document.getElementById('panel-image-options').style.display = 'flex';
      this.showToast('2D Kat Planı yüklendi.');
    });
    document.getElementById('btn-load-gallery').addEventListener('click', () => {
      this.mapLoader.loadDemo3DGallery();
      document.getElementById('panel-image-options').style.display = 'none';
      this.showToast('3D Galeri yüklendi.');
    });

    // 14. Kesit Zorlama Modu Butonu
    const btnCutaway = document.getElementById('btn-force-cutaway');
    const labelCutaway = document.getElementById('label-cutaway-mode');
    btnCutaway.addEventListener('click', () => {
      this.door.forceCutaway = !this.door.forceCutaway;
      labelCutaway.textContent = this.door.forceCutaway ? 'Sürekli Açık (Şeffaf)' : 'Otomatik (Yakınlıkta)';
      btnCutaway.classList.toggle('primary', this.door.forceCutaway);
      this.showToast(`Kesit Modu: ${labelCutaway.textContent}`);
    });

    // 15. Yardım Modalı
    const modal = document.getElementById('modal-help');
    document.getElementById('btn-open-help').addEventListener('click', () => modal.classList.add('open'));
    document.getElementById('btn-close-help').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  /**
   * Ekrana kısa dokunma / tıklama yapıldığında Raycasting gerçekleştirir
   * @private
   */
  _handleCanvasTap(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // 1. Önce kapıya tıklandı mı diye kontrol et
    const doorMesh = this.door.getInteractiveMesh();
    const doorHit = this.raycaster.intersectObject(doorMesh, true);
    if (doorHit.length > 0) {
      this.door.toggle();
      this.showToast(this.door.isOpen ? 'Kapı açıldı.' : 'Kapı kapandı.');
      return;
    }

    // 2. Yürünebilir zemin yüzeylerini topla
    const walkableTargets = [
      this.groundShadowPlane,
      ...this.mapLoader.getWalkableObjects(),
    ];

    const intersects = this.raycaster.intersectObjects(walkableTargets, false);
    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      this.character.moveTo(hitPoint);
    }
  }

  /**
   * İstasyon listesi kartlarını monokrom HTML olarak oluşturur
   * @private
   */
  _renderStationsList(stations, activeId) {
    if (!this.stationGridEl) return;
    this.stationGridEl.innerHTML = '';

    if (stations.length === 0) {
      this.stationGridEl.innerHTML = `
        <div style="grid-column: 1 / -1; font-size: 10px; color: #888; font-family: monospace; text-align: center; padding: 10px;">
          Henüz kayıtlı istasyon yok.
        </div>
      `;
      return;
    }

    stations.forEach((st) => {
      const card = document.createElement('div');
      card.className = `station-item ${st.id === activeId ? 'active' : ''}`;

      card.innerHTML = `
        <div class="station-item-header">
          <span class="station-name">${st.name}</span>
          <span style="font-size: 9px; font-weight: 700; color: #fff;">${st.id === activeId ? '[AKTİF]' : ''}</span>
        </div>
        <div class="station-coords">
          X:${st.position.x.toFixed(1)} Y:${st.position.y.toFixed(1)} Z:${st.position.z.toFixed(1)}
        </div>
        <div class="station-actions">
          <button class="mini-btn btn-update">Yenile</button>
          <button class="mini-btn btn-del">Sil</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.cameraManager.transitionToStation(st);
      });

      card.querySelector('.btn-update').addEventListener('click', (e) => {
        e.stopPropagation();
        this.cameraManager.updateStation(st.id);
        this.showToast(`${st.name} güncellendi.`);
      });

      card.querySelector('.btn-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.cameraManager.removeStation(st.id);
        this.showToast('İstasyon silindi.');
      });

      this.stationGridEl.appendChild(card);
    });
  }

  // --- HUD Durum Güncellemeleri ---
  _updateDoorHUD(isOpen) {
    this.badgeDoorText.textContent = isOpen ? 'Kapı: Açık' : 'Kapı: Kapalı';
    this.badgeDoorEl.classList.toggle('outline', !isOpen);
    document.getElementById('btn-toggle-door').textContent = isOpen ? 'Kapıyı Kapat' : 'Kapıyı Aç';
  }

  _updateCharacterHUD(isMoving) {
    this.badgeCharText.textContent = isMoving ? 'Karakter: Yürüyor' : 'Karakter: Boşta';
    this.badgeCharEl.classList.toggle('outline', !isMoving);
  }

  _updateCameraHUD(state) {
    if (state.mode === 'locked') {
      this.badgeCamText.textContent = `[Kilitli] ${state.stationName}`;
    } else {
      this.badgeCamText.textContent = 'Serbest Orbit';
    }
    this._renderStationsList(state.stations, state.activeId);
  }

  _updateMapHUD(status) {
    if (status.type === 'loaded') {
      this.showToast(`Yüklendi: ${status.name}`);
      if (status.category === '2d') {
        document.getElementById('panel-image-options').style.display = 'flex';
      }
    } else if (status.type === 'error') {
      this.showToast(status.message);
    }
  }

  showToast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastEl._timer);
    this.toastEl._timer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2000);
  }

  /**
   * Ana Animasyon ve Render Döngüsü
   * @private
   */
  _animate() {
    requestAnimationFrame(() => this._animate());

    const delta = Math.min(0.1, this.clock.getDelta());

    // 1. Karakteri Güncelle
    this.character.update(delta);

    // 2. Kapı Menteşesini ve Kesit Duvarlarını Güncelle
    this.door.update(delta, this.character.getPosition());

    // 3. Kamera Yöneticisini Güncelle (Oda içi BoundingBox tetikleyicisi dahil)
    this.cameraManager.update(
      delta,
      this.character.getPosition(),
      this.door.getRoomBounds()
    );

    // 4. Sahneyi Çiz
    this.renderer.render(this.scene, this.camera);
  }
}

// Uygulamayı DOM hazır olduğunda başlat
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
