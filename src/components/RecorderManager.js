/**
 * RecorderManager.js
 * Canvas üzerinden yüksek çözünürlüklü ekran görüntüsü (.png) ve
 * 60 FPS video kaydı (.webm / .mp4) alan dışa aktarma (Render/Export) motoru.
 * Reji / Zaman Çizelgesi (Timeline) ile entegre çalışarak sahneyi otomatik kaydeder.
 */

export class RecorderManager {
  /**
   * @param {HTMLCanvasElement} canvas - Three.js WebGL canvas öğesi
   * @param {Object} options
   * @param {Function} options.onStateChange - Kayıt durumu bildirim geri çağrısı
   */
  constructor(canvas, { onStateChange = () => {} } = {}) {
    this.canvas = canvas;
    this.onStateChange = onStateChange;

    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordStartTime = 0;
    this.recordDurationSeconds = 0;
    this.timerInterval = null;

    // Kalite Ayarı ('720p' | '1080p')
    this.quality = '1080p';
    this.bitrate = 8000000; // 8 Mbps (1080p için temiz kalite)

    this.stream = null;
  }

  setQuality(quality) {
    this.quality = quality;
    if (quality === '720p') {
      this.bitrate = 4000000; // 4 Mbps
    } else {
      this.bitrate = 8500000; // 8.5 Mbps
    }
  }

  /**
   * Desteklenen en uygun video MIME türünü belirler
   * @private
   */
  _getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];

    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return 'video/webm';
  }

  /**
   * Canvas akışını 60 FPS olarak dinlemeye başlar
   */
  startRecording() {
    if (this.isRecording) return false;
    if (!this.canvas) {
      console.error('RecorderManager: Canvas öğesi bulunamadı!');
      return false;
    }

    try {
      // 60 FPS Canvas Akışı
      this.stream = this.canvas.captureStream(60);
      const mimeType = this._getSupportedMimeType();

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        videoBitsPerSecond: this.bitrate,
      });

      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.start(250); // Her 250ms'de bir veri dilimi
      this.isRecording = true;
      this.recordStartTime = performance.now();
      this.recordDurationSeconds = 0;

      // Sayaç başlat
      clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        this.recordDurationSeconds = Math.floor((performance.now() - this.recordStartTime) / 1000);
        this.onStateChange({
          isRecording: true,
          duration: this.recordDurationSeconds,
          formattedDuration: this.getFormattedDuration(),
        });
      }, 500);

      this.onStateChange({
        isRecording: true,
        duration: 0,
        formattedDuration: '00:00',
      });

      return true;
    } catch (err) {
      console.error('Video kaydı başlatılamadı:', err);
      return false;
    }
  }

  /**
   * Video kaydını durdurur, birleştirir ve indirir
   * @returns {Promise<Blob>}
   */
  stopRecording() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        resolve(null);
        return;
      }

      clearInterval(this.timerInterval);
      this.isRecording = false;

      this.mediaRecorder.onstop = () => {
        const mimeType = this._getSupportedMimeType();
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });

        // İndirme tetikle
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `diorama_scene_${timestamp}.${extension}`;
        this._downloadBlob(blob, filename);

        // Stream parçalarını kapat
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }

        this.onStateChange({
          isRecording: false,
          duration: this.recordDurationSeconds,
          formattedDuration: '00:00',
          filename,
        });

        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Geçen kayıt süresini '00:00' formatında döndürür
   */
  getFormattedDuration() {
    const mins = Math.floor(this.recordDurationSeconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (this.recordDurationSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  /**
   * O anki canvas karesini yüksek çözünürlüklü temiz bir PNG olarak indirir
   * @param {string} [customName]
   */
  takeScreenshot(customName) {
    if (!this.canvas) return;

    try {
      const dataURL = this.canvas.toDataURL('image/png', 1.0);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = customName || `diorama_snapshot_${timestamp}.png`;

      const link = document.createElement('a');
      link.href = dataURL;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      return filename;
    } catch (err) {
      console.error('Ekran görüntüsü alınamadı:', err);
      return null;
    }
  }

  /**
   * Reji / Timeline akışını baştan oynatarak otomatik video kaydı alır
   * @param {import('./TimelineManager.js').TimelineManager} timelineManager
   * @param {Object} [options]
   * @param {Function} [options.onBeforeStart]
   * @param {Function} [options.onAfterFinish]
   */
  async recordTimelineSequence(timelineManager, { onBeforeStart = () => {}, onAfterFinish = () => {} } = {}) {
    if (!timelineManager || this.isRecording) return;

    if (onBeforeStart) onBeforeStart();

    // Sahneyi başa sar
    timelineManager.stop();
    await this._sleep(300);

    // Kaydı başlat
    this.startRecording();
    await this._sleep(250);

    // Timeline'ı sonuna kadar oynat
    await timelineManager.play();

    // Eylemler bittikten sonra 0.6s tampon payı bırak
    await this._sleep(600);

    // Kaydı durdur ve indir
    await this.stopRecording();

    if (onAfterFinish) onAfterFinish();
  }

  /**
   * Blob dosyasını tarayıcıda indirir
   * @private
   */
  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
