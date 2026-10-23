/**
 * main.js
 * Modüler Three.js WebGL & Capacitor mimarisini başlatan ana giriş noktası.
 * Çok katlı binalar için 2. kat platformu, 5 basamaklı merdiven, korkuluklar ve zemin mobilyasını entegre eder.
 */

import * as THREE from 'three';
import { CollisionManager } from './components/CollisionManager.js';
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

    this.testWalkableSurfaces = []; // Merdiven ve 2. kat yürünebilir yüzeyleri

    this._initScene();
    this._initLightingAndEnvironment();
    this._initComponents();
    this._initMultiStoryArchitecture(); // 2. Kat, 5 basamaklı merdiven ve korkuluklar
    this._initTestFurniture(); // Zemin kattaki masa & sandalye grubu
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
    this.camera.position.set(13, 11, 16);

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
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x111111, 1.0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.dirLight.position.set(16, 28, 14);
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

    this.gridHelper = new THREE.GridHelper(36, 36, 0x444444, 0x1a1a1a);
    this.gridHelper.position.y = -0.002;
    this.scene.add(this.gridHelper);

    // Zemin Gölge Düzlemi (Aynı zamanda zemin kat yürünebilir yüzeyidir)
    const shadowGeo = new THREE.PlaneGeometry(100, 100);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.groundShadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    this.groundShadowPlane.rotation.x = -Math.PI / 2;
    this.groundShadowPlane.position.y = -0.003;
    this.groundShadowPlane.receiveShadow = true;
    this.groundShadowPlane.name = 'ground_zero_plane';
    this.scene.add(this.groundShadowPlane);
  }

  /**
   * Modüler bileşenleri ilklendirir
   * @private
   */
  _initComponents() {
    // 1. Çarpışma ve Mekânsal Culling Yöneticisi
    this.collisionManager = new CollisionManager(this.scene);

    // Ana zemin düzlemini yürünebilir yüzey yap
    this.collisionManager.registerWalkableSurface(this.groundShadowPlane);

    // 2. Menteşeli Kapı & Kesit Mimarisi
    this.door = new Door(this.scene, this.collisionManager, (state) => {
      this._updateDoorHUD(state.isOpen);
    });

    // 3. Prosedürel Karakter (3D Navigasyon ve Floor Snapping)
    this.character = new Character(this.scene, this.collisionManager, (state) => {
      this._updateCharacterHUD(state.isMoving);
    });

    // 4. Kamera Yöneticisi & CCTV İstasyonları
    this.cameraManager = new CameraManager(
      this.camera,
      this.renderer.domElement,
      (state) => {
        this._updateCameraHUD(state);
      }
    );

    // 5. Harita / Model Yükleyici (Büyük harita culling ve kat desteği)
    this.mapLoader = new MapLoader(this.scene, this.collisionManager, (status) => {
      this._updateMapHUD(status);
    });
  }

  /**
   * Çok Katlı Test Sahnesi: 5 Basamaklı Merdiven, 2. Kat Platformu ve Korkuluklar
   * Kullanıcı kendi modelini yüklemeden de karakterin merdiven tırmanıp 2. katta
   * gezebildiğini anında görebilir.
   * @private
   */
  _initMultiStoryArchitecture() {
    const multiStoryGroup = new THREE.Group();
    multiStoryGroup.name = 'MultiStory_Architecture';

    const stepMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.4,
      metalness: 0.1,
    });
    const floor2Mat = new THREE.MeshStandardMaterial({
      color: 0x181818,
      roughness: 0.35,
      metalness: 0.1,
    });
    const railingMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.2,
      metalness: 0.8,
    });

    // --- 1. 5 BASAMAKLI MERDİVEN (Staircase) ---
    // Her basamak: genişlik: 1.8m, derinlik: 0.55m, yükseklik artışı: 0.35m
    const stepCount = 5;
    const stepWidth = 1.8;
    const stepDepth = 0.55;
    const stepHeight = 0.35;
    const startZ = 0.2;
    const startX = -5.0;

    for (let i = 0; i < stepCount; i++) {
      const currentH = (i + 1) * stepHeight;
      const stepGeo = new THREE.BoxGeometry(stepWidth, currentH, stepDepth);
      const stepMesh = new THREE.Mesh(stepGeo, stepMat);

      // Basamak konumu
      const posZ = startZ - i * stepDepth;
      const posY = currentH / 2;
      stepMesh.position.set(startX, posY, posZ);
      stepMesh.castShadow = true;
      stepMesh.receiveShadow = true;
      stepMesh.name = `Stairs_Step_${i + 1}`;

      // Merdiven kenar çizgisi (Monokrom beyaz hat)
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(stepGeo),
        new THREE.LineBasicMaterial({ color: 0x555555 })
      );
      stepMesh.add(edges);

      multiStoryGroup.add(stepMesh);

      // Yürünebilir Zemin olarak kaydet (Vertical Floor Snapping)
      this.collisionManager.registerWalkableSurface(stepMesh);
      this.testWalkableSurfaces.push(stepMesh);
    }

    // --- 2. 2. KAT PLATFORMU (Upper Floor Platform) ---
    // Yüksekliği son basamak hizasında: y = 1.75
    const platformW = 5.6;
    const platformD = 5.6;
    const platformThickness = 0.2;
    const platformY = stepCount * stepHeight; // 1.75m

    const floor2Geo = new THREE.BoxGeometry(platformW, platformThickness, platformD);
    const floor2Mesh = new THREE.Mesh(floor2Geo, floor2Mat);
    // Merdivenin bittiği yerin arkasına yerleştir
    const platformPosZ = startZ - stepCount * stepDepth - platformD / 2 + 0.1;
    floor2Mesh.position.set(startX - 1.2, platformY - platformThickness / 2, platformPosZ);
    floor2Mesh.castShadow = true;
    floor2Mesh.receiveShadow = true;
    floor2Mesh.name = 'Floor_2_Platform';

    const floor2Edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(floor2Geo),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    floor2Mesh.add(floor2Edges);

    multiStoryGroup.add(floor2Mesh);

    // 2. Kat döşemesini yürünebilir yüzey yap
    this.collisionManager.registerWalkableSurface(floor2Mesh);
    this.testWalkableSurfaces.push(floor2Mesh);

    // --- 3. 2. KAT GÜVENLİK KORKULUKLARI / DUVARLARI (Railings) ---
    // Karakterin 2. kattan boşluğa düşmesini engelleyen monokrom korkuluklar
    const railingH = 0.9;
    const railingThickness = 0.08;

    // Sol Korkuluk
    const railLeftGeo = new THREE.BoxGeometry(railingThickness, railingH, platformD);
    const railLeft = new THREE.Mesh(railLeftGeo, railingMat);
    railLeft.position.set(
      floor2Mesh.position.x - platformW / 2,
      platformY + railingH / 2,
      floor2Mesh.position.z
    );
    railLeft.castShadow = true;
    multiStoryGroup.add(railLeft);
    this.collisionManager.registerObstacle(railLeft);

    // Arka Korkuluk
    const railBackGeo = new THREE.BoxGeometry(platformW, railingH, railingThickness);
    const railBack = new THREE.Mesh(railBackGeo, railingMat);
    railBack.position.set(
      floor2Mesh.position.x,
      platformY + railingH / 2,
      floor2Mesh.position.z - platformD / 2
    );
    railBack.castShadow = true;
    multiStoryGroup.add(railBack);
    this.collisionManager.registerObstacle(railBack);

    // Sağ Korkuluk (Merdiven girişi hariç kısım)
    const railRightGeo = new THREE.BoxGeometry(railingThickness, railingH, platformD);
    const railRight = new THREE.Mesh(railRightGeo, railingMat);
    railRight.position.set(
      floor2Mesh.position.x + platformW / 2,
      platformY + railingH / 2,
      floor2Mesh.position.z
    );
    railRight.castShadow = true;
    multiStoryGroup.add(railRight);
    this.collisionManager.registerObstacle(railRight);

    // 2. Kat Tavan / Aydınlatma Spotu
    const upperLight = new THREE.PointLight(0xffffff, 1.2, 8);
    upperLight.position.set(floor2Mesh.position.x, platformY + 2.5, floor2Mesh.position.z);
    multiStoryGroup.add(upperLight);

    this.scene.add(multiStoryGroup);
  }

  /**
   * Zemin kattaki masa ve sandalye engel grubunu ekler
   * @private
   */
  _initTestFurniture() {
    this.testFurniture = new THREE.Group();
    this.testFurniture.name = 'Ground_Test_Table';

    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.35,
      metalness: 0.1,
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.2,
      metalness: 0.8,
    });

    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.3), tableMat);
    tableTop.position.set(0, 0.8, 0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    this.testFurniture.add(tableTop);

    [
      [-1.05, -0.5],
      [1.05, -0.5],
      [-1.05, 0.5],
      [1.05, 0.5],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.75, 16), legMat);
      leg.position.set(lx, 0.375, lz);
      leg.castShadow = true;
      leg.receiveShadow = true;
      this.testFurniture.add(leg);
    });

    // 2 Minimalist Sandalye
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.4 });
    [-0.95, 0.95].forEach((cz) => {
      const chair = new THREE.Group();
      chair.position.set(0, 0, cz);

      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.45), chairMat);
      seat.position.set(0, 0.45, 0);
      seat.castShadow = true;
      chair.add(seat);

      const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.05), chairMat);
      backrest.position.set(0, 0.66, cz > 0 ? 0.2 : -0.2);
      backrest.castShadow = true;
      chair.add(backrest);

      chair.castShadow = true;
      this.testFurniture.add(chair);
    });

    // Zemin katta sağ ön açık alana yerleştir
    this.testFurniture.position.set(2.5, 0, 3.2);
    this.scene.add(this.testFurniture);

    // Masayı engel olarak kaydet
    this.collisionManager.registerObstacle(this.testFurniture);
  }

  /**
   * HUD arayüz öğeleri ve durum etiketleri
   * @private
   */
  _initUI() {
    this.badgeCamText = document.getElementById('label-camera-mode');
    this.badgeCharText = document.getElementById('label-char-mode');
    this.badgeCharEl = document.getElementById('badge-char-mode');
    this.badgeDoorText = document.getElementById('label-door-mode');
    this.badgeDoorEl = document.getElementById('badge-door-mode');
    this.toastEl = document.getElementById('toast');

    this.stationGridEl = document.getElementById('station-cards-grid');
    this._renderStationsList(this.cameraManager.stations, null);
  }

  /**
   * Kullanıcı giriş olaylarını bağlar
   * @private
   */
  _bindEvents() {
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.pointerDownTime = performance.now();
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      const dist = Math.hypot(dx, dy);
      const elapsed = performance.now() - this.pointerDownTime;

      if (dist < 8 && elapsed < 400) {
        this._handleCanvasTap(e);
      }
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Dock Sekmeleri
    document.querySelectorAll('.dock-tab-btn').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dock-tab-btn').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.dock-tab-pane').forEach((p) => (p.style.display = 'none'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).style.display = 'block';
      });
    });

    // Dock Katlama (Collapse)
    const dock = document.getElementById('hud-dock');
    const dockTrigger = document.getElementById('btn-toggle-dock');
    const dockArrow = document.getElementById('dock-collapse-arrow');
    const dockLabel = document.getElementById('dock-collapse-label');
    dockTrigger.addEventListener('click', () => {
      const isCol = dock.classList.toggle('collapsed');
      dockArrow.textContent = isCol ? '▴' : '▾';
      dockLabel.textContent = isCol ? 'Panel [Aç]' : 'Panel [Gizle]';
    });

    // Kapı Butonları
    const handleDoorToggle = () => this.door.toggle();
    document.getElementById('btn-toggle-door').addEventListener('click', handleDoorToggle);
    document.getElementById('btn-toggle-door-panel').addEventListener('click', handleDoorToggle);

    // Karakter Takip Toggle
    const btnFollow = document.getElementById('btn-toggle-follow');
    btnFollow.addEventListener('click', () => {
      const current = this.cameraManager.followCharacter;
      this.cameraManager.setFollow(!current);
      btnFollow.classList.toggle('primary', !current);
      btnFollow.textContent = `◉ Karakteri Takip Et: [${!current ? 'AÇIK' : 'KAPALI'}]`;
      this.showToast(`Kamera takibi: ${!current ? 'Açık' : 'Kapalı'}`);
    });

    // Karakter Hızı
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

    // Karakteri Sıfırla
    document.getElementById('btn-reset-character').addEventListener('click', () => {
      this.character.resetPosition(0, 0, 0);
      this.showToast('Karakter (0, 0, 0) noktasına sıfırlandı.');
    });

    // Kamera İstasyon Butonları
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

    // Dosya Yükleme & Sürükle-Bırak
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

    // 2D Yönelim & Kaydırıcılar
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

    document.getElementById('btn-focus-map').addEventListener('click', () => {
      this.camera.position.set(13, 11, 16);
      this.cameraManager.controls.target.set(0, 1.2, 0);
      this.showToast('Harita merkezine odaklanıldı.');
    });
    document.getElementById('btn-clear-map').addEventListener('click', () => {
      this.mapLoader.clear();
      document.getElementById('panel-image-options').style.display = 'none';
      this.showToast('Yüklü harita kaldırıldı.');
    });

    document.getElementById('btn-add-wall-box').addEventListener('click', () => {
      const charPos = this.character.getPosition();
      this.mapLoader.createWallBox(charPos.x + 1.2, charPos.z + 1.2, 2.0, 0.8, 1.2);
      this.showToast('Tel kafes engel kutusu eklendi.');
    });

    document.getElementById('btn-clear-wall-boxes').addEventListener('click', () => {
      this.mapLoader.clearAllWallBoxes();
      this.showToast('Tüm engel kutuları temizlendi.');
    });

    document.getElementById('btn-load-floorplan').addEventListener('click', () => {
      this.mapLoader.loadDemoFloorPlan();
      document.getElementById('panel-image-options').style.display = 'flex';
      this.showToast('2D Kat Planı ve engeller yüklendi.');
    });
    document.getElementById('btn-load-gallery').addEventListener('click', () => {
      this.mapLoader.loadDemo3DGallery();
      document.getElementById('panel-image-options').style.display = 'none';
      this.showToast('3D Galeri sergisi yüklendi.');
    });

    const btnCutaway = document.getElementById('btn-force-cutaway');
    const labelCutaway = document.getElementById('label-cutaway-mode');
    btnCutaway.addEventListener('click', () => {
      this.door.forceCutaway = !this.door.forceCutaway;
      labelCutaway.textContent = this.door.forceCutaway ? 'Sürekli Açık (Şeffaf)' : 'Otomatik (Yakınlıkta)';
      btnCutaway.classList.toggle('primary', this.door.forceCutaway);
      this.showToast(`Kesit Modu: ${labelCutaway.textContent}`);
    });

    const modal = document.getElementById('modal-help');
    document.getElementById('btn-open-help').addEventListener('click', () => modal.classList.add('open'));
    document.getElementById('btn-close-help').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  /**
   * Ekrana kısa dokunma / tıklama yapıldığında 3D Raycasting gerçekleştirir.
   * Merdiven basamakları, 2. kat platformu ve zemin kat dahil tüm yürünebilir
   * yüzeylerin tam 3D koordinatını alır.
   * @private
   */
  _handleCanvasTap(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // 1. Önce kapı tıklamasını kontrol et
    const doorMesh = this.door.getInteractiveMesh();
    const doorHit = this.raycaster.intersectObject(doorMesh, true);
    if (doorHit.length > 0) {
      this.door.toggle();
      this.showToast(this.door.isOpen ? 'Kapı açıldı (Geçiş serbest).' : 'Kapı kapandı (Engel aktif).');
      return;
    }

    // 2. Çok katlı yürünebilir yüzeyleri topla (Zemin kat, merdiven basamakları, 2. kat platformu, yüklenen model)
    const walkableTargets = [
      this.groundShadowPlane,
      ...this.testWalkableSurfaces,
      ...this.mapLoader.getWalkableObjects(),
    ];

    const intersects = this.raycaster.intersectObjects(walkableTargets, false);
    if (intersects.length > 0) {
      // En yakın yürünebilir yüzeyin tam 3D koordinatını al
      const hitPoint = intersects[0].point;
      this.character.moveTo(hitPoint);
    }
  }

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
      this.showToast(`Yüklendi: ${status.name} (${status.walkableCount || 0} kat/basamak, ${status.obstacleCount || 0} engel)`);
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

    // 1. Karakteri Güncelle (3D Çok Katlı Navigasyon, Merdiven Tırmanış ve Floor Snapping)
    this.character.update(delta);

    // 2. Kapı Menteşesini ve Kesit Duvarlarını Güncelle
    this.door.update(delta, this.character.getPosition());

    // 3. Kamera Yöneticisini Güncelle
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
