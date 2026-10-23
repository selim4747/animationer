/**
 * Character.js
 * Çok katlı binalar ve merdivenler için 3 Boyutlu Navigasyon ve Prosedürel Animasyon Karakteri.
 * Merdiven tırmanırken dikey zemin yüksekliğini (Floor Snapping) algılar,
 * prosedürel bobbing ve wobble sallantısını merdiven yüksekliği üzerine bindirir.
 */

import * as THREE from 'three';

export class Character {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   * @param {CollisionManager} collisionManager - Çarpışma yöneticisi referansı
   * @param {Function} onStateChange - Durum değişim bildirim işlevi
   */
  constructor(scene, collisionManager = null, onStateChange = () => {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onStateChange = onStateChange;

    // Karakter silindir boyutları
    this.collisionRadius = 0.35; // Metre
    this.characterHeight = 1.6;  // Metre

    // Ana pozisyon grubu (Dünya koordinatları X, Y, Z ve Y-ekseni yönü)
    this.rootGroup = new THREE.Group();
    this.rootGroup.position.set(0, 0, 0);

    // Animasyon görsel grubu (Bobbing, roll, pitch, squash dönüşümleri)
    this.visualGroup = new THREE.Group();
    this.rootGroup.add(this.visualGroup);

    // 3 Boyutlu Hareket Durumu
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.currentFloorY = 0; // Karakterin bastığı dikey zemin kotu
    this.isMoving = false;
    this.walkSpeed = 4.2; // m/s
    this.walkTime = 0;
    this.idleTime = 0;

    // Karakter geometrilerini ve hedef halkasını oluştur
    this._buildCharacterMesh();
    this._buildTargetMarker();

    this.scene.add(this.rootGroup);
  }

  setCollisionManager(collisionManager) {
    this.collisionManager = collisionManager;
  }

  /**
   * Monokrom stilize kapsül karakter geometrisini oluşturur
   * @private
   */
  _buildCharacterMesh() {
    // 1. Gövde (Minimalist Beyaz Kapsül)
    const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.82, 16, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf4f4f4,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.77;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.visualGroup.add(this.bodyMesh);

    // 2. Parlak Siyah Vizör / Baş Bandı
    const visorGeo = new THREE.BoxGeometry(0.42, 0.14, 0.22);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.08,
      metalness: 0.95,
    });
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 1.02, 0.23);
    this.visorMesh.castShadow = true;
    this.visualGroup.add(this.visorMesh);

    // 3. Sırt Modülü (Koyu Gri Minimalist Detay)
    const packGeo = new THREE.BoxGeometry(0.3, 0.4, 0.14);
    const packMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.5,
      metalness: 0.2,
    });
    this.packMesh = new THREE.Mesh(packGeo, packMat);
    this.packMesh.position.set(0, 0.75, -0.26);
    this.packMesh.castShadow = true;
    this.visualGroup.add(this.packMesh);

    // 4. Zemin Yumuşak Temas Gölgesi
    const shadowGeo = new THREE.RingGeometry(0, 0.44, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.015;
    this.rootGroup.add(this.contactShadow);
  }

  /**
   * Tıklanan noktada beliren 3D hedef halkası
   * @private
   */
  _buildTargetMarker() {
    const ringGeo = new THREE.RingGeometry(0.24, 0.34, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetMarker = new THREE.Mesh(ringGeo, ringMat);
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.position.set(0, 0.02, 0);
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);

    this.markerActive = false;
    this.markerStartTime = 0;
  }

  /**
   * Karakteri 3D uzaydaki (X, Y, Z) hedef noktasına yönlendirir.
   * 2. kata veya merdiven başına tıklandığında hedef Y seviyesini tam algılar.
   *
   * @param {THREE.Vector3} point - 3D zemin/basamak/kat koordinatı
   */
  moveTo(point) {
    let safeTarget = point.clone();

    // Eğer tıklanan nokta bir engelin içindeyse dış kenara ötele
    if (this.collisionManager) {
      safeTarget = this.collisionManager.clampTargetOutsideObstacles(
        safeTarget,
        this.collisionRadius
      );
    }

    this.targetPosition.copy(safeTarget);

    // Yatay mesafe kontrolü (X ve Z)
    const currentPos = this.rootGroup.position;
    const horizontalDist = Math.hypot(
      safeTarget.x - currentPos.x,
      safeTarget.z - currentPos.z
    );

    if (horizontalDist > 0.15 || Math.abs(safeTarget.y - currentPos.y) > 0.2) {
      this.isMoving = true;
      this.onStateChange({ isMoving: true });

      // Hedef halkasını tam hedef yüksekliğinde (Y) göster
      this.targetMarker.position.set(safeTarget.x, safeTarget.y + 0.02, safeTarget.z);
      this.targetMarker.scale.set(0.5, 0.5, 0.5);
      this.targetMarker.material.opacity = 0.95;
      this.targetMarker.visible = true;
      this.markerActive = true;
      this.markerStartTime = performance.now();
    }
  }

  /**
   * Her render karesinde 3D hareketi, merdiven tırmanışını ve prosedürel animasyonu günceller
   * @param {number} delta - Geçen kare süresi (saniye)
   */
  update(delta) {
    // 1. Hedef halkası animasyonu (büyüme ve sönümlenme)
    if (this.markerActive) {
      const elapsed = (performance.now() - this.markerStartTime) / 1000;
      if (elapsed < 0.55) {
        const scale = 0.5 + elapsed * 1.4;
        this.targetMarker.scale.set(scale, scale, scale);
        this.targetMarker.material.opacity = Math.max(0, 0.95 - elapsed / 0.55);
      } else {
        this.targetMarker.visible = false;
        this.markerActive = false;
      }
    }

    const currentPos = this.rootGroup.position;

    // Yatay yön ve mesafe (X ve Z)
    const toTargetX = this.targetPosition.x - currentPos.x;
    const toTargetZ = this.targetPosition.z - currentPos.z;
    const horizontalDist = Math.hypot(toTargetX, toTargetZ);

    if (this.isMoving && horizontalDist > 0.12) {
      // İstenen yatay hareket adımı
      const stepDist = Math.min(horizontalDist, this.walkSpeed * delta);
      const rawStep = new THREE.Vector3(
        (toTargetX / horizontalDist) * stepDist,
        0,
        (toTargetZ / horizontalDist) * stepDist
      );

      // 2. Çarpışma Denetimi ve Duvar/Mobilya Boyunca Kayma (Sliding)
      let resolvedStep = rawStep;
      if (this.collisionManager) {
        const collisionResult = this.collisionManager.resolveMovement(
          currentPos,
          rawStep,
          this.collisionRadius,
          this.characterHeight
        );
        resolvedStep = collisionResult.resolvedStep;

        if (collisionResult.isColliding && resolvedStep.lengthSq() < 0.000005) {
          this.isMoving = false;
          this.onStateChange({ isMoving: false });
        }
      }

      // Yatay pozisyonu güncelle
      if (resolvedStep.lengthSq() > 0.000005) {
        const moveDir = resolvedStep.clone().normalize();
        const targetAngle = Math.atan2(moveDir.x, moveDir.z);
        let angleDiff = targetAngle - this.rootGroup.rotation.y;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        this.rootGroup.rotation.y += angleDiff * Math.min(1.0, delta * 12.0);

        currentPos.x += resolvedStep.x;
        currentPos.z += resolvedStep.z;

        // 3. Prosedürel Yürüme Matematiği
        this.walkTime += delta * (this.walkSpeed * 2.8);

        // a) Dikey Zıplama (Bobbing): |sin(t)| ile adımlama sıçraması
        const bob = Math.abs(Math.sin(this.walkTime)) * 0.12;
        this.visualGroup.position.y = bob;

        // b) Beşik Sallantısı (Roll): sin(t) ile sağa-sola adımlama yatışı
        const roll = Math.sin(this.walkTime) * 0.07;
        this.visualGroup.rotation.z = roll;

        // c) Hız Eğimi (Pitch/Lean): Gövdenin hareket yönüne 6-7 derece öne yatması
        const targetPitch = 0.11;
        this.visualGroup.rotation.x = THREE.MathUtils.lerp(
          this.visualGroup.rotation.x,
          targetPitch,
          delta * 10.0
        );

        // d) Squash & Stretch: Yere basma anında Y basılması ve X/Z genişlemesi
        const squash = Math.cos(this.walkTime * 2.0) * 0.05;
        this.visualGroup.scale.set(1.0 + squash * 0.5, 1.0 - squash, 1.0 + squash * 0.5);

        this.contactShadow.scale.set(1.0 - bob * 1.5, 1.0 - bob * 1.5, 1.0 - bob * 1.5);
      }
    } else {
      // Karakter durdu (Idle)
      if (this.isMoving) {
        this.isMoving = false;
        this.onStateChange({ isMoving: false });
      }

      this.idleTime += delta * 2.2;

      // Salınımları sönümle ve hafif nefes alma (breathing) hareketine geç
      const breathe = Math.sin(this.idleTime) * 0.015;
      this.visualGroup.position.y = THREE.MathUtils.lerp(this.visualGroup.position.y, breathe, delta * 8.0);
      this.visualGroup.rotation.z = THREE.MathUtils.lerp(this.visualGroup.rotation.z, 0, delta * 8.0);
      this.visualGroup.rotation.x = THREE.MathUtils.lerp(this.visualGroup.rotation.x, 0, delta * 8.0);
      this.visualGroup.scale.set(
        THREE.MathUtils.lerp(this.visualGroup.scale.x, 1.0 - breathe * 0.5, delta * 8.0),
        THREE.MathUtils.lerp(this.visualGroup.scale.y, 1.0 + breathe, delta * 8.0),
        THREE.MathUtils.lerp(this.visualGroup.scale.z, 1.0 - breathe * 0.5, delta * 8.0)
      );
      this.contactShadow.scale.set(1.0, 1.0, 1.0);
    }

    // 4. ÇOK KATLI DİKEY ZEMİN KOTU YAKALAMA (Vertical Floor Snapping):
    // Karakter ister yürüsün ister dursun, altındaki basamak, rampa veya 2. kat zeminini
    // CollisionManager üzerinden tespit edip Y pozisyonunu yumuşakça (lerp) eşitler.
    if (this.collisionManager) {
      const targetFloorY = this.collisionManager.getFloorHeight(
        currentPos,
        this.currentFloorY
      );

      // Merdiven basamakları arasında yumuşak dikey geçiş
      this.currentFloorY = THREE.MathUtils.lerp(
        this.currentFloorY,
        targetFloorY,
        Math.min(1.0, delta * 14.0)
      );

      this.rootGroup.position.y = this.currentFloorY;
    }
  }

  /**
   * Karakterin 3D dünya koordinatını döndürür
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this.rootGroup.position;
  }

  /**
   * Karakteri başlangıç konumuna sıfırlar
   */
  resetPosition(x = 0, y = 0, z = 0) {
    this.rootGroup.position.set(x, y, z);
    this.targetPosition.set(x, y, z);
    this.currentFloorY = y;
    this.isMoving = false;
    this.onStateChange({ isMoving: false });
  }

  /**
   * Yürüme hızını ayarlar
   * @param {number} speed
   */
  setSpeed(speed) {
    this.walkSpeed = speed;
  }
}
