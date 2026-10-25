/**
 * MapLoader.js
 * 3D (.glb, .gltf) ve 2D (.png, .jpg, .webp) harita/zemin yükleyici sınıfı.
 * Çok katlı binalarda zemin, basamak, rampa ve 2. kat döşemelerini otomatik olarak
 * Walkable Surfaces (Yürünebilir Zeminler) havuzuna ekler.
 * Devasa haritalarda mobil 60 FPS için Three.js frustumCulled ve boundingSphere optimizasyonunu sağlar.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateTextureDimensions } from '../utils/device-profile.js';
import { getDeviceMemoryGiB, getDevicePerformanceProfile } from '../utils/device-profile.js';

const MAX_MAP_IMAGE_BYTES = 50 * 1024 * 1024;

export class MapLoader {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   * @param {CollisionManager} collisionManager - Çarpışma yöneticisi
   * @param {Function} onStatusChange - Bildirim geri çağırma işlevi
   */
  constructor(scene, collisionManager = null, onStatusChange = () => {}, onStateChange = () => {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onStatusChange = onStatusChange;
    this.onStateChange = onStateChange;

    this.currentLoadedObject = null;
    this.currentObjectType = 'none'; // '3d' | '2d' | 'none'
    this.currentTexture = null;
    this.currentPlane = null;
    this.currentSourceFile = null;
    this.currentFileName = null;
    this.stateRevision = 0;

    // Bu modelle yüklenen nesnelerin takibi
    this.registeredObstacles = [];
    this.registeredWalkableSurfaces = [];

    this.imageAspectRatio = 1.0;
    this.isGroundOrientation = true;
    this.baseWidth = 16.0;
    this.currentScale = 16.0;
    this.currentOpacity = 1.0;

    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
  }

  setCollisionManager(collisionManager) {
    this.collisionManager = collisionManager;
  }

  /**
   * Sahnede var olan haritayı/modeli, mobilya engellerini ve yürünebilir yüzeyleri temizler
   */
  clear({ notify = true } = {}) {
    if (this.collisionManager) {
      if (this.registeredObstacles.length > 0) {
        this.registeredObstacles.forEach((obj) => this.collisionManager.unregisterObstacle(obj));
        this.registeredObstacles = [];
      }
      if (this.registeredWalkableSurfaces.length > 0) {
        this.registeredWalkableSurfaces.forEach((surf) => this.collisionManager.unregisterWalkableSurface(surf));
        this.registeredWalkableSurfaces = [];
      }
    }

    const disposedTextures = new Set();
    if (this.currentLoadedObject) {
      this.scene.remove(this.currentLoadedObject);
      this.currentLoadedObject.traverse((node) => {
        if (node.isMesh) {
          node.geometry?.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) {
              if (value?.isTexture && !disposedTextures.has(value)) {
                value.dispose();
                disposedTextures.add(value);
              }
            }
            material.dispose();
          }
        }
      });
      this.currentLoadedObject = null;
    }

    if (this.currentTexture) {
      if (!disposedTextures.has(this.currentTexture)) this.currentTexture.dispose();
      this.currentTexture = null;
    }

    this.currentPlane = null;
    this.currentSourceFile = null;
    this.currentFileName = null;
    this.currentObjectType = 'none';
    this.stateRevision++;
    this.onStatusChange({ type: 'cleared', name: null });
    if (notify) this.onStateChange({ type: 'map-cleared' });
  }

  /**
   * 3D GLB veya GLTF dosyasını yükler.
   * Merdiven, rampa ve kat döşemelerini Yürünebilir Zemin (Walkable),
   * geri kalan her şeyi (duvar, masa, korkuluk vb.) Engel olarak kaydeder.
   * Devasa sahneler için Frustum Culling optimizasyonunu zorunlu kılar.
   *
   * @param {string} url - Dosya ObjectURL veya bağlantısı
   * @param {string} fileName - Dosya adı
   */
  loadGLTF(url, fileName = 'Model.glb') {
    this.clear();
    this.onStatusChange({ type: 'loading', name: fileName });

    this.gltfLoader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        const model = gltf.scene;
        this.currentLoadedObject = model;
        this.currentObjectType = '3d';

        // BoundingBox hesapla: X ve Z ekseninde ortala, tabanı Y = 0 zeminine oturt
        const modelBox = new THREE.Box3().setFromObject(model);
        const center = modelBox.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= modelBox.min.y;

        model.updateMatrixWorld(true);

        // Yürünebilir zemin & merdiven regex tanımı
        const walkableRegex = /stairs|merdiven|step|basamak|floor|zemin|ground|walkable|ramp|rampa|platform|kat|deck/i;

        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;

            // BÜYÜK HARİTA PERFORMANS OPTİMİZASYONU:
            // Kamera görüş alanı dışında kalan parçaların CPU/GPU yükü oluşturmaması için Frustum Culling aktif edilir
            node.frustumCulled = true;
            if (node.geometry) {
              node.geometry.computeBoundingBox();
              node.geometry.computeBoundingSphere();
            }

            const name = node.name || '';
            const isExplicitWalkable = walkableRegex.test(name);

            // Geometrik eğim ve yükseklik analizi
            const meshBox = new THREE.Box3().setFromObject(node);
            const sizeX = meshBox.max.x - meshBox.min.x;
            const sizeZ = meshBox.max.z - meshBox.min.z;
            const sizeY = meshBox.max.y - meshBox.min.y;

            // Geniş ve yatay yüzeyler (katlar/döşemeler) veya adı merdiven/zemin olanlar
            const isHorizontalSurface = sizeY < 0.35 && (sizeX > 0.8 || sizeZ > 0.8);

            if (isExplicitWalkable || isHorizontalSurface) {
              // Yürünebilir Zemin veya Merdiven Basamağı olarak kaydet
              if (this.collisionManager) {
                this.collisionManager.registerWalkableSurface(node);
                this.registeredWalkableSurfaces.push(node);
              }
            } else {
              // Mobilya, korkuluk veya duvar engeli olarak kaydet
              if (this.collisionManager) {
                this.collisionManager.registerObstacle(node);
                this.registeredObstacles.push(node);
              }
            }
          }
        });

        this.scene.add(model);
        this.onStatusChange({
          type: 'loaded',
          category: '3d',
          name: fileName,
          object: model,
          box: new THREE.Box3().setFromObject(model),
          walkableCount: this.registeredWalkableSurfaces.length,
          obstacleCount: this.registeredObstacles.length,
        });
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        console.error('GLTF Yükleme Hatası:', error);
        this.onStatusChange({ type: 'error', message: '3D Model yüklenemedi!' });
      }
    );
  }

  /**
   * 2D Görseli (PNG, JPG, WEBP) yükler ve orijinal en-boy oranıyla PlaneGeometry oluşturur
   * @param {string} url - Görsel ObjectURL veya bağlantısı
   * @param {string} fileName - Dosya adı
   */
  async loadImage(url, fileName = 'Gorsel.png', sourceFile = null) {
    this.onStatusChange({ type: 'loading', name: fileName });
    let texture;
    try {
      texture = await this.textureLoader.loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      const width = texture.image?.naturalWidth || texture.image?.width || 0;
      const height = texture.image?.naturalHeight || texture.image?.height || 0;
      validateTextureDimensions(width, height);
      const aspect = width / height;
      const geometry = new THREE.PlaneGeometry(this.currentScale, this.currentScale / aspect);
      const material = new THREE.MeshStandardMaterial({
        map: texture, transparent: true, alphaTest: 0.1, depthWrite: true,
        side: THREE.DoubleSide, roughness: 0.5, metalness: 0.05, opacity: this.currentOpacity,
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.receiveShadow = true;
      plane.castShadow = false;
      plane.name = 'floor_plane_2d';
      plane.frustumCulled = true;

      // Keep the prior environment visible unless the replacement has decoded and validated.
      this.clear({ notify: false });
      this.currentTexture = texture;
      this.currentObjectType = '2d';
      this.currentSourceFile = sourceFile ? sourceFile.slice(0, sourceFile.size, sourceFile.type) : null;
      this.currentFileName = fileName;
      this.imageAspectRatio = aspect;
      this.currentPlane = plane;
      this.currentLoadedObject = plane;
      this.scene.add(plane);
      if (this.collisionManager) {
        this.collisionManager.registerWalkableSurface(plane);
        this.registeredWalkableSurfaces.push(plane);
      }
      this.setOrientation(this.isGroundOrientation);
      this.onStatusChange({ type: 'loaded', category: '2d', name: fileName, object: plane, aspectRatio: aspect });
      this.onStateChange({ type: 'map-loaded' });
      return plane;
    } catch (error) {
      texture?.dispose();
      this.onStatusChange({ type: 'error', message: error.message || 'Görsel yüklenemedi!' });
      throw error;
    }
  }

  exportStateForStorage() {
    if (this.currentObjectType !== '2d' || !this.currentSourceFile) return null;
    return {
      kind: 'image',
      fileName: this.currentFileName || this.currentSourceFile.name || 'environment.png',
      mimeType: this.currentSourceFile.type,
      blob: this.currentSourceFile.slice(0, this.currentSourceFile.size, this.currentSourceFile.type),
      scale: this.currentScale,
      opacity: this.currentOpacity,
      groundOrientation: this.isGroundOrientation,
    };
  }

  async restoreProjectState(mapAsset) {
    if (!mapAsset) { this.clear(); return null; }
    if (!(mapAsset.blob instanceof Blob)) throw new Error('Kayıtlı 2D ortam görseli okunamıyor.');
    const url = URL.createObjectURL(mapAsset.blob);
    try {
      await this.loadImage(url, mapAsset.fileName, mapAsset.blob);
      this.setScale(mapAsset.scale);
      this.setOpacity(mapAsset.opacity);
      this.setOrientation(mapAsset.groundOrientation);
      return true;
    } finally { URL.revokeObjectURL(url); }
  }

  setOrientation(isGround) {
    if (!this.currentPlane) return;
    this.isGroundOrientation = isGround;

    const width = this.currentScale;
    const height = this.currentScale / this.imageAspectRatio;

    this.currentPlane.geometry.dispose();
    this.currentPlane.geometry = new THREE.PlaneGeometry(width, height);

    if (isGround) {
      this.currentPlane.rotation.x = -Math.PI / 2;
      this.currentPlane.rotation.y = 0;
      this.currentPlane.rotation.z = 0;
      this.currentPlane.position.set(0, 0.012, 0);
    } else {
      this.currentPlane.rotation.x = 0;
      this.currentPlane.rotation.y = 0;
      this.currentPlane.rotation.z = 0;
      this.currentPlane.position.set(0, height / 2, 0);
    }
    this.stateRevision++;
    this.onStateChange({ type: 'map-settings-changed' });
  }

  setScale(scale) {
    if (!Number.isFinite(Number(scale)) || Number(scale) <= 0) return;
    this.currentScale = Number(scale);
    if (this.currentPlane) {
      this.setOrientation(this.isGroundOrientation);
    }
  }

  setImageSize(scale) {
    this.setScale(scale);
  }

  setOpacity(opacity) {
    if (!Number.isFinite(Number(opacity))) return;
    this.currentOpacity = Math.max(0, Math.min(1, Number(opacity)));
    if (this.currentPlane && this.currentPlane.material) {
      this.currentPlane.material.opacity = this.currentOpacity;
      this.currentPlane.material.transparent = this.currentOpacity < 1.0 || true;
    }
    this.stateRevision++;
    this.onStateChange({ type: 'map-settings-changed' });
  }

  setImageOpacity(opacity) {
    this.setOpacity(opacity);
  }

  setImageOrientation(mode) {
    const isGround = mode === 'horizontal';
    this.setOrientation(isGround);
  }

  async handleFile(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isImage = /\.(png|jpe?g|webp)$/i.test(name);
    if (isImage && (!file.size || file.size > Math.min(MAX_MAP_IMAGE_BYTES, getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes))) {
      const limit = Math.floor(Math.min(MAX_MAP_IMAGE_BYTES, getDevicePerformanceProfile(getDeviceMemoryGiB()).maxProjectAssetExportBytes) / (1024 * 1024));
      throw new Error(`2D ortam görseli bu cihazda en fazla ${limit} MiB olabilir.`);
    }
    const url = URL.createObjectURL(file);

    if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      this.loadGLTF(url, file.name);
      return true;
    } else if (
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.webp')
    ) {
      try { return await this.loadImage(url, file.name, file); }
      finally { URL.revokeObjectURL(url); }
    } else {
      URL.revokeObjectURL(url);
      this.onStatusChange({
        type: 'error',
        message: 'Desteklenmeyen dosya türü! (.glb, .gltf, .png, .jpg, .webp)',
      });
      throw new Error('Desteklenmeyen dosya türü! (.glb, .gltf, .png, .jpg, .webp)');
    }
  }

  loadFile(file) {
    return this.handleFile(file);
  }

  /**
   * Kamerayı yüklenmiş olan haritaya veya modele odaklar
   * @param {THREE.PerspectiveCamera} camera
   * @returns {THREE.Vector3}
   */
  focusCameraOnMap(camera) {
    let target = new THREE.Vector3(0, 0.5, 0);
    if (this.currentLoadedObject) {
      const box = new THREE.Box3().setFromObject(this.currentLoadedObject);
      target = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 8);
      if (camera) {
        camera.position.set(
          target.x + maxDim * 0.85,
          target.y + maxDim * 0.85,
          target.z + maxDim * 1.05
        );
        camera.lookAt(target);
      }
    } else if (camera) {
      camera.position.set(13, 11, 16);
      camera.lookAt(target);
    }
    return target;
  }

  /**
   * 2D Harita editörü için monokrom tel kafes mobilya/duvar engel kutusu ekler
   */
  createWallBox(x = 0, z = 0, w = 2.0, d = 1.0, h = 1.2) {
    if (!this.collisionManager) return null;
    const box = this.collisionManager.addWallBox(x, z, w, d, h);
    this.onStatusChange({
      type: 'wallBoxAdded',
      box,
      count: this.collisionManager.wallBoxes.length,
    });
    return box;
  }

  addWallBox(x = 0, z = 0, w = 2.0, d = 1.0, h = 1.2) {
    return this.createWallBox(x, z, w, d, h);
  }

  removeWallBox(box) {
    if (!this.collisionManager?.wallBoxes?.includes(box)) return false;
    this.collisionManager.removeWallBox(box);
    this.onStatusChange({ type: 'wallBoxRemoved', count: this.collisionManager.wallBoxes.length });
    return true;
  }

  clearAllWallBoxes() {
    if (this.collisionManager) {
      this.collisionManager.clearWallBoxes();
      this.onStatusChange({ type: 'wallBoxesCleared' });
    }
  }

  clearWallBoxes() {
    this.clearAllWallBoxes();
  }

  loadProceduralFloorPlan() {
    return this.loadDemoFloorPlan();
  }

  loadProceduralGallery() {
    return this.loadDemo3DGallery();
  }

  /**
   * 2D Kat planı demosunu yükler ve mobilya/oda bölgelerine otomatik engel kutuları kurar
   */
  loadDemoFloorPlan() {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const rooms = [
      { name: 'KORİDOR / GİRİŞ', x: 80, y: 80, w: 420, h: 480 },
      { name: 'ANA SALON', x: 520, y: 80, w: 1000, h: 480 },
      { name: 'OFİS', x: 80, y: 580, w: 580, h: 340 },
      { name: 'TOPLANTI ODASI', x: 680, y: 580, w: 840, h: 340 },
    ];

    rooms.forEach((r) => {
      ctx.fillStyle = '#181818';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(r.name, r.x + 20, r.y + 40);

      ctx.fillStyle = '#888888';
      ctx.font = '13px monospace';
      ctx.fillText(`${(r.w / 100).toFixed(1)}m × ${(r.h / 100).toFixed(1)}m`, r.x + 20, r.y + 66);
    });

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.strokeRect(80, 80, 1440, 840);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      this.loadImage(url, 'Demo_Kat_Plani.png', new File([blob], 'Demo_Kat_Plani.png', { type: 'image/png' }))
        .finally(() => URL.revokeObjectURL(url));

      if (this.collisionManager) {
        this.clearAllWallBoxes();
        this.createWallBox(0, 4.8, 16.0, 0.4, 2.5);
        this.createWallBox(0, -4.8, 16.0, 0.4, 2.5);
        this.createWallBox(-7.8, 0, 0.4, 10.0, 2.5);
        this.createWallBox(7.8, 0, 0.4, 10.0, 2.5);
        this.createWallBox(-2.5, 0.5, 0.4, 4.5, 2.5);
        this.createWallBox(2.5, 0.5, 0.4, 4.5, 2.5);
        this.createWallBox(2.0, -2.0, 2.6, 1.4, 1.0);
      }
    });
  }

  /**
   * Monokrom 3D Galeri sergisini oluşturur ve yürünebilir zeminler ile engelleri bağlar
   */
  loadDemo3DGallery() {
    this.clear();
    const group = new THREE.Group();

    // Zemin Kat
    const floorGeo = new THREE.BoxGeometry(22, 0.4, 18);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.4 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0.2;
    floor.receiveShadow = true;
    floor.name = 'floor_walkable_main';
    group.add(floor);

    // Arka Duvar (Engel)
    const wallGeo = new THREE.BoxGeometry(22, 7, 0.5);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 3.7, -8.7);
    wall.receiveShadow = true;
    wall.name = 'wall_back';
    group.add(wall);

    // Yan Duvar (Engel)
    const sideWallGeo = new THREE.BoxGeometry(0.5, 7, 18);
    const sideWall = new THREE.Mesh(sideWallGeo, wallMat);
    sideWall.position.set(-10.7, 3.7, 0);
    sideWall.receiveShadow = true;
    sideWall.name = 'wall_side';
    group.add(sideWall);

    // Kaide ve Heykel (Mobilya / Kütle Engeli)
    const pedGeo = new THREE.CylinderGeometry(1.6, 2.0, 1.2, 32);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 });
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.set(0, 1.0, 0);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    pedestal.name = 'pedestal_obstacle';
    group.add(pedestal);

    const knotGeo = new THREE.TorusKnotGeometry(0.9, 0.28, 128, 32);
    const knotMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.95,
    });
    const knot = new THREE.Mesh(knotGeo, knotMat);
    knot.position.set(0, 2.7, 0);
    knot.castShadow = true;
    group.add(knot);

    // CollisionManager'a zemin ve engelleri kaydet
    if (this.collisionManager) {
      this.collisionManager.registerWalkableSurface(floor);
      this.registeredWalkableSurfaces.push(floor);

      this.collisionManager.registerObstacle(wall);
      this.collisionManager.registerObstacle(sideWall);
      this.collisionManager.registerObstacle(pedestal);
      this.registeredObstacles.push(wall, sideWall, pedestal);
    }

    this.currentLoadedObject = group;
    this.currentObjectType = '3d';
    this.scene.add(group);

    this.onStatusChange({
      type: 'loaded',
      category: '3d',
      name: '3D Galeri (Örnek)',
      object: group,
      box: new THREE.Box3().setFromObject(group),
      walkableCount: 1,
      obstacleCount: this.registeredObstacles.length,
    });
  }

  getWalkableObjects() {
    return [...this.registeredWalkableSurfaces];
  }
}
