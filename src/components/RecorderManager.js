/**
 * RecorderManager.js
 * Canvas video kaydı ve PNG ekran görüntüsü dışa aktarma yöneticisi.
 * Video profilleri çözünürlüğü değil, MediaRecorder için istenen bitrate'i belirler.
 */
export class RecorderManager {
  constructor(canvas, { onStateChange = () => {} } = {}) {
    this.canvas = canvas;
    this.onStateChange = onStateChange;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordStartTime = 0;
    this.recordDurationSeconds = 0;
    this.timerInterval = null;
    this.quality = 'high';
    this.bitrate = 8500000;
    this.stream = null;
  }

  setQuality(quality) {
    this.quality = quality === 'standard' ? 'standard' : 'high';
    this.bitrate = this.quality === 'standard' ? 4000000 : 8500000;
  }

  _getSupportedMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  startRecording() {
    if (this.isRecording) return false;
    if (!this.canvas || typeof this.canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      console.error('Video kaydı bu ortamda desteklenmiyor.');
      return false;
    }

    try {
      this.stream = this.canvas.captureStream(60);
      const mimeType = this._getSupportedMimeType();
      const options = { videoBitsPerSecond: this.bitrate };
      if (mimeType) options.mimeType = mimeType;
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.recordedChunks = [];
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
      };
      this.mediaRecorder.start(250);
      this.isRecording = true;
      this.recordStartTime = performance.now();
      this.recordDurationSeconds = 0;
      clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        this.recordDurationSeconds = Math.floor((performance.now() - this.recordStartTime) / 1000);
        this.onStateChange({
          isRecording: true,
          duration: this.recordDurationSeconds,
          formattedDuration: this.getFormattedDuration(),
        });
      }, 500);
      this.onStateChange({ isRecording: true, duration: 0, formattedDuration: '00:00' });
      return true;
    } catch (error) {
      console.error('Video kaydı başlatılamadı:', error);
      this._cleanupStream();
      this.mediaRecorder = null;
      this.isRecording = false;
      this.onStateChange({ isRecording: false, error: error.message || 'Video kaydı başlatılamadı.' });
      return false;
    }
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        resolve(null);
        return;
      }
      clearInterval(this.timerInterval);
      this.isRecording = false;
      const recorder = this.mediaRecorder;
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || this._getSupportedMimeType() || 'video/webm';
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `diorama_scene_${timestamp}.${extension}`;
        this._downloadBlob(blob, filename);
        this._cleanupStream();
        this.mediaRecorder = null;
        this.onStateChange({
          isRecording: false,
          duration: this.recordDurationSeconds,
          formattedDuration: '00:00',
          filename,
        });
        resolve(blob);
      };
      recorder.onerror = (event) => {
        clearInterval(this.timerInterval);
        this._cleanupStream();
        this.mediaRecorder = null;
        this.onStateChange({ isRecording: false, error: event.error?.message || 'Video kaydı sırasında hata oluştu.' });
        resolve(null);
      };
      try {
        recorder.stop();
      } catch (error) {
        this._cleanupStream();
        this.mediaRecorder = null;
        this.onStateChange({ isRecording: false, error: error.message || 'Video kaydı durdurulamadı.' });
        resolve(null);
      }
    });
  }

  _cleanupStream() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  getFormattedDuration() {
    const mins = Math.floor(this.recordDurationSeconds / 60).toString().padStart(2, '0');
    const secs = (this.recordDurationSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  takeScreenshot(customName) {
    if (!this.canvas) return null;
    try {
      const dataURL = this.canvas.toDataURL('image/png');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = customName || `diorama_snapshot_${timestamp}.png`;
      const link = document.createElement('a');
      link.href = dataURL;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return filename;
    } catch (error) {
      console.error('Ekran görüntüsü alınamadı:', error);
      return null;
    }
  }

  async recordTimelineSequence(timelineManager, { onBeforeStart = () => {}, onAfterFinish = () => {} } = {}) {
    if (!timelineManager || this.isRecording) {
      return { success: false, error: 'Kayıt başlatılamadı.' };
    }
    if (!Array.isArray(timelineManager.steps) || timelineManager.steps.length === 0) {
      const result = { success: false, error: 'Kaydedilecek reji adımı bulunamadı.' };
      onAfterFinish(result);
      return result;
    }

    let success = false;
    let errorMessage = '';
    let blob = null;
    try {
      onBeforeStart();
      timelineManager.stop();
      await this._sleep(300);
      if (!this.startRecording()) throw new Error('Bu ortamda video kaydı başlatılamadı.');
      await this._sleep(250);
      const played = await timelineManager.play();
      if (played === false) throw new Error('Reji oynatımı tamamlanmadı; video kısmi olabilir.');
      await this._sleep(600);
      blob = await this.stopRecording();
      if (!blob || blob.size === 0) throw new Error('Video dosyası oluşturulamadı.');
      success = true;
    } catch (error) {
      errorMessage = error.message || 'Reji videosu kaydedilemedi.';
    } finally {
      if (this.isRecording) await this.stopRecording();
      const result = { success, error: errorMessage, blob };
      try {
        onAfterFinish(result);
      } catch (callbackError) {
        console.error('Kayıt sonrası arayüz güncellenemedi:', callbackError);
      }
    }
    return { success, error: errorMessage, blob };
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
