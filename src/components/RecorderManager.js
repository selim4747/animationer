import { saveGeneratedFile } from '../utils/FileExportManager.js';
import { getDeviceMemoryGiB, getDevicePerformanceProfile } from '../utils/device-profile.js';

export const MAX_RECORDING_DURATION_SECONDS = 180;
export const MAX_RECORDING_BYTES = 128 * 1024 * 1024;

function createUniqueSuffix() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRecordingFilename(mimeType = 'video/webm', date = new Date()) {
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  return `diorama_scene_${timestamp}_${createUniqueSuffix()}.${extension}`;
}

export class RecorderManager {
  constructor(canvas, {
    onStateChange = () => {},
    maxDurationSeconds = MAX_RECORDING_DURATION_SECONDS,
    maxRecordingBytes = MAX_RECORDING_BYTES,
  } = {}) {
    const profile = getDevicePerformanceProfile(getDeviceMemoryGiB());
    this.canvas = canvas;
    this.onStateChange = onStateChange;
    this.maxDurationSeconds = maxDurationSeconds;
    this.maxRecordingBytes = Math.min(maxRecordingBytes, profile.maxRecordingBytes);
    this.maxFrameRate = profile.maxFrameRate;
    this.isRecording = false;
    this.isFinalizing = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordedBytes = 0;
    this.recordStartTime = 0;
    this.recordDurationSeconds = 0;
    this.timerInterval = null;
    this.lastDownloadResult = null;
    this.quality = 'high';
    this.bitrate = 8500000;
    this.frameRate = 30;
    this.stream = null;
    this.stopReason = null;
    this.lastStopReason = null;
    this.lastRecordingBlob = null;
    this.activeTimelineManager = null;
    this._stopPromise = null;
    this._stopPromiseResolve = null;
    this._recorderFailed = false;
    this._stopHandled = false;
  }

  setQuality(quality) {
    this.quality = quality === 'standard' ? 'standard' : 'high';
    this.bitrate = this.quality === 'standard' ? 4000000 : 8500000;
  }

