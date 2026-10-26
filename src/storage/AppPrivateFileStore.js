import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const ROOT = 'Animationer';
const CHUNK_BYTES = 256 * 1024;
const ASSET_CHUNK_BYTES = 512 * 1024;

function encodeBase64(bytes) {
  let binary = '';
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + stride, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeSegment(value) {
  const segment = String(value || 'asset').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100);
  if (!segment || segment === '.' || segment === '..') throw new Error('Dosya yolu geçersiz.');
  return segment;
}

function randomSuffix() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AppPrivateFileStore {
  constructor({ filesystem = Filesystem, directory = Directory.Data, root = ROOT, platform = Capacitor.getPlatform(), native = Capacitor.isNativePlatform() } = {}) {
    this.filesystem = filesystem;
    this.directory = directory;
    this.root = safeSegment(root);
    this.platform = platform;
    this.native = Boolean(native && platform === 'android');
    this.ready = false;
    this.initializing = null;
  }

  get isEnabled() { return this.native; }

  async initialize() {
    if (!this.isEnabled) return false;
    if (this.ready) return true;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      for (const path of [this.root, `${this.root}/projects`, `${this.root}/character-library`, `${this.root}/character-library/2d`, `${this.root}/character-library/3d`, `${this.root}/temporary`]) {
        try {
          await this.filesystem.mkdir({ path, directory: this.directory, recursive: true });
        } catch (error) {
          if (!/exist|already/i.test(String(error?.message || error))) throw error;
        }
      }
      this.ready = true;
      return true;
    })();
    try { return await this.initializing; } finally { this.initializing = null; }
  }

  projectDirectory(projectId) { return `${this.root}/projects/${safeSegment(projectId)}`; }

  async writeBlob(blob, folder, fileName) {
    if (!this.isEnabled) throw new Error('Uygulama özel dosya depolaması bu platformda kullanılamıyor.');
    await this.initialize();
    if (!(typeof Blob !== 'undefined' && blob instanceof Blob) || blob.size < 1) throw new Error('Kaydedilecek dosya boş veya geçersiz.');
    const directory = `${this.root}/${String(folder || '').replace(/^\/+|\/+$/g, '')}`;
    if (!directory.startsWith(`${this.root}/`) || directory.split('/').some((part) => part === '..' || part === '.')) throw new Error('Dosya yolu güvenli kökün dışında.');
    await this.filesystem.mkdir({ path: directory, directory: this.directory, recursive: true });
    const base = safeSegment(fileName || 'asset.bin');
    const target = `${directory}/${Date.now()}-${randomSuffix()}-${base}`;
    const temporary = `${this.root}/temporary/${randomSuffix()}.part`;
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + CHUNK_BYTES, blob.size)).arrayBuffer());
        const data = encodeBase64(bytes);
        if (offset === 0) {
          await this.filesystem.writeFile({ path: temporary, data, directory: this.directory, recursive: true });
        } else {
          await this.filesystem.appendFile({ path: temporary, data, directory: this.directory });
        }
      }
      const result = await this.filesystem.stat({ path: temporary, directory: this.directory });
      if (Number(result.size) !== blob.size) throw new Error(`Dosya doğrulanamadı: beklenen ${blob.size}, yazılan ${result.size} bayt.`);
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const length = Math.min(CHUNK_BYTES, blob.size - offset);
        const read = await this.filesystem.readFile({ path: temporary, directory: this.directory, offset, length });
        if (typeof read.data !== 'string') throw new Error('Geçici dosya doğrulama parçası okunamadı.');
        const writtenBytes = decodeBase64(read.data);
        const originalBytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
        if (writtenBytes.length !== originalBytes.length || writtenBytes.some((byte, index) => byte !== originalBytes[index])) {
          throw new Error(`Dosya doğrulanamadı: ${offset}. bayttan başlayan parça eşleşmiyor.`);
        }
      }
      await this.filesystem.rename({ from: temporary, to: target, directory: this.directory });
      return { storage: 'app-files', path: target, size: blob.size, mimeType: blob.type || 'application/octet-stream' };
    } catch (error) {
      await this.deleteFile(temporary).catch(() => {});
      if (/no space|disk full|storage full|quota exceeded|not enough space/i.test(String(error?.message || error))) {
        throw new Error('Cihaz depolama alanı dolu; önceki proje veya karakter kaydı korundu.');
      }
      throw error;
    }
  }

  async writeJson(folder, name, value) {
    const json = JSON.stringify(value);
    const blob = new Blob([json], { type: 'application/json' });
    return this.writeBlob(blob, folder, name);
  }

  async readJson(path) {
    if (!this._isSafePath(path)) throw new Error('Proje manifesti güvenli olmayan bir yola işaret ediyor.');
    const result = await this.filesystem.readFile({ path, directory: this.directory, encoding: Encoding.UTF8 });
    if (typeof result.data !== 'string') throw new Error('Proje manifesti metin biçiminde okunamadı.');
    return JSON.parse(result.data);
  }

  async readBlob(reference, mimeType = reference?.mimeType) {
    if (!this.isEnabled || reference?.storage !== 'app-files' || !this._isSafePath(reference.path)) {
      throw new Error('Yerel dosya başvurusu geçersiz veya desteklenmiyor.');
    }
    await this.initialize();
    const stat = await this.filesystem.stat({ path: reference.path, directory: this.directory });
    const expectedSize = Number(reference.size || stat.size);
    if (Number(stat.size) !== expectedSize) throw new Error(`Yerel dosya eksik veya bozuk: ${reference.path}`);
    const chunks = [];
    for (let offset = 0; offset < expectedSize; offset += ASSET_CHUNK_BYTES) {
      const length = Math.min(ASSET_CHUNK_BYTES, expectedSize - offset);
      const result = await this.filesystem.readFile({ path: reference.path, directory: this.directory, offset, length });
      if (typeof result.data !== 'string') {
        if (result.data instanceof Blob) return result.data;
        throw new Error('Dosya parçası okunamadı.');
      }
      chunks.push(decodeBase64(result.data));
    }
    const blob = new Blob(chunks, { type: mimeType || 'application/octet-stream' });
    if (blob.size !== expectedSize) throw new Error(`Yerel dosya okuma boyutu uyuşmuyor: ${reference.path}`);
    return blob;
  }

  async deleteFile(path) {
    if (!this.isEnabled || !this._isSafePath(path)) return;
    try { await this.filesystem.deleteFile({ path, directory: this.directory }); } catch (error) {
      if (!/not found|does not exist|no such file/i.test(String(error?.message || error))) throw error;
    }
  }

  async deleteDirectory(path) {
    if (!this.isEnabled || !this._isSafePath(path)) return;
    try { await this.filesystem.rmdir({ path, directory: this.directory, recursive: true }); } catch (error) {
      if (!/not found|does not exist|no such file/i.test(String(error?.message || error))) throw error;
    }
  }

  _isSafePath(path) {
    return typeof path === 'string' && path.startsWith(`${this.root}/`) && !path.split('/').some((part) => part === '..' || part === '.');
  }
}

export const APP_PRIVATE_STORAGE_ROOT = ROOT;
