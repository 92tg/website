/*
 * FileVault — Admin Dashboard Client Logic
 * Handles login, file listing, download, delete, and stats.
 */

(function () {
  'use strict';

  // ── DOM Elements ──────────────────────────────────────────────
  const loginView = document.getElementById('loginView');
  const dashboardView = document.getElementById('dashboardView');
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  const statTotalFiles = document.getElementById('statTotalFiles');
  const statTotalSize = document.getElementById('statTotalSize');
  const statMode = document.getElementById('statMode');
  const statModeSub = document.getElementById('statModeSub');
  const fileCountLabel = document.getElementById('fileCountLabel');
  const filesBody = document.getElementById('filesBody');

  const deleteModal = document.getElementById('deleteModal');
  const deleteFileName = document.getElementById('deleteFileName');
  const deleteCancelBtn = document.getElementById('deleteCancelBtn');
  const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

  let pendingDeleteId = null;

  // ── Helpers ───────────────────────────────────────────────────
  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) + ' ' + d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Auth Check ────────────────────────────────────────────────
  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/check');
      if (res.ok) {
        showDashboard();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }
  checkAuth();

  function showLogin() {
    loginView.style.display = '';
    dashboardView.style.display = 'none';
  }

  function showDashboard() {
    loginView.style.display = 'none';
    dashboardView.style.display = '';
    loadStats();
    loadFiles();
  }

  // ── Login ─────────────────────────────────────────────────────
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.value.trim(),
          password: loginPassword.value
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        loginPassword.value = '';
        showDashboard();
      } else {
        loginError.textContent = data.error || 'Login failed.';
        loginError.style.display = 'block';
      }
    } catch {
      loginError.textContent = 'Network error. Please try again.';
      loginError.style.display = 'block';
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    }
  });

  // ── Logout ────────────────────────────────────────────────────
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {}
    showLogin();
  });

  // ── Refresh ───────────────────────────────────────────────────
  refreshBtn.addEventListener('click', () => {
    loadStats();
    loadFiles();
  });

  // ── Load Stats ────────────────────────────────────────────────
  async function loadStats() {
    try {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) {
        if (res.status === 401) return showLogin();
        return;
      }
      const data = await res.json();
      statTotalFiles.textContent = data.totalFiles;
      statTotalSize.textContent = formatSize(data.totalSize);
      statMode.textContent = data.storageMode === 'webhook' ? '⚡' : '💾';
      statModeSub.textContent = data.storageMode === 'webhook' ? 'Webhook' : 'Local Storage';
    } catch {}
  }

  // ── Load Files ────────────────────────────────────────────────
  async function loadFiles() {
    try {
      const res = await fetch('/api/admin/files');
      if (!res.ok) {
        if (res.status === 401) return showLogin();
        return;
      }
      const data = await res.json();
      renderFiles(data.files);
    } catch {}
  }

  function renderFiles(files) {
    fileCountLabel.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;

    if (files.length === 0) {
      filesBody.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
          <p>No files uploaded yet</p>
          <p class="empty-hint">Files will appear here once visitors upload them.</p>
        </div>
      `;
      return;
    }

    // Sort newest first
    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    let html = `
      <table class="files-table">
        <thead>
          <tr>
            <th>Filename</th>
            <th>Type</th>
            <th>Size</th>
            <th>Date</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    files.forEach(file => {
      html += `
        <tr>
          <td data-label="Filename" class="fname">${escapeHtml(file.originalName)}</td>
          <td data-label="Type"><span class="fext">${escapeHtml(file.extension)}</span></td>
          <td data-label="Size" class="fsize">${formatSize(file.size)}</td>
          <td data-label="Date" class="fdate">${formatDate(file.uploadedAt)}</td>
          <td data-label="Description" class="fdesc" title="${escapeHtml(file.description || '')}">${escapeHtml(file.description || '—')}</td>
          <td data-label="Actions">
            <div class="factions">
              <a href="/api/admin/files/${encodeURIComponent(file.id)}/download" title="Download" class="download-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </a>
              <button class="delete-btn" data-id="${file.id}" data-name="${escapeHtml(file.originalName)}" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    filesBody.innerHTML = html;

    // Attach delete handlers
    filesBody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingDeleteId = btn.dataset.id;
        deleteFileName.textContent = btn.dataset.name;
        deleteModal.style.display = 'flex';
      });
    });
  }

  // ── Delete Modal ──────────────────────────────────────────────
  deleteCancelBtn.addEventListener('click', () => {
    deleteModal.style.display = 'none';
    pendingDeleteId = null;
  });

  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
      deleteModal.style.display = 'none';
      pendingDeleteId = null;
    }
  });

  deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteId) return;

    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting…';

    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(pendingDeleteId)}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        loadFiles();
        loadStats();
      } else if (res.status === 401) {
        showLogin();
      }
    } catch {}

    deleteModal.style.display = 'none';
    pendingDeleteId = null;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = 'Delete';
  });
})();
