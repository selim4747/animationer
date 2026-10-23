/**
 * Door.js
 * Pivot noktası (menteşe) etrafında açılan kapı mekaniği ve
 * kapı arkasındaki iç mekanın dışarıdan görünmesini sağlayan şeffaf kesit (cutaway) mimarisi.
 */

import * as THREE from 'three';

export class Door {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   * @param {Function} onStateChange - Kapı durumu değişim bildirim işlevi
   */
  constructor(scene, onStateChange = () => {}) {
    this.scene = scene;
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

    // Ana Mimari Grubu
    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    // Menteşeli Kapı ve İç Mekan Yapısını İnşa Et
    this._buildRoomStructure();
    this._buildHingedDoor();

    // İç Mekan BoundingBox (Karakter içeri girdiğinde Kamera Tetikleyicisi için)
    this.interiorBounds = new THREE.Box3(
      new THREE.Vector3(-4.0, 0, -11.5),
      new THREE.Vector3(4.0, 4.0, -4.2)
    );
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

    // Arka Duvar
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.2, 0.3), solidWallMat);
    backWall.position.set(0, 1.7, -11.8);
    backWall.receiveShadow = true;
    this.roomGroup.add(backWall);

    // Sol Duvar
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 8.2), solidWallMat);
    leftWall.position.set(-4.0, 1.7, -7.8);
    leftWall.receiveShadow = true;
    this.roomGroup.add(leftWall);

    // Sağ Duvar
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 8.2), solidWallMat);
    rightWall.position.set(4.0, 1.7, -7.8);
    rightWall.receiveShadow = true;
    this.roomGroup.add(rightWall);

    // 3. Ön Kesit Duvarları (Şeffaf / Cutaway Olabilen Duvarlar)
    this.cutawayMaterial = new THREE.MeshStandardMaterial({
      color: 0x282828,
      roughness: 0.6,
      transparent: true,
      opacity: 1.0,
      depthWrite: true,
    });

    // Kapının Solundaki Ön Duvar Parçası
    const frontLeftGeo = new THREE.BoxGeometry(3.3, 3.2, 0.3);
    this.frontLeftWall = new THREE.Mesh(frontLeftGeo, this.cutawayMaterial);
    this.frontLeftWall.position.set(-2.35, 1.7, -3.8);
    this.frontLeftWall.receiveShadow = true;
    this.roomGroup.add(this.frontLeftWall);

    // Kapının Sağındaki Ön Duvar Parçası
    const frontRightGeo = new THREE.BoxGeometry(3.3, 3.2, 0.3);
    this.frontRightWall = new THREE.Mesh(frontRightGeo, this.cutawayMaterial);
    this.frontRightWall.position.set(2.35, 1.7, -3.8);
    this.frontRightWall.receiveShadow = true;
    this.roomGroup.add(this.frontRightWall);

    // Kapı Üstü Kiriş Parçası
    const lintelGeo = new THREE.BoxGeometry(1.6, 0.7, 0.3);
    this.frontLintel = new THREE.Mesh(lintelGeo, this.cutawayMaterial);
    this.frontLintel.position.set(0, 2.85, -3.8);
    this.roomGroup.add(this.frontLintel);

    // 4. İç Mekan Donatısı (Kesit modunda içeride görünen çalışma masası ve aydınlatma)
    const deskGeo = new THREE.BoxGeometry(2.4, 0.12, 1.2);
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2 });
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.set(0, 0.85, -8.5);
    desk.castShadow = true;
    desk.receiveShadow = true;
    this.roomGroup.add(desk);

    // Masa Ayakları
    const legMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8 });
    [-1.0, 1.0].forEach((lx) => {
      [-0.45, 0.45].forEach((lz) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 16), legMat);
        leg.position.set(lx, 0.45, -8.5 + lz);
        leg.castShadow = true;
        this.roomGroup.add(leg);
      });
    });

    // İç Mekan Tavan Aydınlatması (Hafif monokrom spot)
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
    // Kapı Kasası (Siyah metal profil)
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

    // Menteşe Pivot Grubu (Sol kenarda x = -doorWidth/2, z = -3.8)
    this.hingePivot = new THREE.Group();
    this.hingePivot.position.set(-this.doorWidth / 2, 0, -3.8);
    this.roomGroup.add(this.hingePivot);

    // Kapı Kanadı Mesh'i:
    // Menteşe etrafında doğal dönüş için geometrinin sol kenarını pivot merkezine sıfırlıyoruz:
    // x konumu = +doorWidth / 2
    const doorGeo = new THREE.BoxGeometry(this.doorWidth, this.doorHeight, this.doorThickness);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xefefef, // Minimalist beyaz kapı yüzeyi
      roughness: 0.25,
      metalness: 0.1,
    });
    this.doorMesh = new THREE.Mesh(doorGeo, doorMat);
    this.doorMesh.position.set(this.doorWidth / 2, this.doorHeight / 2, 0);
    this.doorMesh.castShadow = true;
    this.doorMesh.receiveShadow = true;
    this.doorMesh.userData = { isDoorInteractive: true };
    this.hingePivot.add(this.doorMesh);

    // Minimalist Krom Kapı Kolu
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
   * Kapıyı açar veya kapatır
   */
  toggle() {
    this.isOpen = !this.isOpen;
    this.targetAngle = this.isOpen ? -Math.PI / 2 : 0;
    this.onStateChange({ isOpen: this.isOpen });
  }

  open() {
    if (!this.isOpen) {
      this.isOpen = true;
      this.targetAngle = -Math.PI / 2;
      this.onStateChange({ isOpen: true });
    }
  }

  close() {
    if (this.isOpen) {
      this.isOpen = false;
      this.targetAngle = 0;
      this.onStateChange({ isOpen: false });
    }
  }

  /**
   * Her karede kapının menteşe animasyonunu ve duvarların kesit şeffaflığını günceller
   * @param {number} delta - Geçen süre
   * @param {THREE.Vector3} characterPos - Karakterin güncel konumu
   */
  update(delta, characterPos) {
    // 1. Karakter Kapıya Yaklaştı mı? (2.6 metre mesafe kontrolü)
    const doorWorldCenter = new THREE.Vector3(0, 1.0, -3.8);
    const distToCharacter = characterPos ? characterPos.distanceTo(doorWorldCenter) : 999;
    const isCharacterNear = distToCharacter < 2.6;

    // Karakter kapıya çok yakınsa otomatik aç
    if (isCharacterNear && !this.isOpen) {
      this.open();
    }

    // 2. Menteşe Açısı Yumuşak Geçiş (Lerp)
    this.currentAngle = THREE.MathUtils.lerp(this.currentAngle, this.targetAngle, delta * 6.0);
    this.hingePivot.rotation.y = this.currentAngle;

    // 3. Kesit Modu (Cutaway) Mantığı:
    // Kapı açıksa veya karakter kapıya/içeriye yakınsa ön duvarlar şeffaflaşarak iç mekan görünür hale gelir.
    const shouldCutaway = this.isOpen || isCharacterNear || this.forceCutaway;
    this.targetCutawayOpacity = shouldCutaway ? 0.18 : 1.0;

    this.currentCutawayOpacity = THREE.MathUtils.lerp(
      this.currentCutawayOpacity,
      this.targetCutawayOpacity,
      delta * 5.0
    );

    if (this.cutawayMaterial) {
      this.cutawayMaterial.opacity = this.currentCutawayOpacity;
      // Çok şeffafken arka nesnelerin düzgün görünmesi için depthWrite'ı ayarla
      this.cutawayMaterial.depthWrite = this.currentCutawayOpacity > 0.5;
    }
  }

  /**
   * Tıklama / dokunma raycasting tespiti için kapı mesh'ini döndürür
   */
  getInteractiveMesh() {
    return this.doorMesh;
  }

  /**
   * Oda iç mekan BoundingBox'ını döndürür (Kamera geçiş tetikleyicisi için)
   * @returns {THREE.Box3}
   */
  getRoomBounds() {
    return this.interiorBounds;
  }
}
