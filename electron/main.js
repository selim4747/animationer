/**
 * electron/main.js
 * Windows masaüstü (.exe) ve masaüstü sistemleri için hafif Electron ana süreci.
 * WebGL donanım hızlandırması, monokrom koyu başlık çubuğu ve tam ekran (F11) desteği sunar.
 */

import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveGeneratedFileFromRenderer } from './save-generated-file.js';
import { ElectronChunkedSaveSessions } from './save-generated-file-stream.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. WebGL Donanım Hızlandırmasını (Hardware Acceleration) Garantiye Al
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow = null;
const chunkedSaveSessions = new ElectronChunkedSaveSessions();

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
  const rendererContents = mainWindow.webContents;
  rendererContents.once('destroyed', () => { void chunkedSaveSessions.abortForSender(rendererContents); });

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

ipcMain.handle('files:save-generated', (event, file) =>
  saveGeneratedFileFromRenderer(event, file, mainWindow, { dialogApi: dialog }));
ipcMain.handle('files:save-generated-begin', (event, file) =>
  chunkedSaveSessions.begin(event, file, mainWindow, dialog));
ipcMain.handle('files:save-generated-write', (event, sessionId, data) =>
  chunkedSaveSessions.write(event, sessionId, data, mainWindow));
ipcMain.handle('files:save-generated-finish', (event, sessionId) =>
  chunkedSaveSessions.finish(event, sessionId, mainWindow));
ipcMain.handle('files:save-generated-abort', (event, sessionId) =>
  chunkedSaveSessions.abort(event, sessionId, mainWindow));

let cleaningChunkedSaves = false;
app.on('before-quit', (event) => {
  if (cleaningChunkedSaves || chunkedSaveSessions.sessions.size === 0) return;
  event.preventDefault();
  cleaningChunkedSaves = true;
  void chunkedSaveSessions.abortAll().finally(() => {
    cleaningChunkedSaves = false;
    app.quit();
  });
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
