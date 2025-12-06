import { db } from './utils/db.js';

const contentArea = document.getElementById('contentArea');
const docTitle = document.getElementById('docTitle');
const saveBtn = document.getElementById('saveBtn');

// Modal Elements
const saveModal = document.getElementById('saveModal');
const closeModalBtns = document.querySelectorAll('.close-modal');
const confirmSaveBtn = document.getElementById('confirmSaveBtn');
const exportFilename = document.getElementById('exportFilename');
const exportFormat = document.getElementById('exportFormat');

// Toolbar elements
const toolbar = document.getElementById('toolbar');
const zoomSelect = document.getElementById('zoomSelect');
const styleSelect = document.getElementById('styleSelect');
const fontSelect = document.getElementById('fontSelect');
const fontSizeSelect = document.getElementById('fontSizeSelect');
const colorPicker = document.getElementById('textColorPicker');
const hlColorPicker = document.getElementById('hlColorPicker');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const linkBtn = document.getElementById('linkBtn');
const tableBtn = document.getElementById('tableBtn');
const printBtn = document.getElementById('printBtn');
const lineSpacingSelect = document.getElementById('lineSpacingSelect');
const findBtn = document.getElementById('findBtn');

// Find & Replace Modal Elements
const findModal = document.getElementById('findModal');
const closeFindModal = document.getElementById('closeFindModal');
const findInput = document.getElementById('findInput');
const replaceInput = document.getElementById('replaceInput');
const matchCaseCheckbox = document.getElementById('matchCase');
const wholeWordCheckbox = document.getElementById('wholeWord');
const findPrevBtn = document.getElementById('findPrevBtn');
const findNextBtn = document.getElementById('findNextBtn');
const replaceBtn = document.getElementById('replaceBtn');
const replaceAllBtn = document.getElementById('replaceAllBtn');
const findStats = document.getElementById('findStats');

const themeToggle = document.createElement('button');
themeToggle.className = 'tool-btn';
themeToggle.title = 'Toggle Dark/Light Mode';
themeToggle.innerHTML = '🌙';
toolbar.appendChild(themeToggle);

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    themeToggle.innerHTML = isDark ? '☀️' : '🌙';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Load saved theme
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    themeToggle.innerHTML = '☀️';
}

let currentFileId = null;
let currentFileType = null;

// Set worker source for PDF.js
if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

async function loadDocument() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    currentFileId = id;

    if (!id) {
        showError('No document ID provided.');
        return;
    }

    try {
        const fileRecord = await db.getFile(id);
        if (!fileRecord) {
            showError('Document not found in storage.');
            return;
        }

        docTitle.textContent = fileRecord.name;
        document.title = fileRecord.name + ' - Local Doc Viewer';
        currentFileType = fileRecord.type;

        if (!fileRecord.content && !fileRecord.contentBlob) {
            showError('Document content is empty or invalid.');
            return;
        }

        // Use contentBlob (reconstructed from ArrayBuffer) or fallback to content
        const fileContent = fileRecord.contentBlob || fileRecord.content;

        // Validate that we have a proper Blob
        if (!fileContent || !(fileContent instanceof Blob) || fileContent.size === 0) {
            const errorMsg = '⚠️ **File Format Error**\n\n' +
                'This document was stored in an old format and is corrupted.\n\n' +
                '✅ **How to Fix:**\n' +
                '1. Click the extension icon (in toolbar)\n' +
                '2. Click the "Clear All" button\n' +
                '3. Re-import fresh copies of your files\n\n' +
                'This will permanently fix the DOCX parsing errors!';

            showError(errorMsg);

            // Offer to delete this specific file
            setTimeout(() => {
                if (confirm('Delete this corrupted file now?\n\n(You can re-import it fresh after clearing all files)')) {
                    db.deleteFile(currentFileId).then(() => {
                        alert('File deleted. Please clear all files and re-import.');
                        window.close();
                    });
                }
            }, 500);
            return;
        }

        // Pre-fill export filename
        exportFilename.value = fileRecord.name.split('.').slice(0, -1).join('.');

        const name = fileRecord.name.toLowerCase();

        if (currentFileType === 'application/pdf' || name.endsWith('.pdf')) {
            await renderPDF(fileContent);
        }
        else if (
            currentFileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            name.endsWith('.docx')
        ) {
            await renderDocx(fileContent);
            enableEditing();
        }
        else if (name.endsWith('.txt') || name.endsWith('.md') || currentFileType.startsWith('text/')) {
            await renderText(fileContent, name.endsWith('.md'));
            enableEditing();
        }
        else if (name.endsWith('.doc')) {
            showError('Legacy .doc format is not fully supported by this viewer. Please convert to .docx or .pdf.');
        }
        else {
            // Try to render as text for unknown types if manageable
            await renderText(fileContent, false);
            enableEditing();
        }

    } catch (err) {
        console.error(err);
        showError('Error loading document: ' + err.message);
    }
}

