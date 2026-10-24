/**
 * electron/main.js
 * Windows masaüstü (.exe) ve masaüstü sistemleri için hafif Electron ana süreci.
 * WebGL donanım hızlandırması, monokrom koyu başlık çubuğu ve tam ekran (F11) desteği sunar.
 */

import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. WebGL Donanım Hızlandırmasını (Hardware Acceleration) Garantiye Al
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#080808',
    title: 'Diorama Studio - Monochrome 3D Engine',
    darkTheme: true,
    show: false, // Sayfa render olunca göster (beyaz parlama önleme)
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webgl: true,
      backgroundThrottling: false, // Arka plandayken 60 FPS koru
      },
  });

  // Varsayılan menü çubuğunu gizle
  Menu.setApplicationMenu(null);

  // Geliştirme modu mu, derlenmiş paket mi?
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Pencere hazır olduğunda yumuşakça göster
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // F11 ile Tam Ekran geçişi
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      const isFullScreen = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!isFullScreen);
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const allowedExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'json', 'webm', 'mp4']);

ipcMain.handle('files:save-generated', async (event, file) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Dosya kaydetme isteği uygulama penceresinden gelmedi.');
  }

  const requestedName = typeof file?.filename === 'string' ? file.filename : '';
  const safeName = path.basename(requestedName).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const extension = path.extname(safeName).slice(1).toLowerCase();
  if (!safeName || !allowedExtensions.has(extension)) {
    throw new Error('Bu dosya türünün dışa aktarılmasına izin verilmiyor.');
  }

  let bytes;
  if (file.data instanceof ArrayBuffer) {
    bytes = Buffer.from(file.data);
  } else if (ArrayBuffer.isView(file.data)) {
    bytes = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
  } else {
    throw new Error('Dosya içeriği geçersiz.');
  }

  const typeNames = {
    png: 'PNG Görseli', jpg: 'JPEG Görseli', jpeg: 'JPEG Görseli',
    webp: 'WebP Görseli', json: 'JSON Dosyası', webm: 'WebM Videosu', mp4: 'MP4 Videosu',
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Dışa Aktarılan Dosyayı Kaydet',
    defaultPath: safeName,
    filters: [{ name: typeNames[extension], extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return { saved: false, canceled: true };

  await writeFile(result.filePath, bytes);
  return { saved: true, filename: path.basename(result.filePath), path: result.filePath };
});

// Tekil Uygulama Örneği Kilidi (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
