import { randomUUID } from 'node:crypto';
import { open as openFile, rename as renameFile, rm as removeFile } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'json', 'webm', 'mp4']);
const MAX_FILE_BYTES = 140 * 1024 * 1024;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

function validateFile(event, file, mainWindow) {
  if (!mainWindow || event?.sender !== mainWindow.webContents) {
    throw new Error('Dosya kaydetme isteği uygulama penceresinden gelmedi.');
  }
  const requestedName = typeof file?.filename === 'string' ? file.filename : '';
  const safeName = path.basename(requestedName).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const extension = path.extname(safeName).slice(1).toLowerCase();
  if (!safeName || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('Bu dosya türünün dışa aktarılmasına izin verilmiyor.');
  }
  const size = Number(file?.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
    throw new Error(`Dosya boyutu 1–${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MiB arasında olmalıdır.`);
  }
  return { safeName, size };
}

function asBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('Dosya parçası geçersiz.');
}

export class ElectronChunkedSaveSessions {
  constructor({ open = openFile, rename = renameFile, remove = removeFile, idFactory = randomUUID } = {}) {
    this.open = open;
    this.rename = rename;
    this.remove = remove;
    this.idFactory = idFactory;
    this.sessions = new Map();
  }

  _getOwnedSession(event, sessionId, mainWindow) {
    if (!mainWindow || event?.sender !== mainWindow.webContents) {
      throw new Error('Dosya kaydetme isteği uygulama penceresinden gelmedi.');
    }
    const session = this.sessions.get(sessionId);
    if (!session || session.sender !== event.sender) throw new Error('Dosya kaydetme oturumu geçersiz veya süresi dolmuş.');
    return session;
  }

  async begin(event, file, mainWindow, dialogApi) {
    const { safeName, size } = validateFile(event, file, mainWindow);
    const extension = path.extname(safeName).slice(1).toLowerCase();
    const typeNames = {
      png: 'PNG Görseli', jpg: 'JPEG Görseli', jpeg: 'JPEG Görseli',
      webp: 'WebP Görseli', json: 'JSON Dosyası', webm: 'WebM Videosu', mp4: 'MP4 Videosu',
    };
    const result = await dialogApi.showSaveDialog(mainWindow, {
      title: 'Dışa Aktarılan Dosyayı Kaydet',
      defaultPath: safeName,
      filters: [{ name: typeNames[extension], extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, canceled: true };

    const id = this.idFactory();
    const targetPath = result.filePath;
    const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${id}.part`);
    let handle;
    try {
      handle = await this.open(temporaryPath, 'wx');
    } catch (error) {
      throw new Error(`Geçici dosya açılamadı: ${error.message}`);
    }
    this.sessions.set(id, {
      sender: event.sender, handle, size, written: 0,
      targetPath, temporaryPath, filename: path.basename(targetPath),
    });
    return { saved: false, canceled: false, sessionId: id, filename: path.basename(targetPath) };
  }

  async write(event, sessionId, data, mainWindow) {
    const session = this._getOwnedSession(event, sessionId, mainWindow);
    const bytes = asBytes(data);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHUNK_BYTES || session.written + bytes.byteLength > session.size) {
      throw new Error('Dosya parçası boyutu geçersiz veya toplam sınır aşıldı.');
    }
    await session.handle.writeFile(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    session.written += bytes.byteLength;
    return { written: session.written, total: session.size };
  }

  async finish(event, sessionId, mainWindow) {
    const session = this._getOwnedSession(event, sessionId, mainWindow);
    if (session.written !== session.size) {
      throw new Error(`Dosyanın tamamı ulaşmadı (${session.written}/${session.size} bayt).`);
    }
    try {
      await session.handle.sync();
      await session.handle.close();
      await this.rename(session.temporaryPath, session.targetPath);
      this.sessions.delete(sessionId);
      return { saved: true, filename: session.filename, path: session.targetPath };
    } catch (error) {
      this.sessions.delete(sessionId);
      try { await session.handle.close(); } catch { /* Ignore a repeated close. */ }
      try { await this.remove(session.temporaryPath, { force: true }); } catch { /* Preserve the original error. */ }
      throw new Error(`Dışa aktarılan dosya tamamlanamadı: ${error.message}`);
    }
  }

  async abort(event, sessionId, mainWindow) {
    const session = this._getOwnedSession(event, sessionId, mainWindow);
    this.sessions.delete(sessionId);
    try { await session.handle.close(); } catch { /* Session cleanup remains best-effort. */ }
    try { await this.remove(session.temporaryPath, { force: true }); } catch { /* Best-effort cleanup. */ }
    return { aborted: true };
  }

  async abortAll() {
    const entries = [...this.sessions.entries()];
    this.sessions.clear();
    await Promise.all(entries.map(async ([, session]) => {
      try { await session.handle.close(); } catch { /* Best-effort cleanup. */ }
      try { await this.remove(session.temporaryPath, { force: true }); } catch { /* Best-effort cleanup. */ }
    }));
  }

  async abortForSender(sender) {
    const entries = [...this.sessions.entries()].filter(([, session]) => session.sender === sender);
    await Promise.all(entries.map(([sessionId]) => this.abort({ sender }, sessionId, { webContents: sender })));
  }
}
