# FileVault — Secure File Upload Server

A minimalist, dark-themed file upload website that accepts `.lua`, `.luau`, and `.txt` files. Files are stored securely on the server and accessible only to the authenticated admin through a protected dashboard.

## Features

- **Drag & drop** file upload with real-time progress bar
- **Strict validation** — only `.lua`, `.luau`, and `.txt` files accepted (validated on both client and server)
- **Configurable storage** — local server storage or webhook delivery (Discord-compatible)
- **Admin dashboard** — protected by JWT authentication, view/download/delete uploaded files
- **Rate limiting** — configurable per-IP upload and login rate limits
- **Security** — files stored outside the public directory, sanitized filenames, path traversal prevention, httpOnly cookies, no file execution

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env with your own values (especially ADMIN_PASSWORD and JWT_SECRET)

# 3. Start the server
npm start
```

The server starts at **http://localhost:3000**

- **Upload page:** http://localhost:3000
- **Admin dashboard:** http://localhost:3000/admin

## Configuration

All settings are controlled via environment variables (`.env` file):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `production` | Environment (`development` / `production`) |
| `ADMIN_USERNAME` | `admin` | Admin login username |
| `ADMIN_PASSWORD` | *(required)* | Admin login password |
| `JWT_SECRET` | *(required)* | Secret key for JWT session tokens |
| `STORAGE_MODE` | `local` | `local` (server storage) or `webhook` (forward to URL) |
| `WEBHOOK_URL` | — | Discord/webhook URL (only used in webhook mode) |
| `MAX_FILE_SIZE` | `5242880` | Maximum upload size in bytes (default: 5MB) |
| `RATE_LIMIT_MAX` | `10` | Max uploads per IP per rate window |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Rate limit window in minutes |

### Storage Modes

**Local Storage** (`STORAGE_MODE=local`)
- Files are saved to the `uploads/` directory (outside public web root)
- Metadata (filename, size, date, description) stored in `data/metadata.json`
- Admin dashboard provides download and delete functionality

**Webhook Delivery** (`STORAGE_MODE=webhook`)
- Files are forwarded to the configured `WEBHOOK_URL` as form-data attachments
- Compatible with Discord webhooks — sends filename and optional description
- Files are not persisted on the server after successful delivery

## Project Structure

```
├── server.js          # Express backend (API, auth, storage, webhook)
├── public/
│   ├── index.html     # Upload page
│   ├── admin.html     # Admin dashboard
│   ├── styles.css     # Complete CSS (dark/teal theme)
│   ├── upload.js      # Upload client logic
│   └── admin.js       # Admin client logic
├── uploads/           # Stored files (gitignored, auto-created)
├── data/              # Metadata store (gitignored, auto-created)
├── .env.example       # Environment template
├── .env               # Your config (gitignored)
└── package.json
```

## Security Notes

- Uploaded files are **never executed** — they are stored/forwarded as-is
- File type validation happens on both client and server
- Filenames are sanitized to prevent path traversal and injection
- Admin sessions use httpOnly, sameSite cookies with JWT tokens (8-hour expiry)
- Webhook URLs and secrets are server-side only, never exposed to clients
- Rate limiting applied to uploads and login attempts
- The `uploads/` directory is not served by the static file middleware

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/config` | No | Public upload config (max size, allowed extensions) |
| `POST` | `/api/upload` | No | Upload a file (multipart/form-data) |
| `POST` | `/api/admin/login` | No | Admin login (returns session cookie) |
| `POST` | `/api/admin/logout` | Yes | Admin logout |
| `GET` | `/api/admin/check` | Yes | Check authentication status |
| `GET` | `/api/admin/stats` | Yes | Dashboard statistics |
| `GET` | `/api/admin/files` | Yes | List all uploaded files |
| `GET` | `/api/admin/files/:id/download` | Yes | Download a file |
| `DELETE` | `/api/admin/files/:id` | Yes | Delete a file |

## Deployment

For production deployment:

1. Set `NODE_ENV=production` in `.env`
2. Use a **strong, random** `JWT_SECRET` and `ADMIN_PASSWORD`
3. Run behind a reverse proxy (nginx, Caddy) with HTTPS
4. Optionally use a process manager like PM2: `pm2 start server.js --name filevault`
