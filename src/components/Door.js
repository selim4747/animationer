/**
 * Door.js
 * Pivot noktası (menteşe) etrafında açılan kapı mekaniği ve
 * kapı arkasındaki iç mekanın dışarıdan görünmesini sağlayan şeffaf kesit (cutaway) mimarisi.
 * Timeline/Reji için async Promise (openDoorPromise, closeDoorPromise, toggleDoorPromise) desteği içerir.
 */

import * as THREE from 'three';

export class Door {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   * @param {CollisionManager} collisionManager - Çarpışma yöneticisi
   * @param {Function} onStateChange - Kapı durumu değişim bildirim işlevi
   */
  constructor(scene, collisionManager = null, onStateChange = () => {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onStateChange = onStateChange;

    this.isOpen = false;
    this.doorWidth = 1.3;
    this.doorHeight = 2.4;
    this.doorThickness = 0.08;

    // Açı Durumu (Radyan)
    this.currentAngle = 0;
    this.targetAngle = 0; // Kapalı: 0, Açık: -Math.PI / 2 (-90 derece)

    // Kesit Modu (Cutaway) Opaklık Durumu
    this.currentCutawayOpacity = 1.0;
    this.targetCutawayOpacity = 1.0;
    this.forceCutaway = false;

    // Promise Takibi
    this.doorTransitionResolve = null;

    // Ana Mimari Grubu
    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    // Menteşeli Kapı ve İç Mekan Yapısını İnşa Et
    this._buildRoomStructure();
    this._buildHingedDoor();

    // Kapı ve oda duvarlarını çarpışma sistemine bağla
    this._registerColliders();

    // İç Mekan BoundingBox (Karakter içeri girdiğinde Kamera Tetikleyicisi için)
    this.interiorBounds = new THREE.Box3(
      new THREE.Vector3(-4.0, 0, -11.5),
      new THREE.Vector3(4.0, 4.0, -4.2)
    );
  }

  setCollisionManager(collisionManager) {
    this.collisionManager = collisionManager;
    this._registerColliders();
  }

  /**
   * Oda duvarları ve kapalı kapıyı CollisionManager'a kaydeder
   * @private
   */
  _registerColliders() {
    if (!this.collisionManager) return;

    if (this.backWall) this.collisionManager.addCollider(this.backWall);
    if (this.leftWall) this.collisionManager.addCollider(this.leftWall);
    if (this.rightWall) this.collisionManager.addCollider(this.rightWall);
    if (this.frontLeftWall) this.collisionManager.addCollider(this.frontLeftWall);
    if (this.frontRightWall) this.collisionManager.addCollider(this.frontRightWall);

    if (this.desk) this.collisionManager.registerObstacle(this.desk);

    if (!this.isOpen && this.doorMesh) {
      this.collisionManager.addCollider(this.doorMesh);
    }
  }

  /**
   * Oda duvarları, zemini ve kesit (cutaway) ön duvarını oluşturur
   * @private
   */
  _buildRoomStructure() {
    // 1. Oda Tabanı
    const floorGeo = new THREE.BoxGeometry(8.2, 0.2, 8.2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x161616,
      roughness: 0.35,
      metalness: 0.05,
    });
    const roomFloor = new THREE.Mesh(floorGeo, floorMat);
    roomFloor.position.set(0, 0.1, -7.8);
    roomFloor.receiveShadow = true;
    this.roomGroup.add(roomFloor);

    // 2. Arka ve Yan Duvarlar (Opak Kalıcı Duvarlar)
    const solidWallMat = new THREE.MeshStandardMaterial({
      color: 0x1c1c1c,
      roughness: 0.7,
    });

    this.backWall = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.2, 0.3), solidWallMat);
    this.backWall.position.set(0, 1.7, -11.8);
    this.backWall.receiveShadow = true;
    this.roomGroup.add(this.backWall);

    this.leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 8.2), solidWallMat);
    this.leftWall.position.set(-4.0, 1.7, -7.8);
    this.leftWall.receiveShadow = true;
    this.roomGroup.add(this.leftWall);

    this.rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 8.2), solidWallMat);
    this.rightWall.position.set(4.0, 1.7, -7.8);
    this.rightWall.receiveShadow = true;
    this.roomGroup.add(this.rightWall);

    // 3. Ön Kesit Duvarları (Şeffaf / Cutaway Olabilen Duvarlar)
    this.cutawayMaterial = new THREE.MeshStandardMaterial({
      color: 0x282828,
      roughness: 0.6,
      transparent: true,
      opacity: 1.0,
      depthWrite: true,
    });

    const frontLeftGeo = new THREE.BoxGeometry(3.3, 3.2, 0.3);
    this.frontLeftWall = new THREE.Mesh(frontLeftGeo, this.cutawayMaterial);
    this.frontLeftWall.position.set(-2.35, 1.7, -3.8);
    this.frontLeftWall.receiveShadow = true;
    this.roomGroup.add(this.frontLeftWall);

    const frontRightGeo = new THREE.BoxGeometry(3.3, 3.2, 0.3);
    this.frontRightWall = new THREE.Mesh(frontRightGeo, this.cutawayMaterial);
    this.frontRightWall.position.set(2.35, 1.7, -3.8);
    this.frontRightWall.receiveShadow = true;
    this.roomGroup.add(this.frontRightWall);

    const lintelGeo = new THREE.BoxGeometry(1.6, 0.7, 0.3);
    this.frontLintel = new THREE.Mesh(lintelGeo, this.cutawayMaterial);
    this.frontLintel.position.set(0, 2.85, -3.8);
    this.roomGroup.add(this.frontLintel);

    // 4. İç Mekan Donatısı (Masa ve Ayrıntılar)
    const deskGeo = new THREE.BoxGeometry(2.4, 0.12, 1.2);
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2 });
    this.desk = new THREE.Mesh(deskGeo, deskMat);
    this.desk.position.set(0, 0.85, -8.5);
    this.desk.castShadow = true;
    this.desk.receiveShadow = true;
    this.roomGroup.add(this.desk);

    const legMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8 });
    [-1.0, 1.0].forEach((lx) => {
      [-0.45, 0.45].forEach((lz) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 16), legMat);
        leg.position.set(lx, 0.45, -8.5 + lz);
        leg.castShadow = true;
        this.roomGroup.add(leg);
      });
    });

    const roomLight = new THREE.PointLight(0xffffff, 1.4, 10);
    roomLight.position.set(0, 2.9, -7.8);
    roomLight.castShadow = true;
    this.roomGroup.add(roomLight);
  }

  /**
   * Pivot noktası (sol menteşe) etrafında açılan kapı panelini oluşturur
   * @private
   */
  _buildHingedDoor() {
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.3,
      metalness: 0.8,
    });

    const leftJamb = new THREE.Mesh(new THREE.BoxGeometry(0.08, this.doorHeight + 0.08, 0.34), frameMat);
    leftJamb.position.set(-this.doorWidth / 2 - 0.04, this.doorHeight / 2, -3.8);
    this.roomGroup.add(leftJamb);

    const rightJamb = new THREE.Mesh(new THREE.BoxGeometry(0.08, this.doorHeight + 0.08, 0.34), frameMat);
    rightJamb.position.set(this.doorWidth / 2 + 0.04, this.doorHeight / 2, -3.8);
    this.roomGroup.add(rightJamb);

    this.hingePivot = new THREE.Group();
    this.hingePivot.position.set(-this.doorWidth / 2, 0, -3.8);
    this.roomGroup.add(this.hingePivot);

    const doorGeo = new THREE.BoxGeometry(this.doorWidth, this.doorHeight, this.doorThickness);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xefefef,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.doorMesh = new THREE.Mesh(doorGeo, doorMat);
    this.doorMesh.position.set(this.doorWidth / 2, this.doorHeight / 2, 0);
    this.doorMesh.castShadow = true;
    this.doorMesh.receiveShadow = true;
    this.doorMesh.userData = { isDoorInteractive: true };
    this.hingePivot.add(this.doorMesh);

    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      metalness: 0.9,
      roughness: 0.1,
    });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.09), handleMat);
    handle.position.set(this.doorWidth - 0.15, 1.05, this.doorThickness / 2 + 0.04);
    handle.castShadow = true;
    this.hingePivot.add(handle);
  }

  /**
   * Kapıyı açar veya kapatır, CollisionManager üzerindeki kapı engelini günceller
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (!this.isOpen) {
      this.isOpen = true;
      this.targetAngle = -Math.PI / 2;

      if (this.collisionManager && this.doorMesh) {
        this.collisionManager.removeCollider(this.doorMesh);
      }

      this.onStateChange({ isOpen: true });
    }
  }

  close() {
    if (this.isOpen) {
      this.isOpen = false;
      this.targetAngle = 0;

      if (this.collisionManager && this.doorMesh) {
        this.collisionManager.addCollider(this.doorMesh);
      }

      this.onStateChange({ isOpen: false });
    }
  }

  /**
   * Timeline / Async için Promise döndüren Kapı Açma metodu
   * @returns {Promise<void>}
   */
  openDoorPromise() {
    this.open();
    return new Promise((resolve) => {
      this.doorTransitionResolve = resolve;
    });
  }

  /**
   * Timeline / Async için Promise döndüren Kapı Kapama metodu
   * @returns {Promise<void>}
   */
  closeDoorPromise() {
    this.close();
    return new Promise((resolve) => {
      this.doorTransitionResolve = resolve;
    });
  }

  /**
   * Timeline / Async için Promise döndüren Kapı Değiştirme metodu
   * @returns {Promise<void>}
   */
  toggleDoorPromise() {
    if (this.isOpen) {
      return this.closeDoorPromise();
    } else {
      return this.openDoorPromise();
    }
  }

  /**
   * Her karede kapının menteşe animasyonunu ve duvarların kesit şeffaflığını günceller
   * @param {number} delta - Geçen süre
   * @param {THREE.Vector3} characterPos - Karakterin güncel konumu
   */
  update(delta, characterPos) {
    const doorWorldCenter = new THREE.Vector3(0, 1.0, -3.8);
    const distToCharacter = characterPos ? characterPos.distanceTo(doorWorldCenter) : 999;
    const isCharacterNear = distToCharacter < 2.6;

    // Karakter kapıya çok yakınsa otomatik aç
    if (isCharacterNear && !this.isOpen) {
      this.open();
    }

    // Menteşe Açısı Yumuşak Geçiş (Lerp)
    this.currentAngle = THREE.MathUtils.lerp(this.currentAngle, this.targetAngle, delta * 6.0);
    this.hingePivot.rotation.y = this.currentAngle;

    // Promise tamamlama denetimi: Hedef açıya yaklaşıldığında resolve et
    if (this.doorTransitionResolve && Math.abs(this.currentAngle - this.targetAngle) < 0.05) {
      const res = this.doorTransitionResolve;
      this.doorTransitionResolve = null;
      res();
    }

    // Kesit Modu (Cutaway)
    const shouldCutaway = this.isOpen || isCharacterNear || this.forceCutaway;
    this.targetCutawayOpacity = shouldCutaway ? 0.18 : 1.0;

    this.currentCutawayOpacity = THREE.MathUtils.lerp(
      this.currentCutawayOpacity,
      this.targetCutawayOpacity,
      delta * 5.0
    );

    if (this.cutawayMaterial) {
      this.cutawayMaterial.opacity = this.currentCutawayOpacity;
      this.cutawayMaterial.depthWrite = this.currentCutawayOpacity > 0.5;
    }
  }

  getInteractiveMesh() {
    return this.doorMesh;
  }

  getRoomBounds() {
    return this.interiorBounds;
  }
}
