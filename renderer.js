// PDF.js setup
const pdfjsLib = window['pdfjs-dist/build/pdf'] || await import('./node_modules/pdfjs-dist/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = './node_modules/pdfjs-dist/build/pdf.worker.mjs';

// App State
let appData = {
  books: [],
  settings: {}
};

let currentPdf = null;
let currentBook = null;
let currentPageNum = 1;
let totalPages = 0;
let pendingPdfPath = null;
let pendingPdfPageCount = 0;
let currentZoom = 1.0;
let rulerVisible = false;
let textModeVisible = false;
let audioModeVisible = false;
let currentPageText = '';
let speechSynthesis = window.speechSynthesis;
let currentUtterance = null;
let isPlaying = false;
let availableVoices = [];
let configuredVoices = []; // User's configured voices with speeds
let currentVoiceConfig = null; // Currently selected voice config for this page

// Speed reading state
let speedReadingVisible = false;
let speedReadingActive = false;
let speedReadingWPM = 300; // Words per minute (configurable)
let speedReadingWords = [];
let currentWordIndex = 0;
let speedReadingTimer = null;

// Current session's daily goal (loaded from book data)
let todayGoal = null;

// DOM Elements
const elements = {
  // Views
  libraryView: document.getElementById('library-view'),
  progressView: document.getElementById('progress-view'),
  settingsView: document.getElementById('settings-view'),
  readerView: document.getElementById('reader-view'),

  // Navigation
  navBtns: document.querySelectorAll('.nav-btn'),

  // Library
  booksGrid: document.getElementById('books-grid'),
  emptyLibrary: document.getElementById('empty-library'),
  addBookBtn: document.getElementById('addBookBtn'),

  // Progress
  progressList: document.getElementById('progress-list'),
  emptyProgress: document.getElementById('empty-progress'),

  // Reader
  backToLibrary: document.getElementById('backToLibrary'),
  currentBookTitle: document.getElementById('currentBookTitle'),
  readingAssignment: document.getElementById('readingAssignment'),
  readerDarkMode: document.getElementById('readerDarkMode'),
  pdfContainer: document.getElementById('pdf-container'),
  pdfCanvas: document.getElementById('pdf-canvas'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  currentPage: document.getElementById('currentPage'),
  totalPagesEl: document.getElementById('totalPages'),

  // Zoom controls
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  zoomLevel: document.getElementById('zoomLevel'),

  // Reading ruler
  readingRuler: document.getElementById('readingRuler'),
  toggleRulerBtn: document.getElementById('toggleRulerBtn'),

  // Text mode
  toggleTextModeBtn: document.getElementById('toggleTextModeBtn'),
  textModePanel: document.getElementById('textModePanel'),
  extractedText: document.getElementById('extractedText'),

  // Audio mode
  toggleAudioBtn: document.getElementById('toggleAudioBtn'),
  audioControls: document.getElementById('audioControls'),
  audioPlayPauseBtn: document.getElementById('audioPlayPauseBtn'),
  audioPlayIcon: document.getElementById('audioPlayIcon'),
  audioPauseIcon: document.getElementById('audioPauseIcon'),
  audioStopBtn: document.getElementById('audioStopBtn'),
  audioProgressFill: document.getElementById('audioProgressFill'),
  currentVoiceName: document.getElementById('currentVoiceName'),

  // Speed reading mode
  toggleSpeedReadBtn: document.getElementById('toggleSpeedReadBtn'),
  speedReadingPanel: document.getElementById('speedReadingPanel'),
  wordBefore: document.getElementById('wordBefore'),
  wordORP: document.getElementById('wordORP'),
  wordAfter: document.getElementById('wordAfter'),
  speedReadPlayPauseBtn: document.getElementById('speedReadPlayPauseBtn'),
  speedReadPlayIcon: document.getElementById('speedReadPlayIcon'),
  speedReadPauseIcon: document.getElementById('speedReadPauseIcon'),
  speedReadRestartBtn: document.getElementById('speedReadRestartBtn'),
  speedReadProgressFill: document.getElementById('speedReadProgressFill'),
  speedReadWordCount: document.getElementById('speedReadWordCount'),
  wpmDecrease: document.getElementById('wpmDecrease'),
  wpmDisplay: document.getElementById('wpmDisplay'),
  wpmIncrease: document.getElementById('wpmIncrease'),
  speedReadingPreview: document.getElementById('speedReadingPreview'),
  speedReadingPreviewCanvas: document.getElementById('speedReadingPreviewCanvas'),
  previewPageNum: document.getElementById('previewPageNum'),

  // Voice configuration (settings)
  voiceSelectDropdown: document.getElementById('voiceSelectDropdown'),
  addVoiceBtn: document.getElementById('addVoiceBtn'),
  configuredVoicesList: document.getElementById('configured-voices-list'),
  noVoicesMessage: document.getElementById('no-voices-message'),

  // Progress wheel
  dailyProgressWheel: document.getElementById('dailyProgressWheel'),
  progressRingFill: document.getElementById('progressRingFill'),
  dailyProgressText: document.getElementById('dailyProgressText'),

  // Modals
  addBookModal: document.getElementById('addBookModal'),
  dailyCompleteModal: document.getElementById('dailyCompleteModal'),
  selectPdfBtn: document.getElementById('selectPdfBtn'),
  selectedFileName: document.getElementById('selectedFileName'),
  bookTitle: document.getElementById('bookTitle'),
  targetDate: document.getElementById('targetDate'),
  planPreview: document.getElementById('planPreview'),
  planDetails: document.getElementById('planDetails'),
  createPlanBtn: document.getElementById('createPlanBtn'),
  continueReadingBtn: document.getElementById('continueReadingBtn'),
  closeReaderBtn: document.getElementById('closeReaderBtn'),

  // Settings
  booksManagementList: document.getElementById('books-management-list'),
  noBooksMessage: document.getElementById('no-books-message')
};

// Initialize
async function init() {
  appData = await window.electronAPI.loadData();

  // Migrate old book data if needed
  await migrateBookData();

  // Set minimum date to today
  const today = new Date().toISOString().split('T')[0];
  elements.targetDate.min = today;

  setupEventListeners();
  await generateBookCovers();
  renderLibrary();
  renderProgress();
}

// Migrate old book data to new format
async function migrateBookData() {
  let needsSave = false;

  for (const book of appData.books) {
    // Add maxPageReached if not present
    if (book.maxPageReached === undefined) {
      book.maxPageReached = book.currentPage || 0;
      needsSave = true;
    }
    // Ensure dailyGoals object exists
    if (!book.dailyGoals) {
      book.dailyGoals = {};
      needsSave = true;
    }
  }

  if (needsSave) {
    await window.electronAPI.saveData(appData);
  }
}

// Generate cover images for books that don't have them
async function generateBookCovers() {
  let needsSave = false;

  for (const book of appData.books) {
    if (!book.coverImage) {
      try {
        const pdfData = await window.electronAPI.readPdfFile(book.filePath);
        const pdfBytes = Uint8Array.from(atob(pdfData), c => c.charCodeAt(0));
        const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
        const coverImage = await extractCoverImage(pdf);
        if (coverImage) {
          book.coverImage = coverImage;
          needsSave = true;
        }
      } catch (error) {
        console.error('Error generating cover for', book.title, error);
      }
    }
  }

  if (needsSave) {
    await window.electronAPI.saveData(appData);
  }
}

// Extract cover image from first page of PDF
async function extractCoverImage(pdf) {
  try {
    const page = await pdf.getPage(1);

    // Use a reasonable base scale for the cover thumbnail
    const baseViewport = page.getViewport({ scale: 1 });

    // Target a cover width of ~300px for good quality thumbnails
    const targetWidth = 300;
    const baseScale = targetWidth / baseViewport.width;

    // Apply devicePixelRatio for sharper rendering (like the page viewer)
    const renderScale = baseScale * window.devicePixelRatio;
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render with same settings as page viewer
    await page.render({
      canvasContext: ctx,
      viewport: viewport,
      intent: 'display'
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error('Error extracting cover:', error);
    return null;
  }
}

// Event Listeners
function setupEventListeners() {
  // Navigation
  elements.navBtns.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Add Book
  elements.addBookBtn.addEventListener('click', openAddBookModal);
  elements.selectPdfBtn.addEventListener('click', selectPdf);
  elements.targetDate.addEventListener('change', updatePlanPreview);
  elements.createPlanBtn.addEventListener('click', createStudyPlan);

  // Modal close
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeAddBookModal);
  });
  elements.addBookModal.addEventListener('click', (e) => {
    if (e.target === elements.addBookModal) closeAddBookModal();
  });

  // Reader
  elements.backToLibrary.addEventListener('click', () => switchView('library'));
  elements.prevPage.addEventListener('click', () => changePage(-1));
  elements.nextPage.addEventListener('click', () => changePage(1));
  elements.readerDarkMode.addEventListener('click', toggleReaderInvert);

  // Zoom controls
  elements.zoomIn.addEventListener('click', () => changeZoom(0.25));
  elements.zoomOut.addEventListener('click', () => changeZoom(-0.25));

  // Pinch to zoom
  elements.pdfContainer.addEventListener('wheel', handleWheelZoom, { passive: false });

  // Reading ruler
  elements.toggleRulerBtn.addEventListener('click', toggleRuler);
  elements.pdfContainer.addEventListener('mousemove', updateRulerPosition);

  // Text mode
  elements.toggleTextModeBtn.addEventListener('click', toggleTextMode);

  // Audio mode
  elements.toggleAudioBtn.addEventListener('click', toggleAudioMode);
  elements.audioPlayPauseBtn.addEventListener('click', toggleAudioPlayback);
  elements.audioStopBtn.addEventListener('click', stopAudio);

  // Voice configuration
  elements.addVoiceBtn.addEventListener('click', addConfiguredVoice);

  // Speed reading mode
  elements.toggleSpeedReadBtn.addEventListener('click', toggleSpeedReadingMode);
  elements.speedReadPlayPauseBtn.addEventListener('click', toggleSpeedReadingPlayback);
  elements.speedReadRestartBtn.addEventListener('click', restartSpeedReading);
  elements.wpmDecrease.addEventListener('click', decreaseWPM);
  elements.wpmIncrease.addEventListener('click', increaseWPM);
  elements.speedReadingPreview.addEventListener('click', toggleSpeedReadingMode);

  // Load speed reading settings
  loadSpeedReadingSettings();

  // Load available voices
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;

  // Daily complete modal
  elements.continueReadingBtn.addEventListener('click', closeDailyCompleteModal);
  elements.closeReaderBtn.addEventListener('click', () => {
    closeDailyCompleteModal();
    switchView('library');
  });

  // Keyboard navigation
  document.addEventListener('keydown', handleKeyboard);
}

// Handle wheel zoom (pinch-to-zoom on trackpad)
function handleWheelZoom(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    changeZoom(delta);
  }
}