  setFrameRate(frameRate) {
    this.frameRate = Number(frameRate) === 60 && this.maxFrameRate >= 60 ? 60 : 30;
    return this.frameRate;
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
    if (this.isRecording || this.isFinalizing) return false;
    if (!this.canvas || typeof this.canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      const error = 'Bu ortamda video kaydı desteklenmiyor.';
      console.error(error);
      this.onStateChange({ isRecording: false, isFinalizing: false, error });
      return false;
    }

    try {
      this.stream = this.canvas.captureStream(this.frameRate);
      const mimeType = this._getSupportedMimeType();
      const options = { videoBitsPerSecond: this.bitrate };
      if (mimeType) options.mimeType = mimeType;
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.recordedChunks = [];
      this.recordedBytes = 0;
      this._lastReportedBytes = 0;
      this._lastSizeReportAt = 0;
      this.lastDownloadResult = null;
      this.stopReason = null;
      this.lastStopReason = null;
      this.lastRecordingBlob = null;
      this.isFinalizing = false;
      this._recorderFailed = false;
      this._stopHandled = false;
      const recorder = this.mediaRecorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0 || this._recorderFailed) return;
        this.recordedChunks.push(event.data);
        this.recordedBytes += event.data.size;
        if (this.isRecording && this.recordedBytes >= this.maxRecordingBytes) {
          this.stopRecording('size-limit');
          return;
        }
        const now = performance.now();
        if (this.isRecording && (this.recordedBytes - this._lastReportedBytes >= 1024 * 1024 || now - this._lastSizeReportAt >= 1000)) {
          this._lastReportedBytes = this.recordedBytes;
          this._lastSizeReportAt = now;
          this.onStateChange({
            isRecording: true,
            isFinalizing: false,
            duration: this.recordDurationSeconds,
            formattedDuration: this.getFormattedDuration(),
            sizeBytes: this.recordedBytes,
            maxRecordingBytes: this.maxRecordingBytes,
            frameRate: this.frameRate,
            maxFrameRate: this.maxFrameRate,
            width: this.canvas.width,
            height: this.canvas.height,
          });
        }
      };
      recorder.onerror = (event) => {
        const message = event?.error?.message || event?.message || 'Video kaydı sırasında hata oluştu.';
        this._handleRecorderError(message, recorder);
      };
      recorder.onstop = () => { this._handleRecorderStop(recorder); };
      recorder.start(250);
      this.isRecording = true;
      this.recordStartTime = performance.now();
      this.recordDurationSeconds = 0;
      this._lastReportedDuration = 0;
      this._lastSizeReportAt = this.recordStartTime;
      clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        const elapsed = Math.floor((performance.now() - this.recordStartTime) / 1000);
        this.recordDurationSeconds = Math.min(elapsed, this.maxDurationSeconds);
        if (this.recordDurationSeconds !== this._lastReportedDuration) {
          this._lastReportedDuration = this.recordDurationSeconds;
          this.onStateChange({
            isRecording: true,
            isFinalizing: false,
            duration: this.recordDurationSeconds,
            formattedDuration: this.getFormattedDuration(),
            sizeBytes: this.recordedBytes,
            maxRecordingBytes: this.maxRecordingBytes,
            maxDurationSeconds: this.maxDurationSeconds,
            frameRate: this.frameRate,
            maxFrameRate: this.maxFrameRate,
            width: this.canvas.width,
            height: this.canvas.height,
          });
        }
        if (elapsed >= this.maxDurationSeconds) this.stopRecording('duration-limit');
      }, 1000);
      this.onStateChange({
        isRecording: true,
        isFinalizing: false,
        duration: 0,
        formattedDuration: '00:00',
        sizeBytes: 0,
        maxRecordingBytes: this.maxRecordingBytes,
        maxDurationSeconds: this.maxDurationSeconds,
        frameRate: this.frameRate,
        maxFrameRate: this.maxFrameRate,
        width: this.canvas.width,
        height: this.canvas.height,
      });
      return true;
    } catch (error) {
      console.error('Video kaydı başlatılamadı:', error);
      this._cleanupStream();
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.recordedBytes = 0;
      this.isRecording = false;
      this.isFinalizing = false;
      this.onStateChange({ isRecording: false, isFinalizing: false, error: error.message || 'Video kaydı başlatılamadı.' });
      return false;
    }
  }

  stopRecording(reason = 'manual') {
    if (!this.isRecording || !this.mediaRecorder) return Promise.resolve(null);
    if (this._stopPromise) return this._stopPromise;

    clearInterval(this.timerInterval);
    this.isRecording = false;
    this.isFinalizing = true;
    this.stopReason = reason;
    if ((reason === 'duration-limit' || reason === 'size-limit') && this.activeTimelineManager?.isPlaying) {
      this.activeTimelineManager.stop();
    }
    const recorder = this.mediaRecorder;
    this._stopPromise = new Promise((resolve) => { this._stopPromiseResolve = resolve; });
    this.onStateChange({
      isRecording: false,
      isFinalizing: true,
      duration: this.recordDurationSeconds,
      formattedDuration: this.getFormattedDuration(),
      sizeBytes: this.recordedBytes,
      maxRecordingBytes: this.maxRecordingBytes,
      maxDurationSeconds: this.maxDurationSeconds,
      frameRate: this.frameRate,
      stopReason: reason,
    });

    try {
      recorder.stop();
    } catch (error) {
      this._handleRecorderError(error.message || 'Video kaydı durdurulamadı.', recorder);
    }
    return this._stopPromise || Promise.resolve(null);
  }

  async _handleRecorderStop(recorder) {
    if (this._stopHandled || this._recorderFailed || this.mediaRecorder !== recorder) return;
    this._stopHandled = true;
    clearInterval(this.timerInterval);
    if (!this.isFinalizing) {
      this.isRecording = false;
      this.isFinalizing = true;
      this.onStateChange({
        isRecording: false,
        isFinalizing: true,
        duration: this.recordDurationSeconds,
        formattedDuration: this.getFormattedDuration(),
        sizeBytes: this.recordedBytes,
        maxRecordingBytes: this.maxRecordingBytes,
        frameRate: this.frameRate,
      });
    }

    let blob = null;
    try {
      const mimeType = recorder.mimeType || this._getSupportedMimeType() || 'video/webm';
      blob = new Blob(this.recordedChunks, { type: mimeType });
      if (blob.size === 0) throw new Error('Video dosyası oluşturulamadı.');
      this.lastRecordingBlob = this.activeTimelineManager ? blob : null;
      this.lastStopReason = this.stopReason;
      const filename = createRecordingFilename(mimeType);
      const downloadResult = await this._downloadBlob(blob, filename);
      this.lastDownloadResult = downloadResult;
      this.onStateChange({
        isRecording: false,
        isFinalizing: false,
        duration: this.recordDurationSeconds,
        formattedDuration: '00:00',
        filename: downloadResult.saved ? filename : undefined,
        downloadResult,
        canceled: downloadResult.canceled || false,
        error: downloadResult.saved || downloadResult.canceled ? undefined : 'Dosya cihaza kaydedilemedi.',
        blob,
        stopReason: this.stopReason,
        frameRate: this.frameRate,
      });
      this._resolveStop(blob);
    } catch (error) {
      this.lastDownloadResult = { saved: false, error: error.message || 'Dosya cihaza kaydedilemedi.' };
      this.onStateChange({ isRecording: false, isFinalizing: false, error: this.lastDownloadResult.error, stopReason: this.stopReason });
      this._resolveStop(null);
    } finally {
      this._cleanupStream();
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.recordedBytes = 0;
      this.isRecording = false;
      this.isFinalizing = false;
      this.stopReason = null;
    }
  }

  _handleRecorderError(message, recorder) {
    if (this._recorderFailed || this._stopHandled || (recorder && this.mediaRecorder !== recorder)) return;
    this._recorderFailed = true;
    clearInterval(this.timerInterval);
    this.isRecording = false;
    this.isFinalizing = false;
    this.lastDownloadResult = { saved: false, error: message };
    this._cleanupStream();
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordedBytes = 0;
    this.onStateChange({ isRecording: false, isFinalizing: false, error: message, stopReason: this.stopReason });
    this.stopReason = null;
    this._resolveStop(null);
  }

  _resolveStop(value) {
    const resolve = this._stopPromiseResolve;
    this._stopPromiseResolve = null;
    this._stopPromise = null;
    resolve?.(value);
  }

  _cleanupStream() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop(); } catch { /* Continue releasing the remaining tracks. */ }
      }
      this.stream = null;
    }
  }

  getFormattedDuration() {
    const mins = Math.floor(this.recordDurationSeconds / 60).toString().padStart(2, '0');
    const secs = (this.recordDurationSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  async takeScreenshot(customName, onProgress) {
    if (!this.canvas) return { saved: false, error: 'Sahne görüntüsü bulunamadı.' };
    try {
      const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG görüntüsü oluşturulamadı.');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
      const filename = customName || `diorama_snapshot_${timestamp}.png`;
      return { ...(await saveGeneratedFile(blob, filename, { onProgress })), filename, blob };
    } catch (error) {
      console.error('Ekran görüntüsü kaydedilemedi:', error);
      return { saved: false, error: error.message || 'Ekran görüntüsü kaydedilemedi.' };
    }
  }

  async recordTimelineSequence(timelineManager, { onBeforeStart = () => {}, onAfterFinish = () => {} } = {}) {
    if (!timelineManager || this.isRecording || this.isFinalizing) {
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
      this.activeTimelineManager = timelineManager;
      if (!this.startRecording()) throw new Error('Bu ortamda video kaydı başlatılamadı.');
      await this._sleep(250);
      const played = await timelineManager.play();
      if (played === false) {
        const finalizedBlob = this._stopPromise ? await this._stopPromise : null;
        if (this.lastStopReason === 'duration-limit' || this.lastStopReason === 'size-limit') {
          blob = finalizedBlob || this.lastRecordingBlob;
          downloadResult = this.lastDownloadResult;
          throw new Error('Kayıt süresi veya dosya boyutu sınırına ulaşıldı; reji erken durdu ve oluşturulan video kısmi olabilir.');
        }
        throw new Error('Reji oynatımı tamamlanmadı; video kısmi olabilir.');
      }
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
      this.activeTimelineManager = null;
      this.lastRecordingBlob = null;
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
    return saveGeneratedFile(blob, filename, {
      onProgress: (progress) => this.onStateChange({
        isRecording: false,
        isFinalizing: true,
        duration: this.recordDurationSeconds,
        formattedDuration: this.getFormattedDuration(),
        progress,
        filename,
        frameRate: this.frameRate,
      }),
    });
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
