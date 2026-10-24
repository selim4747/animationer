/**
 * RecorderManager.js
 * Canvas video kaydı ve PNG ekran görüntüsü dışa aktarma yöneticisi.
 * Video profilleri çözünürlüğü değil, MediaRecorder için istenen bitrate'i belirler.
 */
import { saveGeneratedFile } from '../utils/FileExportManager.js';

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
    this.lastDownloadResult = null;
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
      this.lastDownloadResult = null;
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
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || this._getSupportedMimeType() || 'video/webm';
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `diorama_scene_${timestamp}.${extension}`;
        try {
          const downloadResult = await this._downloadBlob(blob, filename);
          this.lastDownloadResult = downloadResult;
          this.onStateChange({
            isRecording: false,
            duration: this.recordDurationSeconds,
            formattedDuration: '00:00',
            filename: downloadResult.saved ? filename : undefined,
            downloadResult,
            canceled: downloadResult.canceled || false,
            error: downloadResult.saved || downloadResult.canceled ? undefined : 'Dosya cihaza kaydedilemedi.',
          });
          resolve(blob);
        } catch (error) {
          this.lastDownloadResult = { saved: false, error: error.message || 'Dosya cihaza kaydedilemedi.' };
          this.onStateChange({ isRecording: false, error: this.lastDownloadResult.error });
          resolve(null);
        } finally {
          this._cleanupStream();
          this.mediaRecorder = null;
        }
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

  async takeScreenshot(customName) {
    if (!this.canvas) return { saved: false, error: 'Sahne görüntüsü bulunamadı.' };
    try {
      const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG görüntüsü oluşturulamadı.');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
      const filename = customName || `diorama_snapshot_${timestamp}.png`;
      return { ...(await saveGeneratedFile(blob, filename)), filename };
    } catch (error) {
      console.error('Ekran görüntüsü kaydedilemedi:', error);
      return { saved: false, error: error.message || 'Ekran görüntüsü kaydedilemedi.' };
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
    let downloadResult = null;
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
      if (!blob || blob.size === 0) {
        throw new Error(this.lastDownloadResult?.error || 'Video dosyası oluşturulamadı.');
      }
      downloadResult = this.lastDownloadResult;
      if (downloadResult && !downloadResult.saved) {
        throw new Error(downloadResult.canceled ? 'Dosya kaydetme iptal edildi.' : downloadResult.error || 'Video dosyası cihaza kaydedilemedi.');
      }
      success = true;
    } catch (error) {
      errorMessage = error.message || 'Reji videosu kaydedilemedi.';
    } finally {
      if (this.isRecording) await this.stopRecording();
      const result = { success, error: errorMessage, blob, downloadResult };
      try {
        onAfterFinish(result);
      } catch (callbackError) {
        console.error('Kayıt sonrası arayüz güncellenemedi:', callbackError);
      }
    }
    return { success, error: errorMessage, blob, downloadResult };
  }

  _downloadBlob(blob, filename) {
    return saveGeneratedFile(blob, filename);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
