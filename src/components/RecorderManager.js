import { saveGeneratedFile } from '../utils/FileExportManager.js';
import { getDeviceMemoryGiB, getDevicePerformanceProfile } from '../utils/device-profile.js';

export const MAX_RECORDING_DURATION_SECONDS = 180;
export const MAX_RECORDING_BYTES = 128 * 1024 * 1024;
export const EXPORT_RESOLUTION_PRESETS = Object.freeze({ current: null, '720p': 1280, '1080p': 1920 });

export function getExportDimensions(sourceWidth, sourceHeight, preset = 'current', maxPixels = 16 * 1024 * 1024) {
  const width = Math.max(1, Math.floor(Number(sourceWidth) || 1));
  const height = Math.max(1, Math.floor(Number(sourceHeight) || 1));
  const maxEdge = EXPORT_RESOLUTION_PRESETS[preset];
  if (!maxEdge) return { width, height };
  const scale = maxEdge / Math.max(width, height);
  let outputWidth = Math.max(2, Math.round((width * scale) / 2) * 2);
  let outputHeight = Math.max(2, Math.round((height * scale) / 2) * 2);
  const pixelLimit = Number.isFinite(maxPixels) && maxPixels > 0 ? maxPixels : 4 * 1024 * 1024;
  if (outputWidth * outputHeight > pixelLimit) {
    const capScale = Math.sqrt(pixelLimit / (outputWidth * outputHeight));
    outputWidth = Math.max(2, Math.floor((outputWidth * capScale) / 2) * 2);
    outputHeight = Math.max(2, Math.floor((outputHeight * capScale) / 2) * 2);
  }
  return { width: outputWidth, height: outputHeight };
}

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
    onBeforeCapture = () => null,
    onAfterCapture = () => {},
    maxDurationSeconds = MAX_RECORDING_DURATION_SECONDS,
    maxRecordingBytes = MAX_RECORDING_BYTES,
  } = {}) {
    const profile = getDevicePerformanceProfile(getDeviceMemoryGiB());
    this.canvas = canvas;
    this.onStateChange = onStateChange;
    this.onBeforeCapture = onBeforeCapture;
    this.onAfterCapture = onAfterCapture;
    this.maxDurationSeconds = maxDurationSeconds;
    this.maxRecordingBytes = Math.min(maxRecordingBytes, profile.maxRecordingBytes);
    this.maxFrameRate = profile.maxFrameRate;
    this.maxExportPixels = profile.maxTexturePixels;
    this.isRecording = false;
    this.isFinalizing = false;
    this.isTakingScreenshot = false;
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
    this.resolutionPreset = 'current';
    this.backgroundMode = 'scene';
    this.backgroundColor = '#080808';
    this._captureSettingsToken = null;
    this.exportCanvas = null;
    this.exportCanvasContext = null;
    this.captureCanvas = canvas;
    this._captureFrameHandle = null;
    this._captureFrameInterval = null;
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

  setResolutionPreset(preset) {
    if (this.isRecording || this.isFinalizing || !Object.hasOwn(EXPORT_RESOLUTION_PRESETS, preset)) return false;
    this.resolutionPreset = preset;
    return true;
  }

  setBackground(mode, color = this.backgroundColor) {
    if (this.isRecording || this.isFinalizing || !['scene', 'solid'].includes(mode)) return false;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return false;
    this.backgroundMode = mode;
    this.backgroundColor = color.toLowerCase();
    return true;
  }

  getOutputDimensions() {
    return getExportDimensions(this.canvas?.width, this.canvas?.height, this.resolutionPreset, this.maxExportPixels);
  }

  _prepareCaptureCanvas() {
    if (this.resolutionPreset === 'current' || !this.canvas || typeof document === 'undefined' || typeof document.createElement !== 'function') return this.canvas;
    const dimensions = this.getOutputDimensions();
    if (!this.exportCanvas) {
      this.exportCanvas = document.createElement('canvas');
      this.exportCanvasContext = this.exportCanvas.getContext?.('2d') || null;
    }
    if (!this.exportCanvasContext) return this.canvas;
    if (this.exportCanvas.width !== dimensions.width || this.exportCanvas.height !== dimensions.height) {
      this.exportCanvas.width = dimensions.width;
      this.exportCanvas.height = dimensions.height;
    }
    return this.exportCanvas;
  }

  _drawExportFrame(target = this.captureCanvas) {
    if (!target || target === this.canvas || !this.exportCanvasContext) return;
    this.exportCanvasContext.imageSmoothingEnabled = true;
    this.exportCanvasContext.imageSmoothingQuality = 'high';
    this.exportCanvasContext.fillStyle = this.backgroundMode === 'solid' ? this.backgroundColor : '#080808';
    this.exportCanvasContext.fillRect(0, 0, target.width, target.height);
    const scale = Math.min(target.width / Math.max(1, this.canvas.width), target.height / Math.max(1, this.canvas.height));
    const width = this.canvas.width * scale;
    const height = this.canvas.height * scale;
    this.exportCanvasContext.drawImage(this.canvas, (target.width - width) / 2, (target.height - height) / 2, width, height);
  }

  _startCaptureFrameLoop() {
    if (this.captureCanvas === this.canvas) return;
    const draw = () => {
      if (!this.isRecording) return;
      this._drawExportFrame();
      if (typeof requestAnimationFrame === 'function') this._captureFrameHandle = requestAnimationFrame(draw);
    };
    if (typeof requestAnimationFrame === 'function') this._captureFrameHandle = requestAnimationFrame(draw);
    else this._captureFrameInterval = setInterval(() => { if (this.isRecording) this._drawExportFrame(); }, Math.max(16, 1000 / this.frameRate));
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
    if (this.isRecording || this.isFinalizing || this.isTakingScreenshot) return false;
    if (!this.canvas || typeof MediaRecorder === 'undefined') {
      const error = 'Bu ortamda video kaydı desteklenmiyor.';
      console.error(error);
      this.onStateChange({ isRecording: false, isFinalizing: false, error });
      return false;
    }

    try {
      this._captureSettingsToken = this.onBeforeCapture({ type: 'video', backgroundMode: this.backgroundMode, backgroundColor: this.backgroundColor });
      this.captureCanvas = this._prepareCaptureCanvas();
      if (typeof this.captureCanvas?.captureStream !== 'function') this.captureCanvas = this.canvas;
      if (typeof this.captureCanvas.captureStream !== 'function') throw new Error('Bu ortamda canvas video kaydı desteklenmiyor.');
      this._drawExportFrame();
      this.stream = this.captureCanvas.captureStream(this.frameRate);
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
      this._recordingLimitExceeded = false;
      const recorder = this.mediaRecorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0 || this._recorderFailed) return;
        const remainingBytes = Math.max(0, this.maxRecordingBytes - this.recordedBytes);
        if (event.data.size > remainingBytes) {
          this._recordingLimitExceeded = true;
          if (this.isRecording) this.stopRecording('size-limit');
          return;
        }
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
            width: this.captureCanvas.width,
            height: this.captureCanvas.height,
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
      this._startCaptureFrameLoop();
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
            width: this.captureCanvas.width,
            height: this.captureCanvas.height,
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
        width: this.captureCanvas.width,
        height: this.captureCanvas.height,
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
    const recordedBytes = this.recordedBytes;
    try {
      if (this._recordingLimitExceeded) {
        this.lastStopReason = this.stopReason;
        this.lastDownloadResult = {
          saved: false,
          error: 'Kayıt boyutu sınırı aşıldı; dosya oluşturulmadı.',
          limitExceeded: true,
        };
        this.onStateChange({
          isRecording: false,
          isFinalizing: false,
          error: this.lastDownloadResult.error,
          stopReason: this.stopReason,
          limitExceeded: true,
          sizeBytes: recordedBytes,
          maxRecordingBytes: this.maxRecordingBytes,
        });
        this._resolveStop(null);
        return;
      }
      const mimeType = recorder.mimeType || this._getSupportedMimeType() || 'video/webm';
      blob = new Blob(this.recordedChunks, { type: mimeType });
      if (blob.size === 0) throw new Error('Video dosyası oluşturulamadı.');
      if (blob.size > this.maxRecordingBytes) {
        this.lastStopReason = this.stopReason;
        this.lastDownloadResult = {
          saved: false,
          error: 'Kayıt boyutu sınırı aşıldı; dosya oluşturulmadı.',
          limitExceeded: true,
        };
        this.onStateChange({
          isRecording: false,
          isFinalizing: false,
          error: this.lastDownloadResult.error,
          stopReason: this.stopReason,
          limitExceeded: true,
          sizeBytes: blob.size,
          maxRecordingBytes: this.maxRecordingBytes,
        });
        this._resolveStop(null);
        return;
      }
      this.recordedChunks = [];
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
        filename: downloadResult.saved || downloadResult.initiated ? filename : undefined,
        downloadResult,
        canceled: downloadResult.canceled || false,
        error: downloadResult.saved || downloadResult.initiated || downloadResult.canceled ? undefined : 'Dosya cihaza kaydedilemedi.',
        blob,
        sizeBytes: recordedBytes,
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
    if (this._captureFrameHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._captureFrameHandle);
    this._captureFrameHandle = null;
    clearInterval(this._captureFrameInterval);
    this._captureFrameInterval = null;
    this.captureCanvas = this.canvas;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop(); } catch { /* Continue releasing the remaining tracks. */ }
      }
      this.stream = null;
    }
    if (this._captureSettingsToken !== null) {
      const token = this._captureSettingsToken;
      this._captureSettingsToken = null;
      try { this.onAfterCapture(token, { type: 'video' }); } catch (error) { console.warn('Export ayarları geri yüklenemedi:', error); }
    }
  }

  getFormattedDuration() {
    const mins = Math.floor(this.recordDurationSeconds / 60).toString().padStart(2, '0');
    const secs = (this.recordDurationSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  async takeScreenshot(customName, onProgress) {
    if (!this.canvas) return { saved: false, error: 'Sahne görüntüsü bulunamadı.' };
    if (this.isRecording || this.isFinalizing || this.isTakingScreenshot) {
      return { saved: false, error: 'Video kaydı sırasında veya başka bir ekran görüntüsü alınırken yeni ekran görüntüsü alınamaz.' };
    }
    this.isTakingScreenshot = true;
    let restoreToken = null;
    try {
      restoreToken = this.onBeforeCapture({ type: 'screenshot', backgroundMode: this.backgroundMode, backgroundColor: this.backgroundColor });
      if (typeof requestAnimationFrame === 'function') await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const outputCanvas = this._prepareCaptureCanvas();
      this.captureCanvas = outputCanvas;
      this._drawExportFrame(outputCanvas);
      const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG görüntüsü oluşturulamadı.');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
      const filename = customName || `diorama_snapshot_${timestamp}.png`;
      return { ...(await saveGeneratedFile(blob, filename, { onProgress })), filename, blob, width: outputCanvas.width, height: outputCanvas.height };
    } catch (error) {
      console.error('Ekran görüntüsü kaydedilemedi:', error);
      return { saved: false, error: error.message || 'Ekran görüntüsü kaydedilemedi.' };
    } finally {
      this.isTakingScreenshot = false;
      this.captureCanvas = this.canvas;
      if (restoreToken !== null) {
        try { this.onAfterCapture(restoreToken, { type: 'screenshot' }); } catch (error) { console.warn('Export arka planı geri yüklenemedi:', error); }
      }
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
      if (downloadResult && !downloadResult.saved && !downloadResult.initiated) {
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