function enableEditing() {
    saveBtn.style.display = 'block';

    // Wire up Save Button to open modal
    saveBtn.onclick = () => {
        saveModal.classList.remove('hidden');
    };

    // Show toolbar
    toolbar.style.display = 'flex';
    setupToolbar();
}

function setupToolbar() {
    // Buttons with data-cmd
    toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const cmd = btn.dataset.cmd;
            execCmd(cmd);
        });
    });

    // Color pickers
    colorPicker.addEventListener('change', (e) => {
        execCmd('foreColor', e.target.value);
    });

    hlColorPicker.addEventListener('change', (e) => {
        execCmd('hiliteColor', e.target.value);
    });

    // Style Select
    styleSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        try {
            // Some browsers expect <TAG>, others TAG. Try TAG first.
            document.execCommand('formatBlock', false, val);
        } catch (err) {
            console.warn('formatBlock failed, retrying with brackets', err);
            document.execCommand('formatBlock', false, '<' + val + '>');
        }
        styleSelect.value = 'p';
    });

    // Font Select
    fontSelect.addEventListener('change', (e) => {
        execCmd('fontName', e.target.value);
    });

    // Font Size
    fontSizeSelect.addEventListener('change', (e) => {
        execCmd('fontSize', e.target.value);
    });

    // Zoom
    zoomSelect.addEventListener('change', (e) => {
        const zoom = parseFloat(e.target.value);
        applyZoom(zoom);
    });

    // Image Btn
    imageBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        imageInput.click();
    });

    imageInput.addEventListener('change', handleImageUpload);

    // Link Btn
    linkBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const url = prompt('Enter link URL:');
        if (url) {
            execCmd('createLink', url);
        }
    });

    // Table Btn
    tableBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertTable();
    });

    // Print Btn
    printBtn.addEventListener('click', () => {
        window.print();
    });

    // Line Spacing
    lineSpacingSelect.addEventListener('change', (e) => {
        const spacing = e.target.value;
        applyLineSpacing(spacing);
    });

    // Find & Replace Button
    findBtn.addEventListener('click', () => {
        findModal.classList.remove('hidden');
        findInput.focus();
    });

    // Modal Listeners
    closeModalBtns.forEach(btn => {
        btn.onclick = () => saveModal.classList.add('hidden');
    });

    closeFindModal.onclick = () => findModal.classList.add('hidden');

    confirmSaveBtn.onclick = handleExport;

    // Find & Replace functionality
    setupFindReplace();
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            const result = readerEvent.target.result;
            execCmd('insertImage', result);
        };
        reader.readAsDataURL(file);
    }
    imageInput.value = '';
}

function insertTable() {
    const tableHtml = `
        <table style="width: 100%; border-collapse: collapse; margin: 1em 0;" border="1">
            <tbody>
                <tr><td>Cell 1</td><td>Cell 2</td><td>Cell 3</td></tr>
                <tr><td>Cell 4</td><td>Cell 5</td><td>Cell 6</td></tr>
                <tr><td>Cell 7</td><td>Cell 8</td><td>Cell 9</td></tr>
            </tbody>
        </table>
    `;
    execCmd('insertHTML', tableHtml);
}