// Update ruler position based on mouse
function updateRulerPosition(e) {
  if (!rulerVisible) return;
  elements.readingRuler.style.top = `${e.clientY}px`;
}

// Toggle reading ruler
function toggleRuler() {
  rulerVisible = !rulerVisible;
  elements.readingRuler.classList.toggle('hidden', !rulerVisible);
  elements.pdfContainer.classList.toggle('ruler-active', rulerVisible);
  elements.toggleRulerBtn.classList.toggle('ruler-active', rulerVisible);
}

// Extract text from current page
async function extractPageText(pageNum) {
  if (!currentPdf) return '';

  try {
    const page = await currentPdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    if (textContent.items.length === 0) return '';

    // Build text with proper line breaks based on position
    let result = '';
    let lastY = null;
    let lastX = null;
    let lastHeight = 12; // Default line height estimate

    for (const item of textContent.items) {
      if (!item.str) continue;

      const y = item.transform[5]; // Y position
      const x = item.transform[4]; // X position
      const height = item.height || lastHeight;

      if (lastY !== null) {
        // Calculate vertical gap
        const yDiff = lastY - y; // PDF coordinates go bottom-up

        // Detect new line (Y changed significantly)
        if (Math.abs(yDiff) > height * 0.5) {
          // Detect paragraph break (larger gap)
          if (Math.abs(yDiff) > height * 1.5) {
            result += '\n\n';
          } else {
            result += '\n';
          }
        } else if (lastX !== null && x > lastX + 5) {
          // Same line but gap between words
          result += ' ';
        }
      }

      result += item.str;
      lastY = y;
      lastX = x + (item.width || 0);
      lastHeight = height;
    }

    // Clean up excessive whitespace while preserving paragraph breaks
    return result
      .replace(/[ \t]+/g, ' ')        // Multiple spaces to single space
      .replace(/\n /g, '\n')          // Remove space after newline
      .replace(/ \n/g, '\n')          // Remove space before newline
      .replace(/\n{3,}/g, '\n\n')     // Max 2 newlines (1 paragraph break)
      .trim();
  } catch (error) {
    console.error('Error extracting text:', error);
    return '';
  }
}

