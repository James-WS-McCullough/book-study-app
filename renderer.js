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

  // Hide ruler when leaving reader
  if (viewName !== 'reader') {
    rulerVisible = false;
    elements.readingRuler.classList.add('hidden');
    elements.pdfContainer.classList.remove('ruler-active');
    elements.toggleRulerBtn.classList.remove('ruler-active');
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
