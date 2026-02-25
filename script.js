// ===========================
// STATE MANAGEMENT
// ===========================
const appState = {
    files: [],
    converting: false,
    results: []
};

// ===========================
// DOM ELEMENTS
// ===========================
const uploadContainer = document.getElementById('uploadContainer');
const fileInput = document.getElementById('fileInput');
const filesList = document.getElementById('filesList');
const fileCount = document.getElementById('fileCount');
const clearBtn = document.getElementById('clearBtn');
const convertBtn = document.getElementById('convertBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressStatus = document.getElementById('progressStatus');
const progressText = document.getElementById('progressText');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const backBtn = document.getElementById('backBtn');

// ===========================
// EVENT LISTENERS
// ===========================
uploadContainer.addEventListener('click', handleUploadClick);
uploadContainer.addEventListener('dragover', handleDragOver);
uploadContainer.addEventListener('dragleave', handleDragLeave);
uploadContainer.addEventListener('drop', handleDrop);

fileInput.addEventListener('change', handleFileSelect);
clearBtn.addEventListener('click', clearAllFiles);
convertBtn.addEventListener('click', startConversion);
backBtn.addEventListener('click', resetToUpload);

// ===========================
// FILE UPLOAD HANDLERS
// ===========================
function handleUploadClick() {
    fileInput.click();
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadContainer.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadContainer.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadContainer.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    addFiles(files);
}

function handleFileSelect(e) {
    const files = e.target.files;
    addFiles(files);
}

// ===========================
// FILE MANAGEMENT
// ===========================
function addFiles(files) {
    // Convert FileList to Array and filter PDF files
    const pdfFiles = Array.from(files).filter(file => file.type === 'application/pdf');
    
    if (pdfFiles.length === 0) {
        showNotification('Please select PDF files only', 'error');
        return;
    }

    // Check for duplicates
    const newFiles = pdfFiles.filter(file => 
        !appState.files.some(existingFile => 
            existingFile.name === file.name && existingFile.size === file.size
        )
    );

    if (newFiles.length === 0) {
        showNotification('These files are already added', 'warning');
        return;
    }

    // Add new files to state
    appState.files = [...appState.files, ...newFiles];
    
    // Reset file input
    fileInput.value = '';
    
    // Update UI
    updateFilesList();
    updateActionButtons();
}

function removeFile(index) {
    appState.files.splice(index, 1);
    updateFilesList();
    updateActionButtons();
}

function clearAllFiles() {
    if (appState.files.length === 0) return;
    
    if (confirm('Are you sure you want to clear all files?')) {
        appState.files = [];
        appState.results = [];
        updateFilesList();
        updateActionButtons();
    }
}

// ===========================
// UI UPDATES
// ===========================
function updateFilesList() {
    if (appState.files.length === 0) {
        filesList.innerHTML = '<p class="empty-state">No files selected yet</p>';
        fileCount.textContent = '0 files';
        return;
    }

    filesList.innerHTML = appState.files.map((file, index) => `
        <div class="file-item">
            <div class="file-info">
                <div class="file-icon">📄</div>
                <div class="file-details">
                    <div class="file-name">${escapeHtml(file.name)}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <div class="file-actions">
                <button class="btn-remove" onclick="removeFile(${index})">Remove</button>
            </div>
        </div>
    `).join('');

    fileCount.textContent = `${appState.files.length} file${appState.files.length !== 1 ? 's' : ''}`;
}

function updateActionButtons() {
    const hasFiles = appState.files.length > 0;
    clearBtn.disabled = !hasFiles;
    convertBtn.disabled = !hasFiles || appState.converting;
}

// ===========================
// FILE CONVERSION
// ===========================
const API_BASE_URL = 'http://localhost:5000/api';

function startConversion() {
    if (appState.files.length === 0 || appState.converting) return;

    appState.converting = true;
    appState.results = [];
    
    // Hide upload section, show progress
    uploadContainer.style.display = 'none';
    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';
    
    updateActionButtons();
    
    // Start actual conversion via API
    convertFilesViaAPI();
}

async function convertFilesViaAPI() {
    try {
        const formData = new FormData();
        
        // Add all files to form data
        appState.files.forEach(file => {
            formData.append('files', file);
        });
        
        // Add optional parameters
        formData.append('quality', 'high');
        formData.append('includeNotes', false);
        
        progressText.textContent = 'Uploading files...';
        
        // Call conversion API
        const response = await fetch(`${API_BASE_URL}/convert`, {
            method: 'POST',
            body: formData,
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Conversion failed');
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Process results and wait for conversions to complete
            await processConvertedFiles(data.results);
        } else {
            throw new Error(data.message || 'Conversion error occurred');
        }
    } catch (error) {
        console.error('Conversion error:', error);
        showNotification(`Error: ${error.message}`, 'error');
        resetToUpload();
    }
}

async function processConvertedFiles(results) {
    appState.results = results;
    let completed = 0;
    const total = results.length;
    
    // If API returns completed files immediately
    if (results.every(r => r.status === 'success')) {
        updateProgress(total, total);
        finishConversion();
        return;
    }
    
    // Otherwise, poll for status updates
    const checkInterval = setInterval(async () => {
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            
            if (result.status !== 'success' && result.fileId) {
                try {
                    const statusResponse = await fetch(`${API_BASE_URL}/status/${result.fileId}`);
                    const statusData = await statusResponse.json();
                    
                    result.status = statusData.status;
                    result.progress = statusData.progress;
                    
                    if (statusData.status === 'completed') {
                        completed++;
                    }
                } catch (error) {
                    console.error(`Error checking status for ${result.fileId}:`, error);
                }
            }
        }
        
        updateProgress(completed, total);
        
        if (completed === total) {
            clearInterval(checkInterval);
            finishConversion();
        }
    }, 2000); // Check every 2 seconds
}

function updateProgress(completed, total) {
    const percentage = Math.round((completed / total) * 100);
    progressBar.style.width = percentage + '%';
    progressStatus.textContent = percentage + '%';
    progressText.textContent = `Converting file ${completed} of ${total}...`;
}

function finishConversion() {
    appState.converting = false;
    
    // Show results section
    progressSection.style.display = 'none';
    resultsSection.style.display = 'block';
    displayResults();
    
    updateActionButtons();
}

function displayResults() {
    resultsList.innerHTML = appState.results.map((result, index) => `
        <div class="result-item">
            <div class="result-info">
                <div class="result-icon">✅</div>
                <div>
                    <div class="result-name">${escapeHtml(result.convertedName)}</div>
                    <div class="file-size">${formatFileSize(result.size)}</div>
                </div>
            </div>
            <div class="result-actions">
                <button class="btn-download" onclick="downloadFile(${index})">Download</button>
            </div>
        </div>
    `).join('');
}

function downloadFile(index) {
    const result = appState.results[index];
    
    if (!result.fileId) {
        showNotification('File ID not available', 'error');
        return;
    }
    
    // Create download link
    const downloadUrl = `${API_BASE_URL}/download/${result.fileId}`;
    
    // Create temporary anchor element
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = result.convertedName || 'presentation.pptx';
    
    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`Downloading ${escapeHtml(result.convertedName)}...`, 'success');
}

function resetToUpload() {
    appState.files = [];
    appState.results = [];
    appState.converting = false;
    
    uploadContainer.style.display = 'block';
    progressSection.style.display = 'none';
    resultsSection.style.display = 'none';
    
    // Reset progress bar
    progressBar.style.width = '0%';
    progressStatus.textContent = '0%';
    progressText.textContent = 'Preparing files...';
    
    updateFilesList();
    updateActionButtons();
}

// ===========================
// UTILITY FUNCTIONS
// ===========================
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b'};
        color: white;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        animation: slideInRight 0.3s ease-out;
        z-index: 1000;
        max-width: 300px;
    `;
    
    document.body.appendChild(notification);
    
    // Remove notification after 4 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// ===========================
// ANIMATIONS
// ===========================
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(20px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    
    @keyframes slideOutRight {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(20px);
        }
    }
`;
document.head.appendChild(style);

// ===========================
// INITIALIZATION
// ===========================
document.addEventListener('DOMContentLoaded', () => {
    updateActionButtons();
});