function execCmd(command, value = null) {
    document.execCommand(command, false, value);
}

function applyZoom(scale) {
    const sheets = document.querySelectorAll('.document-sheet');
    sheets.forEach(sheet => {
        sheet.style.zoom = scale;
        if (getComputedStyle(sheet).zoom != scale) {
            sheet.style.transform = `scale(${scale})`;
            sheet.style.transformOrigin = 'top center';
            sheet.style.marginBottom = `${(scale - 1) * 100}%`;
        }
    });
}

function applyLineSpacing(spacing) {
    const sheets = document.querySelectorAll('.document-sheet');
    sheets.forEach(sheet => {
        sheet.style.lineHeight = spacing;
    });
}

// --- Save & Export Logic ---

function getDocumentContent() {
    const pages = document.querySelectorAll('.document-sheet');
    let fullHtml = '';
    pages.forEach(page => {
        fullHtml += page.innerHTML;
    });
    return fullHtml;
}

function handleExport() {
    const filename = exportFilename.value || 'document';
    const format = exportFormat.value;
    const content = getDocumentContent();

    if (format === 'pdf') {
        saveModal.classList.add('hidden');

        // Show instructions for clean PDF export
        setTimeout(() => {
            alert('📄 PDF Export Instructions:\n\n' +
                '1. In the print dialog, click "More settings"\n' +
                '2. Turn OFF "Headers and footers"\n' +
                '3. Set Margins to "None"\n' +
                '4. Choose "Save as PDF" as destination\n\n' +
                'This ensures a clean PDF without date/time headers!');
        }, 100);

        window.print(); // Native Print to PDF
    } else if (format === 'docx') {
        exportAsDocx(filename, content);
    } else if (format === 'txt') {
        exportAsTxt(filename, content);
    }

    // Also save to local DB quietly (as HTML) for persistence
    saveToDb(content, filename + '.docx');

    if (format !== 'pdf') {
        saveModal.classList.add('hidden');
        alert('Document processed successfully.');
    }
}

function exportAsTxt(filename, html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const text = tempDiv.innerText;
    downloadFile(text, filename + '.txt', 'text/plain');
}

