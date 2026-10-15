/*
 * FileVault — Secure File Upload Server
 * 
 * Accepts .lua, .luau, and .txt uploads. Files are either stored
 * locally (accessible via admin dashboard) or forwarded to a webhook.
 * Mode is controlled by the STORAGE_MODE environment variable.
 */

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Render (and most hosts) put the app behind a reverse proxy, so the
// client IP arrives in the X-Forwarded-For header. Trust the first proxy
// hop so express-rate-limit can identify clients correctly.
app.set('trust proxy', 1);

// ── Configuration ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
const STORAGE_MODE = (process.env.STORAGE_MODE || 'local').toLowerCase();
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-secure-password';
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 10;
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) || 15;

const ALLOWED_EXTENSIONS = ['.lua', '.luau', '.txt'];
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

// Ensure directories exist
[UPLOADS_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialize metadata store
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([], null, 2));
}

// Hash admin password at startup for comparison
let adminPasswordHash;
(async () => {
  adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
})();

// ── Middleware ───────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Generic rate limiter
const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(generalLimiter);

// Upload-specific rate limiter
const uploadLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW * 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded. Please try again later.' }
});

// Login rate limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again later.' }
});

// ── Multer Setup ────────────────────────────────────────────────────────────────
function sanitizeFilename(original) {
  // Strip directory components, null bytes, and special chars
  let name = path.basename(original);
  name = name.replace(/[^\w.\-]/g, '_');
  // Prevent hidden files
  if (name.startsWith('.')) name = '_' + name;
  return name;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${id}${ext}`);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('Invalid file type. Only .lua, .luau, and .txt files are allowed.'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// ── Auth Middleware ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.filevault_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Insufficient permissions.');
    req.user = decoded;
    next();
  } catch {
    res.clearCookie('filevault_token');
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

// ── Metadata Helpers ────────────────────────────────────────────────────────────
function readMetadata() {
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeMetadata(data) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

// ── API Routes ──────────────────────────────────────────────────────────────────

// Upload endpoint
app.post('/api/upload', uploadLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: `File too large. Maximum size is ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(1)}MB.`
          });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided.' });
    }

    // Double-check extension server-side
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      // Delete the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid file type.' });
    }

    const description = typeof req.body.description === 'string'
      ? req.body.description.slice(0, 500)
      : '';
    const safeOriginalName = sanitizeFilename(req.file.originalname);

    if (STORAGE_MODE === 'webhook') {
      // ── Webhook mode ──
      try {
        const result = await sendToWebhook(req.file.path, safeOriginalName, description);
        // Clean up local file after webhook delivery
        fs.unlinkSync(req.file.path);
        return res.json({
          success: true,
          message: 'File uploaded and delivered successfully.'
        });
      } catch (webhookErr) {
        // Clean up on failure
        try { fs.unlinkSync(req.file.path); } catch {}
        // Log the real reason so it shows up in server/Render logs
        console.error('Webhook delivery failed:', webhookErr.message);
        return res.status(502).json({
          error: 'Failed to deliver file. Please try again later.'
        });
      }
    } else {
      // ── Local storage mode ──
      const entry = {
        id: path.basename(req.file.filename, ext),
        storedName: req.file.filename,
        originalName: safeOriginalName,
        description,
        size: req.file.size,
        extension: ext,
        uploadedAt: new Date().toISOString(),
        ip: req.ip
      };

      const metadata = readMetadata();
      metadata.push(entry);
      writeMetadata(metadata);

      return res.json({
        success: true,
        message: 'File uploaded successfully.'
      });
    }
  });
});

// Upload config (public — returns non-sensitive settings)
app.get('/api/config', (req, res) => {
  res.json({
    maxFileSize: MAX_FILE_SIZE,
    allowedExtensions: ALLOWED_EXTENSIONS,
    storageMode: STORAGE_MODE
  });
});

// ── Webhook Delivery ────────────────────────────────────────────────────────────
async function sendToWebhook(filePath, filename, description) {
  if (!WEBHOOK_URL) throw new Error('Webhook URL not configured.');

  // Dynamic import for FormData (Node 18+ has global fetch)
  const fileBuffer = fs.readFileSync(filePath);
  const { Blob } = require('buffer');

  // Build multipart form data
  const formData = new FormData();
  
  const payload = {
    content: description
      ? `📁 **New file upload:** \`${filename}\`\n📝 ${description}`
      : `📁 **New file upload:** \`${filename}\``
  };
  formData.append('payload_json', JSON.stringify(payload));
  
  const blob = new Blob([fileBuffer]);
  formData.append('file', blob, filename);

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable — Node 18+ is required.');
  }

  // Discord/Cloudflare blocks requests without a proper User-Agent
  // (Error 1015). A descriptive UA is required by Discord's API.
  const headers = {
    'User-Agent': 'FileVault (https://github.com/92tg/website, 1.0.0)'
  };
  // When WEBHOOK_URL points at the Cloudflare Worker relay, send the
  // shared secret so the relay can reject unauthorized callers. Harmless
  // when posting straight to Discord (Discord ignores the header).
  if (process.env.RELAY_SECRET) {
    headers['X-Relay-Secret'] = process.env.RELAY_SECRET;
  }

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: formData
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Webhook returned ${response.status} ${response.statusText} ${body}`.trim());
  }

  return true;
}

// ── Admin Auth Routes ───────────────────────────────────────────────────────────
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  // Constant-time comparison via bcrypt
  const usernameMatch = username === ADMIN_USERNAME;
  const passwordMatch = await bcrypt.compare(password, adminPasswordHash);

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = jwt.sign({ role: 'admin', sub: 'admin' }, JWT_SECRET, {
    expiresIn: '8h'
  });

  res.cookie('filevault_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000
  });

  res.json({ success: true, message: 'Logged in.' });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('filevault_token');
  res.json({ success: true });
});

app.get('/api/admin/check', requireAuth, (req, res) => {
  res.json({ authenticated: true });
});

// ── Admin Dashboard API ─────────────────────────────────────────────────────────
app.get('/api/admin/files', requireAuth, (req, res) => {
  const metadata = readMetadata();
  // Return metadata without sensitive fields
  const files = metadata.map(({ ip, ...rest }) => rest);
  res.json({ files, storageMode: STORAGE_MODE });
});

app.get('/api/admin/files/:id/download', requireAuth, (req, res) => {
  const metadata = readMetadata();
  const entry = metadata.find(f => f.id === req.params.id);

  if (!entry) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const filePath = path.join(UPLOADS_DIR, entry.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk.' });
  }

  // Prevent path traversal
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  res.download(resolvedPath, entry.originalName);
});

app.delete('/api/admin/files/:id', requireAuth, (req, res) => {
  const metadata = readMetadata();
  const index = metadata.findIndex(f => f.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const entry = metadata[index];
  const filePath = path.join(UPLOADS_DIR, entry.storedName);

  // Prevent path traversal
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  // Delete file from disk
  try {
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
  } catch {
    return res.status(500).json({ error: 'Failed to delete file.' });
  }

  // Remove from metadata
  metadata.splice(index, 1);
  writeMetadata(metadata);

  res.json({ success: true, message: 'File deleted.' });
});

// Admin dashboard stats
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const metadata = readMetadata();
  const totalSize = metadata.reduce((sum, f) => sum + (f.size || 0), 0);
  const byExtension = {};
  metadata.forEach(f => {
    byExtension[f.extension] = (byExtension[f.extension] || 0) + 1;
  });

  res.json({
    totalFiles: metadata.length,
    totalSize,
    byExtension,
    storageMode: STORAGE_MODE
  });
});

// ── Serve SPA routes ────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error Handler ───────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An internal error occurred.' });
});

// ── Start ───────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║         FileVault Server Running          ║`);
  console.log(`  ╠══════════════════════════════════════════╣`);
  console.log(`  ║  URL:    http://localhost:${PORT}             ║`);
  console.log(`  ║  Mode:   ${STORAGE_MODE.padEnd(31)}║`);
  console.log(`  ║  Admin:  http://localhost:${PORT}/admin        ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