// Toggle text mode
async function toggleTextMode() {
  textModeVisible = !textModeVisible;
  elements.textModePanel.classList.toggle('hidden', !textModeVisible);
  elements.toggleTextModeBtn.classList.toggle('ruler-active', textModeVisible);

  if (textModeVisible) {
    // Extract and display text
    elements.extractedText.textContent = 'Extracting text...';
    currentPageText = await extractPageText(currentPageNum);
    elements.extractedText.textContent = currentPageText || 'No text found on this page.';
  }
}

// Toggle audio mode
async function toggleAudioMode() {
  audioModeVisible = !audioModeVisible;
  elements.audioControls.classList.toggle('hidden', !audioModeVisible);
  elements.toggleAudioBtn.classList.toggle('ruler-active', audioModeVisible);

  if (audioModeVisible) {
    // Extract text if not already done
    if (!currentPageText) {
      currentPageText = await extractPageText(currentPageNum);
    }
  } else {
    // Stop audio when closing audio mode
    stopAudio();
  }
}

// Toggle audio playback
function toggleAudioPlayback() {
  if (isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
}

// Track if we're paused (separate from speechSynthesis.paused which can be unreliable)
let isPaused = false;

// Select a random voice from configured voices
function selectRandomVoice() {
  if (configuredVoices.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * configuredVoices.length);
  const config = configuredVoices[randomIndex];

  // Find the actual voice object
  const voice = availableVoices.find(v => v.name === config.name);
  if (voice) {
    return { voice, speed: config.speed };
  }
  return null;
}

// Play audio
async function playAudio() {
  if (!currentPageText) {
    currentPageText = await extractPageText(currentPageNum);
  }

  if (!currentPageText) {
    return;
  }

  // Check if we have configured voices
  if (configuredVoices.length === 0) {
    alert('Please configure at least one voice in Settings before using audio playback.');
    return;
  }

  // If paused, resume
  if (isPaused && speechSynthesis.paused) {
    speechSynthesis.resume();
    isPlaying = true;
    isPaused = false;
    updatePlayPauseIcon();
    return;
  }

  // Cancel any existing speech first (fixes issue after stop)
  speechSynthesis.cancel();

  // Select random voice if not already selected for this page
  if (!currentVoiceConfig) {
    currentVoiceConfig = selectRandomVoice();
  }

  if (!currentVoiceConfig) {
    alert('No valid voice found. Please check your voice configuration in Settings.');
    return;
  }

  // Create new utterance
  currentUtterance = new SpeechSynthesisUtterance(currentPageText);
  currentUtterance.voice = currentVoiceConfig.voice;
  currentUtterance.rate = currentVoiceConfig.speed;

  // Update UI with current voice name
  const voiceLabel = currentVoiceConfig.voice.name
    .replace('com.apple.voice.compact.', '')
    .replace('com.apple.speech.synthesis.voice.', '');
  elements.currentVoiceName.textContent = voiceLabel;

  // Track progress
  currentUtterance.onboundary = (event) => {
    if (event.name === 'word') {
      const progress = (event.charIndex / currentPageText.length) * 100;
      elements.audioProgressFill.style.width = `${progress}%`;
    }
  };

  currentUtterance.onend = () => {
    isPlaying = false;
    isPaused = false;
    updatePlayPauseIcon();
    elements.audioProgressFill.style.width = '100%';
  };

  currentUtterance.onerror = (event) => {
    // Ignore 'interrupted' errors from cancel()
    if (event.error !== 'interrupted') {
      isPlaying = false;
      isPaused = false;
      updatePlayPauseIcon();
    }
  };

  speechSynthesis.speak(currentUtterance);
  isPlaying = true;
  isPaused = false;
  updatePlayPauseIcon();
}

// Pause audio
function pauseAudio() {
  speechSynthesis.pause();
  isPlaying = false;
  isPaused = true;
  updatePlayPauseIcon();
}

// Stop audio
function stopAudio() {
  speechSynthesis.cancel();
  isPlaying = false;
  isPaused = false;
  currentUtterance = null;
  elements.audioProgressFill.style.width = '0%';
  updatePlayPauseIcon();
}

// Update play/pause icon
function updatePlayPauseIcon() {
  elements.audioPlayIcon.classList.toggle('hidden', isPlaying);
  elements.audioPauseIcon.classList.toggle('hidden', !isPlaying);
}

// ===== SPEED READING MODE =====

// Calculate Optimal Recognition Point (ORP) for a word
// Based on Spritz/RSVP research: ORP is slightly left of center
// Typically around 30-35% from the start for optimal recognition
function calculateORP(word) {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4; // For very long words
}

// Calculate display duration for a word based on WPM and word characteristics
function calculateWordDuration(word) {
  const baseInterval = 60000 / speedReadingWPM; // Base ms per word

  // Add extra time for punctuation (sentence/clause endings)
  const punctuationDelay = /[.!?]$/.test(word) ? baseInterval * 0.8 :
                           /[,;:]$/.test(word) ? baseInterval * 0.3 : 0;

  // Add slight delay for longer words
  const lengthBonus = word.length > 8 ? baseInterval * 0.2 : 0;

  return baseInterval + punctuationDelay + lengthBonus;
}

// Display a word with ORP highlighting and proper alignment
function displayWord(word) {
  const wordElement = document.getElementById('speedReadingWord');

  if (!word) {
    elements.wordBefore.textContent = '';
    elements.wordORP.textContent = '';
    elements.wordAfter.textContent = '';
    wordElement.style.left = '50%';
    wordElement.style.transform = 'translateX(-50%)';
    return;
  }

  const orpIndex = calculateORP(word);

  elements.wordBefore.textContent = word.substring(0, orpIndex);
  elements.wordORP.textContent = word.charAt(orpIndex);
  elements.wordAfter.textContent = word.substring(orpIndex + 1);

  // After setting content, calculate offset to center the ORP character
  // Use requestAnimationFrame to ensure DOM has updated
  requestAnimationFrame(() => {
    const orpElement = elements.wordORP;
    const wordRect = wordElement.getBoundingClientRect();
    const orpRect = orpElement.getBoundingClientRect();

    // Calculate where ORP center is relative to word element
    const orpCenterInWord = (orpRect.left - wordRect.left) + (orpRect.width / 2);
    const wordWidth = wordRect.width;

    // We want orpCenterInWord to be at 50% of container
    // So we offset by: 50% - orpCenterInWord
    const container = wordElement.parentElement;
    const containerWidth = container.getBoundingClientRect().width;
    const targetCenter = containerWidth / 2;

    // Set position so ORP aligns with center
    wordElement.style.left = `${targetCenter - orpCenterInWord}px`;
    wordElement.style.transform = 'none';
  });
}

// Update speed reading progress
function updateSpeedReadingProgress() {
  const total = speedReadingWords.length;
  const current = currentWordIndex;
  const percent = total > 0 ? (current / total) * 100 : 0;

  elements.speedReadProgressFill.style.width = `${percent}%`;
  elements.speedReadWordCount.textContent = `${current} / ${total}`;
}

// Toggle speed reading mode visibility
async function toggleSpeedReadingMode() {
  speedReadingVisible = !speedReadingVisible;
  elements.speedReadingPanel.classList.toggle('hidden', !speedReadingVisible);
  elements.toggleSpeedReadBtn.classList.toggle('ruler-active', speedReadingVisible);

  if (speedReadingVisible) {
    // Extract text if not already done
    if (!currentPageText) {
      currentPageText = await extractPageText(currentPageNum);
    }

    // Parse text into words
    speedReadingWords = currentPageText
      .split(/\s+/)
      .filter(word => word.length > 0);

    currentWordIndex = 0;
    speedReadingActive = false;

    // Display first word
    if (speedReadingWords.length > 0) {
      displayWord(speedReadingWords[0]);
    } else {
      displayWord('');
      elements.wordORP.textContent = 'No text';
    }

    updateSpeedReadingProgress();
    updateSpeedReadPlayPauseIcon();

    // Render page preview thumbnail
    renderSpeedReadingPreview();
  } else {
    // Stop playback when closing
    stopSpeedReading();
  }
}

// Toggle speed reading playback
function toggleSpeedReadingPlayback() {
  if (speedReadingActive) {
    pauseSpeedReading();
  } else {
    startSpeedReading();
  }
}

// Start speed reading
function startSpeedReading() {
  if (speedReadingWords.length === 0) return;
  if (currentWordIndex >= speedReadingWords.length) {
    // Restart if at end
    currentWordIndex = 0;
  }

  speedReadingActive = true;
  updateSpeedReadPlayPauseIcon();
  scheduleNextWord();
}

// Pause speed reading
function pauseSpeedReading() {
  speedReadingActive = false;
  if (speedReadingTimer) {
    clearTimeout(speedReadingTimer);
    speedReadingTimer = null;
  }
  updateSpeedReadPlayPauseIcon();
}

// Stop speed reading completely
function stopSpeedReading() {
  speedReadingActive = false;
  if (speedReadingTimer) {
    clearTimeout(speedReadingTimer);
    speedReadingTimer = null;
  }
  updateSpeedReadPlayPauseIcon();
}

// Restart speed reading from beginning
function restartSpeedReading() {
  pauseSpeedReading();
  currentWordIndex = 0;
  if (speedReadingWords.length > 0) {
    displayWord(speedReadingWords[0]);
  }
  updateSpeedReadingProgress();
}

// Schedule the next word display
function scheduleNextWord() {
  if (!speedReadingActive || currentWordIndex >= speedReadingWords.length) {
    if (currentWordIndex >= speedReadingWords.length) {
      // Reached end
      speedReadingActive = false;
      updateSpeedReadPlayPauseIcon();
    }
    return;
  }

  const word = speedReadingWords[currentWordIndex];
  displayWord(word);
  updateSpeedReadingProgress();

  const duration = calculateWordDuration(word);
  currentWordIndex++;

  speedReadingTimer = setTimeout(scheduleNextWord, duration);
}

// Update play/pause icon
function updateSpeedReadPlayPauseIcon() {
  elements.speedReadPlayIcon.classList.toggle('hidden', speedReadingActive);
  elements.speedReadPauseIcon.classList.toggle('hidden', !speedReadingActive);
}

// Update WPM display
function updateWPMDisplay() {
  elements.wpmDisplay.textContent = `${speedReadingWPM} WPM`;
  // Save to localStorage
  localStorage.setItem('speedReadingWPM', speedReadingWPM.toString());
}

// Increase WPM
function increaseWPM() {
  speedReadingWPM = Math.min(1000, speedReadingWPM + 50);
  updateWPMDisplay();
}

// Decrease WPM
function decreaseWPM() {
  speedReadingWPM = Math.max(50, speedReadingWPM - 50);
  updateWPMDisplay();
}

// Load saved WPM setting
function loadSpeedReadingSettings() {
  const savedWPM = localStorage.getItem('speedReadingWPM');
  if (savedWPM) {
    speedReadingWPM = parseInt(savedWPM, 10);
    updateWPMDisplay();
  }
}

// Render page preview thumbnail for speed reading mode
async function renderSpeedReadingPreview() {
  if (!currentPdf) return;

  const page = await currentPdf.getPage(currentPageNum);
  const canvas = elements.speedReadingPreviewCanvas;
  const ctx = canvas.getContext('2d');

  // Target width for thumbnail
  const targetWidth = 134; // 150px container - 16px padding
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  await page.render({
    canvasContext: ctx,
    viewport: scaledViewport
  }).promise;

  elements.previewPageNum.textContent = currentPageNum;
}

// Load available voices
function loadVoices() {
  const allVoices = speechSynthesis.getVoices();

  if (allVoices.length === 0) return;

  // Filter for English voices and sort by quality
  const englishVoices = allVoices.filter(v => v.lang.startsWith('en'));

  // Prioritize premium/enhanced voices
  availableVoices = englishVoices.sort((a, b) => {
    const premiumKeywords = ['Premium', 'Enhanced', 'Neural', 'Siri'];
    const aIsPremium = premiumKeywords.some(k => a.name.includes(k));
    const bIsPremium = premiumKeywords.some(k => b.name.includes(k));

    if (aIsPremium && !bIsPremium) return -1;
    if (!aIsPremium && bIsPremium) return 1;

    if (a.localService && !b.localService) return -1;
    if (!a.localService && b.localService) return 1;

    return a.name.localeCompare(b.name);
  });

  // Populate settings dropdown
  populateVoiceDropdown();

  // Load saved voice configurations
  loadConfiguredVoices();
}

// Populate voice dropdown in settings
function populateVoiceDropdown() {
  elements.voiceSelectDropdown.innerHTML = '';

  availableVoices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = voice.name;

    const premiumKeywords = ['Premium', 'Enhanced', 'Neural', 'Siri'];
    const isPremium = premiumKeywords.some(k => voice.name.includes(k));
    const label = voice.name
      .replace('com.apple.voice.compact.', '')
      .replace('com.apple.speech.synthesis.voice.', '');
    option.textContent = isPremium ? `★ ${label}` : label;

    elements.voiceSelectDropdown.appendChild(option);
  });
}