function exportAsDocx(filename, html) {
    // Generate a valid HTML document that Word interprets
    const header = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' 
              xmlns:w='urn:schemas-microsoft-com:office:word' 
              xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>${filename}</title></head><body>`;
    const footer = "</body></html>";
    const sourceHTML = header + html + footer;

    // Use MIME type that triggers Word
    downloadFile(sourceHTML, filename + '.doc', 'application/vnd.ms-word');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 0);
}

async function saveToDb(html, filename) {
    if (!currentFileId) return;
    try {
        const blob = new Blob([html], { type: 'text/html' });
        const arrayBuffer = await blob.arrayBuffer(); // Convert to ArrayBuffer

        const fileRecord = await db.getFile(currentFileId);
        fileRecord.content = arrayBuffer; // Store as ArrayBuffer
        fileRecord.type = 'text/html';
        fileRecord.name = filename; // Update name if changed
        await db.saveFile(fileRecord);
    } catch (e) {
        console.error("Auto-save failed", e);
    }
}


function showError(msg) {
    contentArea.innerHTML = `<div class="error" style="color:red; text-align:center;">${msg}</div>`;
}

async function readFileAsArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
    });
}

async function readFileAsText(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(blob);
    });
}

// --- Pagination Logic ---

function createPage() {
    const page = document.createElement('div');
    page.className = 'document-sheet prose';
    page.contentEditable = 'true';
    page.spellcheck = false;
    return page;
}

function paginateContent(htmlContent) {
    contentArea.innerHTML = ''; // Clear

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    if (tempDiv.children.length === 0 && !tempDiv.textContent.trim()) {
        contentArea.appendChild(createPage());
        return;
    }

    let currentPage = createPage();
    contentArea.appendChild(currentPage);

    const nodes = Array.from(tempDiv.childNodes);

    for (const node of nodes) {
        let elementToAdd = node;
        if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.trim() === '') continue;
            const p = document.createElement('p');
            p.textContent = node.textContent;
            elementToAdd = p;
        }

        currentPage.appendChild(elementToAdd);

        if (currentPage.scrollHeight > currentPage.clientHeight) {
            currentPage.removeChild(elementToAdd);

            currentPage = createPage();
            contentArea.appendChild(currentPage);
            currentPage.appendChild(elementToAdd);
        }
    }
}


// --- Renderers ---

async function renderDocx(blob) {
    try {
        if (!blob || blob.size === 0) {
            throw new Error("Document content is empty.");
        }

        const arrayBuffer = await readFileAsArrayBuffer(blob);
        console.log("ArrayBuffer size:", arrayBuffer.byteLength);

        // Validate Zip Signature (PK\x03\x04)
        if (arrayBuffer.byteLength < 4) {
            throw new Error("File is too small to be a valid DOCX.");
        }

        const view = new Uint8Array(arrayBuffer);
        // PK\x03\x04
        if (view[0] !== 0x50 || view[1] !== 0x4B || view[2] !== 0x03 || view[3] !== 0x04) {
            console.warn("Invalid Zip Signature. This may not be a .docx file.");
        }

        const options = {};
        const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, options);

        if (!result || (!result.value && result.value !== "")) {
            throw new Error("Conversion failed to produce output.");
        }

        const html = result.value;

        paginateContent(html);

        if (result.messages.length > 0) {
            console.warn("Mammoth warnings:", result.messages);
        }
    } catch (e) {
        console.error("DOCX Error details:", e);
        let msg = e.message;

        if (msg && (msg.includes("end of central directory") || msg.includes("Zip"))) {
            msg = '⚠️ **DOCX Parsing Error**\n\n' +
                'This file is corrupted or was stored in an old format.\n\n' +
                '✅ **Fix Steps:**\n' +
                '1. Close this tab\n' +
                '2. Click extension icon → "Clear All"\n' +
                '3. Re-import fresh .docx files\n\n' +
                '**Why?** Old files used a storage method that corrupts DOCX files. ' +
                'Clearing and re-importing uses a new reliable format.';
        }

        throw new Error(msg);
    }
}

async function renderText(blob, isMarkdown) {
    const text = await readFileAsText(blob);
    let html = '';

    if (isMarkdown && window.marked) {
        html = marked.parse(text);
    } else {
        const paragraphs = text.split(/\n\s*\n/);
        html = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }

    paginateContent(html);
}

async function renderPDF(blob) {
    contentArea.innerHTML = '<div class="pdf-container" id="pdfContainer"></div>';
    const container = document.getElementById('pdfContainer');

    const arrayBuffer = await readFileAsArrayBuffer(blob);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        const scale = 2;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        canvas.style.width = '210mm';
        canvas.style.height = 'auto';

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        container.appendChild(canvas);
        await page.render(renderContext).promise;
    }
}

// --- Find & Replace Functionality ---

let findMatches = [];
let currentMatchIndex = -1;

function setupFindReplace() {
    findInput.addEventListener('input', performFind);
    matchCaseCheckbox.addEventListener('change', performFind);
    wholeWordCheckbox.addEventListener('change', performFind);

    findPrevBtn.addEventListener('click', findPrevious);
    findNextBtn.addEventListener('click', findNext);
    replaceBtn.addEventListener('click', replaceCurrent);
    replaceAllBtn.addEventListener('click', replaceAll);

    // Keyboard shortcuts
    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                findPrevious();
            } else {
                findNext();
            }
        }
    });
}

function performFind() {
    const searchText = findInput.value;
    clearHighlights();
    findMatches = [];
    currentMatchIndex = -1;

    if (!searchText) {
        findStats.textContent = '';
        return;
    }

    const pages = document.querySelectorAll('.document-sheet');
    const matchCase = matchCaseCheckbox.checked;
    const wholeWord = wholeWordCheckbox.checked;

    pages.forEach((page) => {
        highlightTextInNode(page, searchText, matchCase, wholeWord);
    });

    findMatches = document.querySelectorAll('.find-highlight');

    if (findMatches.length > 0) {
        currentMatchIndex = 0;
        highlightCurrentMatch();
        findStats.textContent = `Found ${findMatches.length} match${findMatches.length === 1 ? '' : 'es'}`;
    } else {
        findStats.textContent = 'No matches found';
    }
}

function highlightTextInNode(node, searchText, matchCase, wholeWord) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        const searchRegex = createSearchRegex(searchText, matchCase, wholeWord);

        if (searchRegex.test(text)) {
            const span = document.createElement('span');
            span.innerHTML = text.replace(searchRegex, (match) => {
                return `<mark class="find-highlight">${match}</mark>`;
            });
            node.parentNode.replaceChild(span, node);
        }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
        Array.from(node.childNodes).forEach(child => {
            highlightTextInNode(child, searchText, matchCase, wholeWord);
        });
    }
}

function createSearchRegex(searchText, matchCase, wholeWord) {
    let pattern = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) {
        pattern = `\\b${pattern}\\b`;
    }
    const flags = matchCase ? 'g' : 'gi';
    return new RegExp(pattern, flags);
}

function clearHighlights() {
    const highlights = document.querySelectorAll('.find-highlight, .find-current');
    highlights.forEach(mark => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
}

function highlightCurrentMatch() {
    findMatches.forEach((mark, index) => {
        mark.classList.remove('find-current');
        if (index === currentMatchIndex) {
            mark.classList.add('find-current');
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    if (findMatches.length > 0) {
        findStats.textContent = `${currentMatchIndex + 1} of ${findMatches.length}`;
    }
}

function findNext() {
    if (findMatches.length === 0) {
        performFind();
        return;
    }

    currentMatchIndex = (currentMatchIndex + 1) % findMatches.length;
    highlightCurrentMatch();
}

function findPrevious() {
    if (findMatches.length === 0) {
        performFind();
        return;
    }

    currentMatchIndex = (currentMatchIndex - 1 + findMatches.length) % findMatches.length;
    highlightCurrentMatch();
}

function replaceCurrent() {
    if (currentMatchIndex < 0 || currentMatchIndex >= findMatches.length) {
        return;
    }

    const currentMark = findMatches[currentMatchIndex];
    const replacement = replaceInput.value;

    currentMark.parentNode.replaceChild(document.createTextNode(replacement), currentMark);

    performFind(); // Re-run search to update matches
}

function replaceAll() {
    const replacement = replaceInput.value;
    const searchText = findInput.value;

    if (!searchText) return;

    const matchCase = matchCaseCheckbox.checked;
    const wholeWord = wholeWordCheckbox.checked;
    const searchRegex = createSearchRegex(searchText, matchCase, wholeWord);

    const pages = document.querySelectorAll('.document-sheet');
    let totalReplacements = 0;

    pages.forEach(page => {
        totalReplacements += replaceInNode(page, searchRegex, replacement);
    });

    clearHighlights();
    findStats.textContent = `Replaced ${totalReplacements} occurrence${totalReplacements === 1 ? '' : 's'}`;
    findMatches = [];
    currentMatchIndex = -1;
}

function replaceInNode(node, searchRegex, replacement) {
    let count = 0;

    if (node.nodeType === Node.TEXT_NODE) {
        const newText = node.nodeValue.replace(searchRegex, (match) => {
            count++;
            return replacement;
        });
        if (count > 0) {
            node.nodeValue = newText;
        }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
        Array.from(node.childNodes).forEach(child => {
            count += replaceInNode(child, searchRegex, replacement);
        });
    }

    return count;
}

// Ctrl+F shortcut
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        findModal.classList.remove('hidden');
        findInput.focus();
    }
    if (e.key === 'Escape') {
        findModal.classList.add('hidden');
        clearHighlights();
    }
});

loadDocument();
