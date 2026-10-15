/*
 * FileVault — Upload Client Logic
 * Handles drag-and-drop, file validation, upload with progress, and status.
 */

(function () {
  'use strict';

  // ── DOM Elements ──────────────────────────────────────────────
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const fileRemove = document.getElementById('fileRemove');
  const description = document.getElementById('description');
  const charCount = document.getElementById('charCount');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const progressPercent = document.getElementById('progressPercent');
  const statusMessage = document.getElementById('statusMessage');
  const uploadBtn = document.getElementById('uploadBtn');
  const maxSizeDisplay = document.getElementById('maxSizeDisplay');

  // ── State ─────────────────────────────────────────────────────
  let selectedFile = null;
  let isUploading = false;
  let config = {
    maxFileSize: 5 * 1024 * 1024,
    allowedExtensions: ['.lua', '.luau', '.txt']
  };

  // ── Init ──────────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        config.maxFileSize = data.maxFileSize;
        config.allowedExtensions = data.allowedExtensions;
      }
    } catch {
      // Use defaults
    }
    maxSizeDisplay.textContent = formatSize(config.maxFileSize);
  }
  init();

  // ── Helpers ───────────────────────────────────────────────────
  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function getExtension(name) {
    const lastDot = name.lastIndexOf('.');
    return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : '';
  }

  function validateFile(file) {
    const ext = getExtension(file.name);
    if (!config.allowedExtensions.includes(ext)) {
      return `Invalid file type "${ext}". Only ${config.allowedExtensions.join(', ')} files are accepted.`;
    }
    if (file.size > config.maxFileSize) {
      return `File too large (${formatSize(file.size)}). Maximum size is ${formatSize(config.maxFileSize)}.`;
    }
    if (file.size === 0) {
      return 'File is empty.';
    }
    return null;
  }

  // ── Status Display ────────────────────────────────────────────
  function showStatus(type, message) {
    const iconSvg = type === 'success'
      ? '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

    statusMessage.className = `status-message ${type}`;
    statusMessage.innerHTML = iconSvg + `<span>${message}</span>`;
    statusMessage.style.display = 'flex';
  }

  function hideStatus() {
    statusMessage.style.display = 'none';
  }

  // ── File Selection ────────────────────────────────────────────
  function selectFile(file) {
    hideStatus();

    const error = validateFile(file);
    if (error) {
      showStatus('error', error);
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatSize(file.size);
    fileInfo.style.display = 'block';
    uploadBtn.disabled = false;

    // Reset progress
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.style.display = 'none';
    uploadBtn.disabled = true;
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
    description.value = '';
    charCount.textContent = '0';
    hideStatus();
  }

  // ── Drag & Drop ───────────────────────────────────────────────
  dropzone.addEventListener('click', () => {
    if (!isUploading) fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      selectFile(fileInput.files[0]);
    }
  });

  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    // Only remove if leaving the dropzone (not entering a child)
    if (!dropzone.contains(e.relatedTarget)) {
      dropzone.classList.remove('drag-over');
    }
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (!isUploading && e.dataTransfer.files.length > 0) {
      selectFile(e.dataTransfer.files[0]);
    }
  });

  // Prevent default browser file drop behavior
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // ── Remove File ───────────────────────────────────────────────
  fileRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isUploading) clearFile();
  });

  // ── Character Count ───────────────────────────────────────────
  description.addEventListener('input', () => {
    charCount.textContent = description.value.length;
  });

  // ── Upload ────────────────────────────────────────────────────
  uploadBtn.addEventListener('click', () => {
    if (!selectedFile || isUploading) return;
    uploadFile();
  });

  async function uploadFile() {
    isUploading = true;
    uploadBtn.disabled = true;
    hideStatus();

    // Show progress
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Uploading…';
    progressPercent.textContent = '0%';

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('description', description.value.trim());

    try {
      const response = await uploadWithProgress('/api/upload', formData, (progress) => {
        const pct = Math.round(progress * 100);
        progressBar.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
        if (pct >= 100) {
          progressLabel.textContent = 'Processing…';
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressLabel.textContent = 'Complete';
        showStatus('success', data.message || 'File uploaded successfully!');

        // Reset after a short delay
        setTimeout(() => {
          clearFile();
        }, 3000);
      } else {
        showStatus('error', data.error || 'Upload failed. Please try again.');
        progressContainer.style.display = 'none';
      }
    } catch (err) {
      showStatus('error', 'Network error. Please check your connection and try again.');
      progressContainer.style.display = 'none';
    } finally {
      isUploading = false;
      uploadBtn.disabled = !selectedFile;
    }
  }

  function uploadWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      });

      xhr.addEventListener('load', () => {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          json: () => {
            try {
              return Promise.resolve(JSON.parse(xhr.responseText));
            } catch {
              return Promise.resolve({ error: 'Invalid response from server.' });
            }
          }
        });
      });

      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
      xhr.addEventListener('timeout', () => reject(new Error('Upload timed out')));

      xhr.open('POST', url);
      xhr.timeout = 60000; // 60 seconds
      xhr.send(formData);
    });
  }
})();