// Load configured voices from localStorage
function loadConfiguredVoices() {
  const saved = localStorage.getItem('configuredVoices');
  if (saved) {
    configuredVoices = JSON.parse(saved);
  }
  renderConfiguredVoices();
}

// Save configured voices to localStorage
function saveConfiguredVoices() {
  localStorage.setItem('configuredVoices', JSON.stringify(configuredVoices));
}

// Add a new configured voice
function addConfiguredVoice() {
  const voiceName = elements.voiceSelectDropdown.value;
  if (!voiceName) return;

  // Check if already configured
  if (configuredVoices.some(v => v.name === voiceName)) {
    alert('This voice is already in your list.');
    return;
  }

  configuredVoices.push({
    name: voiceName,
    speed: 1.0
  });

  saveConfiguredVoices();
  renderConfiguredVoices();
}

// Remove a configured voice
function removeConfiguredVoice(voiceName) {
  configuredVoices = configuredVoices.filter(v => v.name !== voiceName);
  saveConfiguredVoices();
  renderConfiguredVoices();
}

// Update speed for a configured voice
function updateVoiceSpeed(voiceName, speed) {
  const config = configuredVoices.find(v => v.name === voiceName);
  if (config) {
    config.speed = speed;
    saveConfiguredVoices();
  }
}

