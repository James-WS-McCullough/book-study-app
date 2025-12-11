const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const extract = require('extract-zip');

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

// Generate quiz questions using OpenAI
ipcMain.handle('generate-quiz', async (event, { apiKey, text, numQuestions = 5 }) => {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant that generates quiz questions based on provided text. Generate exactly ${numQuestions} multiple-choice questions to test comprehension of the material. Each question should have 4 answer options with exactly one correct answer.`
          },
          {
            role: 'user',
            content: `Based on the following text, generate ${numQuestions} quiz questions:\n\n${text}`
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'quiz_questions',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      question: { type: 'string' },
                      answers: {
                        type: 'array',
                        items: { type: 'string' }
                      },
                      correctIndex: { type: 'integer' }
                    },
                    required: ['question', 'answers', 'correctIndex'],
                    additionalProperties: false
                  }
                }
              },
              required: ['questions'],
              additionalProperties: false
            }
          }
        },
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return { success: true, data: JSON.parse(content) };
  } catch (error) {
    console.error('OpenAI API error:', error);
    return { success: false, error: error.message };
  }
});

// Export library to zip file
ipcMain.handle('export-library', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Library',
    defaultPath: `StudyHub-Backup-${new Date().toISOString().split('T')[0]}.zip`,
    filters: [{ name: 'Zip Files', extensions: ['zip'] }]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, reason: 'cancelled' };
  }

  try {
    const data = loadData();
    const output = fs.createWriteStream(result.filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve({ success: true, path: result.filePath, size: archive.pointer() });
      });

      archive.on('error', (err) => {
        reject({ success: false, error: err.message });
      });

      archive.pipe(output);

      // Add metadata JSON (without coverImage to keep it smaller, covers are separate)
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        books: data.books.map(book => {
          const { coverImage, ...bookWithoutCover } = book;
          return {
            ...bookWithoutCover,
            hasCover: !!coverImage,
            pdfFileName: path.basename(book.filePath)
          };
        }),
        settings: data.settings
      };
      archive.append(JSON.stringify(exportData, null, 2), { name: 'metadata.json' });

      // Add each book's PDF and cover
      for (const book of data.books) {
        const bookId = book.id;

        // Add PDF file if it exists
        if (fs.existsSync(book.filePath)) {
          const pdfFileName = path.basename(book.filePath);
          archive.file(book.filePath, { name: `books/${bookId}/${pdfFileName}` });
        }

        // Add cover image if exists (as base64 text file)
        if (book.coverImage) {
          archive.append(book.coverImage, { name: `books/${bookId}/cover.txt` });
        }
      }

      archive.finalize();
    });
  } catch (error) {
    console.error('Export error:', error);
    return { success: false, error: error.message };
  }
});

// Import library from zip file
ipcMain.handle('import-library', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Library',
    properties: ['openFile'],
    filters: [{ name: 'Zip Files', extensions: ['zip'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, reason: 'cancelled' };
  }

  const zipPath = result.filePaths[0];
  const tempDir = path.join(userDataPath, 'import-temp');
  const importedBooksDir = path.join(userDataPath, 'imported-books');

  try {
    // Clean up temp directory if it exists
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Create imported books directory if it doesn't exist
    if (!fs.existsSync(importedBooksDir)) {
      fs.mkdirSync(importedBooksDir, { recursive: true });
    }

    // Extract zip
    await extract(zipPath, { dir: tempDir });

    // Read metadata
    const metadataPath = path.join(tempDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('Invalid backup file: metadata.json not found');
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    const currentData = loadData();

    // Process each book
    const importedBooks = [];
    for (const bookMeta of metadata.books) {
      const bookDir = path.join(tempDir, 'books', bookMeta.id);

      // Check if book already exists (by title and total pages)
      const existingBook = currentData.books.find(b =>
        b.title === bookMeta.title && b.totalPages === bookMeta.totalPages
      );

      if (existingBook) {
        // Skip duplicate books
        continue;
      }

      // Copy PDF to imported books directory
      const pdfFileName = bookMeta.pdfFileName;
      const sourcePdf = path.join(bookDir, pdfFileName);
      const destPdf = path.join(importedBooksDir, `${bookMeta.id}-${pdfFileName}`);

      if (fs.existsSync(sourcePdf)) {
        fs.copyFileSync(sourcePdf, destPdf);
      } else {
        // PDF not found in backup, skip this book
        continue;
      }

      // Read cover if exists
      let coverImage = null;
      const coverPath = path.join(bookDir, 'cover.txt');
      if (fs.existsSync(coverPath)) {
        coverImage = fs.readFileSync(coverPath, 'utf-8');
      }

      // Create new book entry with updated path
      const newBook = {
        ...bookMeta,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        filePath: destPdf,
        coverImage: coverImage
      };
      delete newBook.hasCover;
      delete newBook.pdfFileName;

      importedBooks.push(newBook);
    }

    // Add imported books to current data
    currentData.books.push(...importedBooks);
    saveData(currentData);

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true });

    return {
      success: true,
      imported: importedBooks.length,
      skipped: metadata.books.length - importedBooks.length
    };
  } catch (error) {
    console.error('Import error:', error);
    // Clean up temp directory on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    return { success: false, error: error.message };
  }
});
