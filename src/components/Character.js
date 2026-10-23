/**
 * Character.js
 * Rig ve kemik içermeyen, tamamen matematiksel prosedürel animasyonlu monokrom karakter sınıfı.
 * CollisionManager ile duvar çarpışma kontrolü ve duvar boyunca kayma (Wall Sliding) desteği içerir.
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

    // Çarpışma yarıçapı (Modelin duvara gömülmesini engelleyen tampon mesafe)
    this.collisionRadius = 0.34;

    // Ana pozisyon grubu (Dünya koordinatları ve Y-ekseni yönü)
    this.rootGroup = new THREE.Group();
    this.rootGroup.position.set(0, 0, 0);

    // Animasyon görsel grubu (Bobbing, roll, pitch, squash dönüşümleri)
    this.visualGroup = new THREE.Group();
    this.rootGroup.add(this.visualGroup);

    // Hareket Durumu
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.isMoving = false;
    this.walkSpeed = 4.2; // m/s
    this.walkTime = 0;
    this.idleTime = 0;

    // Karakter geometrilerini ve hedef halkasını oluştur
    this._buildCharacterMesh();
    this._buildTargetMarker();

    this.scene.add(this.rootGroup);
  }

  /**
   * Çarpışma yöneticisi referansını ayarlar
   * @param {CollisionManager} collisionManager
   */
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
   * Tıklama anında zemin üzerinde beliren minimalist beyaz hedef halkası
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
   * Karakteri tıklanan veya dokunulan hedef koordinatına yönlendirir
   * @param {THREE.Vector3} point - Hedef zemin koordinatı
   */
  moveTo(point) {
    this.targetPosition.set(point.x, 0, point.z);

    const dist = this.rootGroup.position.distanceTo(this.targetPosition);
    if (dist > 0.15) {
      this.isMoving = true;
      this.onStateChange({ isMoving: true });

      // Hedef halkasını tetikle
      this.targetMarker.position.set(point.x, point.y + 0.02, point.z);
      this.targetMarker.scale.set(0.5, 0.5, 0.5);
      this.targetMarker.material.opacity = 0.95;
      this.targetMarker.visible = true;
      this.markerActive = true;
      this.markerStartTime = performance.now();
    }
  }

  /**
   * Her render karesinde karakterin hareketini, çarpışmasını ve prosedürel animasyonunu günceller
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
    const toTarget = new THREE.Vector3().subVectors(this.targetPosition, currentPos);
    toTarget.y = 0;
    const distance = toTarget.length();

    if (this.isMoving && distance > 0.12) {
      // İstenen hareket adımı vektörü
      const stepDist = Math.min(distance, this.walkSpeed * delta);
      const rawStep = toTarget.clone().normalize().multiplyScalar(stepDist);

      // 2. Çarpışma Denetimi ve Duvar Boyunca Kayma (Wall Sliding)
      let resolvedStep = rawStep;
      if (this.collisionManager) {
        const collisionResult = this.collisionManager.resolveMovement(
          currentPos,
          rawStep,
          this.collisionRadius
        );
        resolvedStep = collisionResult.resolvedStep;

        // Eğer karakter duvara tamamen çarptıysa ve kayma adım boyu çok küçükse durdur
        if (collisionResult.isColliding && resolvedStep.lengthSq() < 0.00002) {
          this.isMoving = false;
          this.onStateChange({ isMoving: false });
        }
      }

      // Adım atılabiliyorsa konumu güncelle
      if (resolvedStep.lengthSq() > 0.00001) {
        // Y-Ekseninde Hedefe / Kayma Yönüne Yumuşak Dönüş
        const moveDir = resolvedStep.clone().normalize();
        const targetAngle = Math.atan2(moveDir.x, moveDir.z);
        let angleDiff = targetAngle - this.rootGroup.rotation.y;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        this.rootGroup.rotation.y += angleDiff * Math.min(1.0, delta * 12.0);

        currentPos.add(resolvedStep);

        // 3. Prosedürel Yürüme Matematiği
        this.walkTime += delta * (this.walkSpeed * 2.8);

        // a) Dikey Zıplama (Bobbing): |sin(t)| ile adımlama sıçraması
        const bob = Math.abs(Math.sin(this.walkTime)) * 0.13;
        this.visualGroup.position.y = bob;

        // b) Beşik Sallantısı (Roll/Wobble): sin(t) ile sağa-sola adımlama yatışı
        const roll = Math.sin(this.walkTime) * 0.08;
        this.visualGroup.rotation.z = roll;

        // c) Hız Eğimi (Pitch/Lean): Gövdenin hareket yönüne 6-7 derece öne yatması
        const targetPitch = 0.12;
        this.visualGroup.rotation.x = THREE.MathUtils.lerp(
          this.visualGroup.rotation.x,
          targetPitch,
          delta * 10.0
        );

        // d) Squash & Stretch: Yere çarpış anında Y basılması ve X/Z genişlemesi
        const squash = Math.cos(this.walkTime * 2.0) * 0.055;
        this.visualGroup.scale.set(1.0 + squash * 0.5, 1.0 - squash, 1.0 + squash * 0.5);

        // Gölge boyutu senkronizasyonu
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
  }

  /**
   * Karakterin dünya koordinatını döndürür
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