// Test a voice with a sample sentence
function testVoice(voiceName, speed) {
  const voice = availableVoices.find(v => v.name === voiceName);
  if (!voice) return;

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  const testSentences = [
    "The quick brown fox jumps over the lazy dog.",
    "Reading is a wonderful way to expand your mind.",
    "Welcome to Study Hub, your personal reading companion.",
    "Knowledge is power, and books are the key.",
    "Every page you read brings you closer to your goal."
  ];

  const sentence = testSentences[Math.floor(Math.random() * testSentences.length)];

  const utterance = new SpeechSynthesisUtterance(sentence);
  utterance.voice = voice;
  utterance.rate = speed;

  speechSynthesis.speak(utterance);
}

// Render configured voices list
function renderConfiguredVoices() {
  elements.configuredVoicesList.innerHTML = '';

  if (configuredVoices.length === 0) {
    elements.noVoicesMessage.classList.remove('hidden');
    elements.configuredVoicesList.classList.add('hidden');
    return;
  }

  elements.noVoicesMessage.classList.add('hidden');
  elements.configuredVoicesList.classList.remove('hidden');

  configuredVoices.forEach(config => {
    const voice = availableVoices.find(v => v.name === config.name);
    if (!voice) return;

    const item = document.createElement('div');
    item.className = 'voice-config-item';

    const label = voice.name
      .replace('com.apple.voice.compact.', '')
      .replace('com.apple.speech.synthesis.voice.', '');

    const premiumKeywords = ['Premium', 'Enhanced', 'Neural', 'Siri'];
    const isPremium = premiumKeywords.some(k => voice.name.includes(k));

    item.innerHTML = `
      <div class="voice-config-info">
        <h4>${isPremium ? '★ ' : ''}${label}</h4>
        <span class="voice-lang">${voice.lang}</span>
      </div>
      <div class="voice-config-speed">
        <label>Speed:</label>
        <input type="range" min="0.5" max="2" step="0.1" value="${config.speed}" data-voice="${config.name}">
        <span class="speed-value">${config.speed}x</span>
      </div>
      <button class="test-voice-btn" data-voice="${config.name}" title="Test voice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
      <button class="delete-btn" data-voice="${config.name}">Remove</button>
    `;

    // Add event listeners
    const slider = item.querySelector('input[type="range"]');
    const speedValue = item.querySelector('.speed-value');
    slider.addEventListener('input', (e) => {
      const speed = parseFloat(e.target.value);
      speedValue.textContent = `${speed}x`;
      updateVoiceSpeed(config.name, speed);
    });

    const testBtn = item.querySelector('.test-voice-btn');
    testBtn.addEventListener('click', () => testVoice(config.name, config.speed));

    const deleteBtn = item.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => removeConfiguredVoice(config.name));

    elements.configuredVoicesList.appendChild(item);
  });
}

// Zoom functions
function changeZoom(delta) {
  const newZoom = Math.max(0.5, Math.min(3.0, currentZoom + delta));
  if (Math.abs(newZoom - currentZoom) > 0.01) {
    currentZoom = newZoom;
    elements.zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
    renderPage(currentPageNum);
  }
}

// View Switching
function switchView(viewName) {
  // Update nav buttons
  elements.navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Update views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });

  // Hide ruler and reset modes when leaving reader
  if (viewName !== 'reader') {
    rulerVisible = false;
    elements.readingRuler.classList.add('hidden');
    elements.pdfContainer.classList.remove('ruler-active');
    elements.toggleRulerBtn.classList.remove('ruler-active');

    // Reset text mode
    textModeVisible = false;
    elements.textModePanel.classList.add('hidden');
    elements.toggleTextModeBtn.classList.remove('ruler-active');

    // Reset audio mode
    stopAudio();
    audioModeVisible = false;
    elements.audioControls.classList.add('hidden');
    elements.toggleAudioBtn.classList.remove('ruler-active');

    // Reset speed reading mode
    stopSpeedReading();
    speedReadingVisible = false;
    elements.speedReadingPanel.classList.add('hidden');
    elements.toggleSpeedReadBtn.classList.remove('ruler-active');
  }

  if (viewName === 'library') {
    elements.libraryView.classList.add('active');
    renderLibrary();
  } else if (viewName === 'progress') {
    elements.progressView.classList.add('active');
    renderProgress();
  } else if (viewName === 'settings') {
    elements.settingsView.classList.add('active');
    renderSettings();
  } else if (viewName === 'reader') {
    elements.readerView.classList.add('active');
  }
}

