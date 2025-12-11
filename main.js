const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Path for storing app data
const userDataPath = app.getPath('userData');
const dataFilePath = path.join(userDataPath, 'books-data.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Load saved data
function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const data = fs.readFileSync(dataFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
  return { books: [], settings: { darkMode: true } };
}

// Save data
function saveData(data) {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving data:', error);
    return false;
  }
}

// IPC Handlers
ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('read-pdf-file', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error reading PDF:', error);
    return null;
  }
});

ipcMain.handle('load-data', async () => {
  return loadData();
});

ipcMain.handle('save-data', async (event, data) => {
  return saveData(data);
});

ipcMain.handle('get-file-name', async (event, filePath) => {
  return path.basename(filePath, '.pdf');
});