// Library Rendering
function renderLibrary() {
  elements.booksGrid.innerHTML = '';

  if (appData.books.length === 0) {
    elements.emptyLibrary.classList.remove('hidden');
    return;
  }

  elements.emptyLibrary.classList.add('hidden');

  appData.books.forEach(book => {
    const card = createBookCard(book);
    elements.booksGrid.appendChild(card);
  });
}

function createBookCard(book) {
  const card = document.createElement('div');
  card.className = 'book-card';
  card.addEventListener('click', () => openReader(book));

  const progress = calculateProgress(book);
  const goal = getOrCreateDailyGoal(book);
  const todayComplete = goal ? book.maxPageReached >= goal.endPage : false;

  let statusBadge = '';
  if (todayComplete) {
    statusBadge = '<div class="today-complete">Today\'s reading complete</div>';
  } else if (goal) {
    const isOverdue = goal.startPage > 1 && book.maxPageReached < goal.startPage - 1;
    statusBadge = `<div class="due-today ${isOverdue ? 'overdue' : ''}">${isOverdue ? 'Behind schedule' : "Today's reading"}</div>`;
  }

  // Check for valid cover image (must be a data URL with actual content)
  const hasValidCover = book.coverImage && book.coverImage.startsWith('data:image');
  const coverHtml = hasValidCover
    ? `<img src="${book.coverImage}" alt="${book.title} cover" onerror="this.parentElement.innerHTML='<svg class=\\'no-cover-icon\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path d=\\'M4 19.5A2.5 2.5 0 0 1 6.5 17H20\\'></path><path d=\\'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z\\'></path></svg>'">`
    : `<svg class="no-cover-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;

  card.innerHTML = `
    <div class="book-cover">${coverHtml}</div>
    <div class="book-info">
      <h4 title="${book.title}">${book.title}</h4>
      <div class="book-meta">${book.totalPages} pages • ~${getPagesPerDay(book)}/day</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress.percent}%"></div>
      </div>
      <div class="progress-text">${progress.percent}% complete</div>
      ${statusBadge}
    </div>
  `;

  return card;
}

// Progress Rendering
function renderProgress() {
  elements.progressList.innerHTML = '';

  if (appData.books.length === 0) {
    elements.emptyProgress.classList.remove('hidden');
    return;
  }

  elements.emptyProgress.classList.add('hidden');

  appData.books.forEach(book => {
    const card = createProgressCard(book);
    elements.progressList.appendChild(card);
  });
}

function createProgressCard(book) {
  const card = document.createElement('div');
  card.className = 'progress-card';

  const progress = calculateProgress(book);
  const daysLeft = Math.max(0, getDaysUntil(book.targetDate));
  const pagesLeft = book.totalPages - book.maxPageReached;
  const pagesPerDay = getPagesPerDay(book);

  card.innerHTML = `
    <div class="progress-card-header">
      <div>
        <h4>${book.title}</h4>
        <div class="target-date">Target: ${formatDate(book.targetDate)}</div>
      </div>
    </div>
    <div class="progress-stats">
      <div class="stat">
        <span class="stat-value">${progress.percent}%</span>
        <span class="stat-label">Complete</span>
      </div>
      <div class="stat">
        <span class="stat-value">${book.maxPageReached}</span>
        <span class="stat-label">Pages Read</span>
      </div>
      <div class="stat">
        <span class="stat-value">${pagesLeft}</span>
        <span class="stat-label">Pages Left</span>
      </div>
      <div class="stat">
        <span class="stat-value">${pagesPerDay}</span>
        <span class="stat-label">Pages/Day</span>
      </div>
    </div>
    <div class="large-progress-bar">
      <div class="progress-fill" style="width: ${progress.percent}%"></div>
    </div>
  `;

  return card;
}

// Settings Rendering
function renderSettings() {
  elements.booksManagementList.innerHTML = '';

  if (appData.books.length === 0) {
    elements.noBooksMessage.classList.remove('hidden');
    return;
  }

  elements.noBooksMessage.classList.add('hidden');

  appData.books.forEach(book => {
    const item = createBookManagementItem(book);
    elements.booksManagementList.appendChild(item);
  });
}

function createBookManagementItem(book) {
  const item = document.createElement('div');
  item.className = 'book-management-item';

  const progress = calculateProgress(book);

  item.innerHTML = `
    <div class="book-management-info">
      <h4 title="${book.title}">${book.title}</h4>
      <span>${book.totalPages} pages • ${progress.percent}% complete</span>
    </div>
    <div class="book-management-actions">
      <button class="regen-cover-btn" data-book-id="${book.id}">Regenerate Cover</button>
      <button class="delete-btn" data-book-id="${book.id}">Remove</button>
    </div>
  `;

  // Add event listeners
  const regenBtn = item.querySelector('.regen-cover-btn');
  regenBtn.addEventListener('click', () => regenerateCover(book.id));

  const deleteBtn = item.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', () => removeBook(book.id));

  return item;
}

async function regenerateCover(bookId) {
  const book = appData.books.find(b => b.id === bookId);
  if (!book) return;

  // Find the button and show loading state
  const btn = document.querySelector(`.regen-cover-btn[data-book-id="${bookId}"]`);
  const originalText = btn.textContent;
  btn.textContent = 'Regenerating...';
  btn.disabled = true;

  try {
    const pdfData = await window.electronAPI.readPdfFile(book.filePath);
    const pdfBytes = Uint8Array.from(atob(pdfData), c => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const coverImage = await extractCoverImage(pdf);

    if (coverImage) {
      book.coverImage = coverImage;
      await window.electronAPI.saveData(appData);
      renderLibrary();
    }
  } catch (error) {
    console.error('Error regenerating cover:', error);
    alert('Failed to regenerate cover. The file may have been moved or deleted.');
  }

  btn.textContent = originalText;
  btn.disabled = false;
}

async function removeBook(bookId) {
  const book = appData.books.find(b => b.id === bookId);
  if (!book) return;

  const confirmed = confirm(`Are you sure you want to remove "${book.title}"? This will delete all reading progress.`);
  if (!confirmed) return;

  appData.books = appData.books.filter(b => b.id !== bookId);
  await window.electronAPI.saveData(appData);

  renderSettings();
  renderLibrary();
  renderProgress();
}

// Modal Functions
function openAddBookModal() {
  resetAddBookModal();
  elements.addBookModal.classList.add('active');
}

function closeAddBookModal() {
  elements.addBookModal.classList.remove('active');
  resetAddBookModal();
}

function resetAddBookModal() {
  pendingPdfPath = null;
  pendingPdfPageCount = 0;
  elements.selectedFileName.textContent = 'Choose a PDF file...';
  elements.selectPdfBtn.classList.remove('selected');
  elements.bookTitle.value = '';
  elements.targetDate.value = '';
  elements.planPreview.classList.add('hidden');
  elements.createPlanBtn.disabled = true;
}

function showDailyCompleteModal() {
  elements.dailyCompleteModal.classList.add('active');
}

function closeDailyCompleteModal() {
  elements.dailyCompleteModal.classList.remove('active');
}

let pendingPdf = null;

async function selectPdf() {
  const filePath = await window.electronAPI.selectPdf();
  if (!filePath) return;

  pendingPdfPath = filePath;
  const fileName = await window.electronAPI.getFileName(filePath);
  elements.selectedFileName.textContent = fileName + '.pdf';
  elements.selectPdfBtn.classList.add('selected');
  elements.bookTitle.value = fileName;

  // Get page count
  try {
    const pdfData = await window.electronAPI.readPdfFile(filePath);
    const pdfBytes = Uint8Array.from(atob(pdfData), c => c.charCodeAt(0));
    pendingPdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    pendingPdfPageCount = pendingPdf.numPages;
    updatePlanPreview();
  } catch (error) {
    console.error('Error reading PDF:', error);
  }
}

function updatePlanPreview() {
  if (!pendingPdfPath || !pendingPdfPageCount || !elements.targetDate.value) {
    elements.planPreview.classList.add('hidden');
    elements.createPlanBtn.disabled = true;
    return;
  }

  const daysUntil = getDaysUntil(elements.targetDate.value);
  if (daysUntil <= 0) {
    elements.planDetails.textContent = 'Please select a future date.';
    elements.planPreview.classList.remove('hidden');
    elements.createPlanBtn.disabled = true;
    return;
  }

  const pagesPerDay = Math.ceil(pendingPdfPageCount / daysUntil);

  elements.planDetails.innerHTML = `
    <strong>${pendingPdfPageCount} pages</strong> over <strong>${daysUntil} days</strong><br>
    Daily reading: <strong>~${pagesPerDay} pages/day</strong>
  `;
  elements.planPreview.classList.remove('hidden');
  elements.createPlanBtn.disabled = false;
}

async function createStudyPlan() {
  if (!pendingPdfPath || !elements.bookTitle.value || !elements.targetDate.value) return;

  // Extract cover image
  let coverImage = null;
  if (pendingPdf) {
    coverImage = await extractCoverImage(pendingPdf);
  }

  const book = {
    id: Date.now().toString(),
    title: elements.bookTitle.value,
    filePath: pendingPdfPath,
    totalPages: pendingPdfPageCount,
    currentPage: 1,
    maxPageReached: 0,
    targetDate: elements.targetDate.value,
    startDate: new Date().toISOString().split('T')[0],
    completedDays: [],
    dailyGoals: {},
    coverImage: coverImage
  };

  appData.books.push(book);
  await window.electronAPI.saveData(appData);

  pendingPdf = null;
  closeAddBookModal();
  renderLibrary();
  renderProgress();
}

// Get or create the daily goal for a book
// Goals are stored per-date and only regenerated for new days
function getOrCreateDailyGoal(book) {
  const today = new Date().toISOString().split('T')[0];

  // If book is finished, no goal
  if (book.maxPageReached >= book.totalPages) {
    return null;
  }

  // Check if we already have a goal for today
  if (book.dailyGoals && book.dailyGoals[today]) {
    return book.dailyGoals[today];
  }

  // Generate new goal for today based on maxPageReached
  const targetDate = new Date(book.targetDate);
  const todayDate = new Date(today);
  targetDate.setHours(0, 0, 0, 0);
  todayDate.setHours(0, 0, 0, 0);

  const daysLeft = Math.max(1, Math.ceil((targetDate - todayDate) / (1000 * 60 * 60 * 24)));
  const pagesLeft = book.totalPages - book.maxPageReached;
  const pagesPerDay = Math.ceil(pagesLeft / daysLeft);

  const startPage = book.maxPageReached + 1;
  const endPage = Math.min(book.maxPageReached + pagesPerDay, book.totalPages);

  const goal = { startPage, endPage, date: today };

  // Store the goal (will be saved when book is saved)
  if (!book.dailyGoals) {
    book.dailyGoals = {};
  }
  book.dailyGoals[today] = goal;

  return goal;
}

// Reader Functions
async function openReader(book) {
  currentBook = book;
  elements.currentBookTitle.textContent = book.title;

  // Reset zoom
  currentZoom = 1.0;
  elements.zoomLevel.textContent = '100%';

  try {
    const pdfData = await window.electronAPI.readPdfFile(book.filePath);
    const pdfBytes = Uint8Array.from(atob(pdfData), c => c.charCodeAt(0));
    currentPdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    totalPages = currentPdf.numPages;

    elements.totalPagesEl.textContent = totalPages;

    // Get or create today's goal
    todayGoal = getOrCreateDailyGoal(book);

    // Save immediately if we created a new goal
    await saveProgress();

    // Resume from saved page position
    currentPageNum = Math.max(1, Math.min(book.currentPage || 1, totalPages));

    updateReadingAssignment();
    updateDailyProgressWheel();

    // Switch view first so container has dimensions, then render
    switchView('reader');

    // Wait for layout to complete before rendering
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renderPage(currentPageNum);
      });
    });
  } catch (error) {
    console.error('Error opening PDF:', error);
    alert('Error opening PDF file. The file may have been moved or deleted.');
  }
}

async function renderPage(num) {
  if (!currentPdf) return;

  const page = await currentPdf.getPage(num);
  const canvas = elements.pdfCanvas;
  const ctx = canvas.getContext('2d');

  // Calculate scale to fit container with zoom applied
  const containerWidth = elements.pdfContainer.clientWidth - 40;
  const containerHeight = elements.pdfContainer.clientHeight - 40;
  const viewport = page.getViewport({ scale: 1 });

  const scaleX = containerWidth / viewport.width;
  const scaleY = containerHeight / viewport.height;
  const baseScale = Math.min(scaleX, scaleY);
  const displayScale = baseScale * currentZoom;

  // Use higher resolution for sharper rendering
  const renderScale = displayScale * window.devicePixelRatio;
  const scaledViewport = page.getViewport({ scale: renderScale });

  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  // Scale canvas display size
  canvas.style.width = `${scaledViewport.width / window.devicePixelRatio}px`;
  canvas.style.height = `${scaledViewport.height / window.devicePixelRatio}px`;

  // Render with higher quality settings
  await page.render({
    canvasContext: ctx,
    viewport: scaledViewport,
    intent: 'display'
  }).promise;

  elements.currentPage.textContent = num;
  updateNavButtons();
}

function updateNavButtons() {
  elements.prevPage.disabled = currentPageNum <= 1;
  elements.nextPage.disabled = currentPageNum >= totalPages;
}

function updateReadingAssignment() {
  if (todayGoal) {
    elements.readingAssignment.textContent = `Today: pages ${todayGoal.startPage}-${todayGoal.endPage}`;
  } else {
    elements.readingAssignment.textContent = 'Book complete!';
  }
}

function updateDailyProgressWheel() {
  if (!todayGoal || !currentBook) {
    elements.dailyProgressWheel.classList.add('complete');
    elements.progressRingFill.setAttribute('stroke-dasharray', '100, 100');
    elements.dailyProgressText.textContent = '100%';
    return;
  }

  const totalPagesForToday = todayGoal.endPage - todayGoal.startPage + 1;
  const pagesReadToday = Math.max(0, Math.min(currentBook.maxPageReached - todayGoal.startPage + 1, totalPagesForToday));
  const percentComplete = Math.min(100, Math.round((pagesReadToday / totalPagesForToday) * 100));

  elements.progressRingFill.setAttribute('stroke-dasharray', `${percentComplete}, 100`);
  elements.dailyProgressText.textContent = `${percentComplete}%`;

  if (percentComplete >= 100) {
    elements.dailyProgressWheel.classList.add('complete');
  } else {
    elements.dailyProgressWheel.classList.remove('complete');
  }
}

async function changePage(delta) {
  const newPage = currentPageNum + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPageNum = newPage;
    await renderPage(currentPageNum);

    // Reset scroll to top when changing pages
    elements.pdfContainer.scrollTo(0, 0);

    // Clear cached text and stop audio when changing pages
    currentPageText = '';
    currentVoiceConfig = null; // Reset so a new random voice is selected
    stopAudio();
    stopSpeedReading();

    // Update text mode if visible
    if (textModeVisible) {
      elements.extractedText.textContent = 'Extracting text...';
      currentPageText = await extractPageText(currentPageNum);
      elements.extractedText.textContent = currentPageText || 'No text found on this page.';
    }

    // Update speed reading mode if visible
    if (speedReadingVisible) {
      currentPageText = await extractPageText(currentPageNum);
      speedReadingWords = currentPageText
        .split(/\s+/)
        .filter(word => word.length > 0);
      currentWordIndex = 0;
      if (speedReadingWords.length > 0) {
        displayWord(speedReadingWords[0]);
      }
      updateSpeedReadingProgress();
      renderSpeedReadingPreview();
    }

    // Update current page (for resume)
    currentBook.currentPage = currentPageNum;

    // Update max page reached if we went further
    const previousMax = currentBook.maxPageReached || 0;
    if (currentPageNum > previousMax) {
      currentBook.maxPageReached = currentPageNum;
    }

    await saveProgress();
    updateDailyProgressWheel();

    // Check if daily reading is complete (reached end page of goal)
    if (todayGoal && currentBook.maxPageReached >= todayGoal.endPage) {
      // Check if this is the first time reaching the goal
      const today = new Date().toISOString().split('T')[0];
      if (!currentBook.completedDays.includes(today)) {
        currentBook.completedDays.push(today);
        await saveProgress();
        showDailyCompleteModal();
      }
    }
  }
}

function toggleReaderInvert() {
  elements.pdfContainer.classList.toggle('inverted');
}

async function saveProgress() {
  if (!currentBook) return;

  const bookIndex = appData.books.findIndex(b => b.id === currentBook.id);
  if (bookIndex !== -1) {
    appData.books[bookIndex] = currentBook;
    await window.electronAPI.saveData(appData);
  }
}

// Utility Functions
function calculateProgress(book) {
  const maxPage = book.maxPageReached || 0;
  const percent = Math.round((maxPage / book.totalPages) * 100);
  return { percent: Math.min(percent, 100) };
}

// Dynamic calculation based on remaining pages and days
function getPagesPerDay(book) {
  const maxPage = book.maxPageReached || 0;
  const pagesLeft = book.totalPages - maxPage;
  const daysLeft = Math.max(1, getDaysUntil(book.targetDate));

  if (pagesLeft <= 0) return 0;
  return Math.ceil(pagesLeft / daysLeft);
}

function getDaysUntil(dateStr) {
  const target = new Date(dateStr);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function handleKeyboard(e) {
  // Don't navigate if modal is open
  if (elements.dailyCompleteModal.classList.contains('active')) return;
  if (elements.addBookModal.classList.contains('active')) return;
  if (!elements.readerView.classList.contains('active')) return;

  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    changePage(-1);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
    e.preventDefault();
    changePage(1);
  } else if (e.key === 'r' || e.key === 'R') {
    toggleRuler();
  } else if (e.key === 't' || e.key === 'T') {
    toggleTextMode();
  } else if (e.key === 'a' || e.key === 'A') {
    toggleAudioMode();
  } else if (e.key === 's' || e.key === 'S') {
    toggleSpeedReadingMode();
  } else if (e.key === '+' || e.key === '=') {
    changeZoom(0.25);
  } else if (e.key === '-' || e.key === '_') {
    changeZoom(-0.25);
  } else if (e.key === '0') {
    currentZoom = 1.0;
    elements.zoomLevel.textContent = '100%';
    renderPage(currentPageNum);
  }
}

// Start the app
init();
