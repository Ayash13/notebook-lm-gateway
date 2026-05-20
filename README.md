# nlm::gateway

> Headless API gateway for [NotebookLM](https://notebooklm.google.com) — query your notebooks programmatically via REST API or a terminal-themed web UI.

---

## Overview

**nlm::gateway** bridges your applications to Google NotebookLM by running a headless Chromium browser on the server, authenticated with your Google cookies. It exposes a clean REST API and a real-time web chat interface, with per-device session isolation and persistent conversation history in SQLite.

### Key Features

- **REST API** — Send queries, get structured JSON responses with markdown
- **Web UI** — Terminal-themed chat interface (JetBrains Mono, green-on-dark)
- **Multi-user** — Cookie-based device ID (`nlm_uid`) isolates sessions and history
- **Session pooling** — Pre-warmed Playwright pages with LRU eviction
- **Persistence** — SQLite (WAL mode) stores all conversations per user
- **Session monitoring** — Live Google cookie expiry displayed in the UI
- **Clean Output** — Automatically strips NotebookLM citation markers from the DOM for clean text/markdown
- **Docker-ready** — One-command deployment with `docker compose`
- **Tunnel-friendly** — Works behind ngrok, cloudflared, or any reverse proxy

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Docker Container                      │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  Express  │───▶│  Session Pool │───▶│  Playwright Pages │  │
│  │  Server   │    │  (per device) │    │  (headless Chrome)│  │
│  │  :3005    │    │  LRU max: 5   │    │                   │  │
│  └──────────┘    └──────────────┘    └─────────┬─────────┘  │
│       │                                         │            │
│       │          ┌──────────────┐               │            │
│       ├─────────▶│  SQLite DB   │               ▼            │
│       │          │  gateway.db  │        ┌─────────────┐     │
│       │          │(Hist & Profs)│        │ NotebookLM  │     │
│       │          └──────────────┘        │ (google.com)│     │
│       │                                  └─────────────┘     │
│       │          ┌──────────────┐                            │
│       └─────────▶│  Static UI   │                            │
│                  │  public/     │                            │
│                  └──────────────┘                            │
└─────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │                              │
    ┌────┴────┐                 ┌───────┴───────┐
    │ Browser │                 │ auth-state.json│
    │ / API   │                 │ (Chrome cookies)│
    └─────────┘                 └───────────────┘
```

### Directory Structure

```
├── index.js           # Lightweight Express entry point
├── login.js           # Auth orchestrator (extracts cookies)
├── src/
│   ├── api/           # Express REST controllers (routes.js)
│   ├── auth/          # OS-specific DPAPI/Keychain decryption (mac.js, win.js)
│   └── core/          # Playwright engine (browser.js) & SQLite (db.js)
└── public/            # Decoupled frontend (index.html, style.css, app.js)
```

### Request Flow

```
1. Client sends POST /api/notebook to select a target NotebookLM URL (Profile).
2. Server saves the preference to SQLite and asynchronously pre-warms a Playwright page.
3. Client sends POST /api/ask { query: "..." }
4. Middleware reads the `nlm_uid` cookie to identify the client device.
5. Server fetches the client's active notebook preference from SQLite and assigns a Playwright page.
6. Query is typed into the NotebookLM textarea and submitted.
7. Server waits for the response, parsing the DOM into clean Text + Markdown.
8. Conversation is saved to SQLite and returned as JSON.
```

---

## Quick Start

### Prerequisites

| Requirement         | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| **Node.js 20+**     | Runtime                                                          |
| **Google Chrome**   | Cookie source (must be logged into Google)                       |
| **macOS / Windows** | Cookie decryption via Keychain (`security` CLI) or Windows DPAPI |

### Install & Run

```bash
# Clone and install
git clone https://github.com/Ayash13/notebook-lm-gateway.git
cd notebook-lm-gateway
npm install

# Extract Google cookies from Chrome (one-time, no restart needed)
npm run login

# Start the gateway
npm start
```

Open **http://localhost:3005** for the web UI.

---

## Docker Deployment

### 1. Local Machine (Push)

First, extract your Google cookies and push the multi-architecture image to Docker Hub.

```bash
# Extract cookies (generates auth-state.json locally)
npm run login

# Build and push your image to Docker Hub
docker buildx build --platform linux/amd64,linux/arm64 -t your_username/notebook-lm-gateway:latest --push .
```

### 2. VPS (Pull & Run)

On your VPS, you need to securely copy over your `auth-state.json` file and mount it into the container. It is completely isolated and never baked into the image.

```bash
# Ensure you have copied auth-state.json from your local machine to your VPS directory!

# Run the container with the auth-state.json mounted
docker run -d \
  --name nlm-gateway \
  -p 3005:3005 \
  -v $(pwd)/auth-state.json:/app/auth-state.json:ro \
  -v nlm-gateway-db-fresh:/app/data \
  -e PORT=3005 \
  -e DB_DIR=/app/data \
  --restart unless-stopped \
  your_username/notebook-lm-gateway:latest
```

> **Note:** Because `auth-state.json` is securely mounted as a read-only volume, the image itself remains safe and credential-free.

### Expose to Internet

```bash
# ngrok (static domain)
ngrok http --domain=your-domain.ngrok-free.app 3005

# or cloudflared (no account needed)
cloudflared tunnel --url localhost:3005

# or localtunnel
npx localtunnel --port 3005
```

---

## API Reference

The gateway includes an interactive, premium dark-themed **Swagger API Documentation** portal for exploring and testing the REST API endpoints directly in your browser.

- **Swagger UI Portal:** Visit `/api` (e.g. `http://localhost:3005/api`)
- **OpenAPI 3.0 Specification:** Served at `/swagger.json`

---

### `POST /api/ask`

Send a query to NotebookLM.

**Request:**

```json
{
  "query": "where ayash study?",
  "notebook": "https://notebooklm.google.com/notebook/052a33bb-5f6c-4f37-9042-2f5d03294dab"
}
```

> `notebook` is optional for subsequent queries, but required for your first query if you haven't set one yet.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 3,
    "query": "where ayash study?",
    "response": "Muhammad Ayash Al-Fatih studied at Universitas Muhammadiyah Yogyakarta (UMY) in D.I. Yogyakarta, Indonesia. He earned a Bachelor's degree in Information Technology, graduating with a GPA of 3.79.\nAdditionally, he completed an intensive educational program at Bangkit Academy 2024, where he studied in the Mobile Development Cohort.",
    "markdown": "Muhammad Ayash Al-Fatih studied at Universitas Muhammadiyah Yogyakarta (UMY) in D.I. Yogyakarta, Indonesia. He earned a Bachelor's degree in Information Technology, graduating with a GPA of 3.79. Additionally, he completed an intensive educational program at Bangkit Academy 2024, where he studied in the Mobile Development Cohort.",
    "duration_ms": 7528,
    "notebook": "https://notebooklm.google.com/notebook/052a33bb-5f6c-4f37-9042-2f5d03294dab"
  },
  "meta": {
    "ip": "a3f2b1c9-1234-5678-abcd-ef0123456789",
    "timestamp": "2026-05-14T03:00:00.000Z"
  }
}
```

### `GET /api/history`

Conversation history for the current device.

| Param      | Default | Description             |
| ---------- | ------- | ----------------------- |
| `limit`    | `20`    | Max results (up to 100) |
| `notebook` | default | Filter by notebook URL  |

### `GET /api/logs`

Admin endpoint — all conversations across all users.

| Param   | Default | Description             |
| ------- | ------- | ----------------------- |
| `limit` | `50`    | Max results (up to 200) |

### `GET /api/notebook`

Get your currently active notebook and a list of all your saved notebook profiles.

```json
{
  "success": true,
  "data": {
    "current": "https://notebooklm.google.com/notebook/xxx",
    "currentTitle": "My Notebook",
    "profiles": [{ "url": "...", "title": "..." }]
  }
}
```

### `POST /api/notebook`

Switch to a different notebook for the current device. The Playwright session is loaded asynchronously in the background so the UI feels instant. If there is exactly one notebook profile globally in the database, it will be automatically assigned to new users as the default.

```json
{
  "url": "https://notebooklm.google.com/notebook/xxx"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "notebook": "https://notebooklm.google.com/notebook/xxx",
    "ip": "a3f2b1c9-...",
    "title": "Professional Portfolio of Muhammad Ayash Al-Fatih"
  }
}
```

### `PATCH /api/notebook`

Update the custom human-readable title for a saved notebook profile.

```json
{
  "url": "https://notebooklm.google.com/notebook/xxx",
  "title": "My Updated Custom Title"
}
```

### `DELETE /api/notebook`

Remove a saved notebook profile from your sidebar grid. (Note: The chat history associated with the notebook remains preserved in the database.)

```json
{
  "url": "https://notebooklm.google.com/notebook/xxx"
}
```

### `GET /health`

Server status, active sessions, and Google cookie expiry.

```json
{
    "status": "running",
    "ip": "a3f2b1c9-...",
    "currentNotebook": "https://notebooklm.google.com/notebook/xxx",
    "currentNotebookTitle": "Professional Portfolio of Muhammad Ayash Al-Fatih",
    "savedNotebooks": [
        {
            "url": "https://notebooklm.google.com/notebook/xxx",
            "title": "Professional Portfolio of Muhammad Ayash Al-Fatih"
        }
    ],
    "session": {
        "status": "valid",
        "expires_at": "2026-12-04T08:46:42.000Z",
        "remaining": "204d 13h",
        "account": ".google.com"
    },
    "sessions": {
        "active": 2,
        "max": 5,
        "details": [...]
    }
}
```

---

## Environment Variables

| Variable       | Default | Description                                 |
| -------------- | ------- | ------------------------------------------- |
| `PORT`         | `3005`  | Server port                                 |
| `MAX_SESSIONS` | `5`     | Max concurrent browser pages (LRU eviction) |
| `DB_DIR`       | `.`     | Directory for SQLite database file          |

---

## Web UI

Terminal-themed interface with:

- **JetBrains Mono** font, green-on-dark color scheme
- **Chat feed** with `❯ query` / `◆ response` terminal prompts
- **Sidebar** — notebook URL switcher, conversation history, session expiry
- **Mobile responsive** — hamburger menu with slide-out sidebar
- **Per-device history** — each browser sees only its own conversations
- **Live status** — connection indicator, auth expiry countdown

---

## Cookie Management

Google session cookies (~6 month expiry) are automatically extracted from Chrome's local SQLite database.

### How `login.js` Works

**On macOS:**

1. Reads Chrome's `Cookies` SQLite database (read-only).
2. Retrieves the encryption key via `security find-generic-password` (Keychain).
3. Decrypts `AES-128-CBC` encrypted cookie values and strips the 32-byte binary signature.

**On Windows:**

1. Copies the `Cookies` SQLite database to a temporary file (to bypass Chrome's strict file locks).
2. Retrieves the encrypted key from Chrome's `Local State` file and decrypts it using PowerShell's built-in `System.Security.Cryptography.ProtectedData` (no native addons required).
3. Decrypts `AES-256-GCM` encrypted cookie values.

> **Note:** Windows no longer requires `win-dpapi` or any C++ compilation tools. PowerShell handles DPAPI decryption natively.

Finally, it exports all `*google.com*` cookies to `auth-state.json` (Playwright format).

### Refresh Flow

```bash
npm run login                    # Re-extract from Chrome and update .env
# Copy the updated .env to your VPS, then:
docker compose up -d             # Restart container to pick up new env var
```

The web UI sidebar shows real-time cookie expiry so you know when to refresh.

---

## Database Schema

SQLite with WAL mode for concurrent reads.

```sql
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, notebook TEXT NOT NULL,
    query TEXT NOT NULL, response TEXT, markdown TEXT, status TEXT NOT NULL DEFAULT 'pending',
    duration_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_ip ON conversations(ip);

CREATE TABLE IF NOT EXISTS user_preferences (
    ip TEXT PRIMARY KEY, notebook TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_notebooks (
    ip TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (ip, url)
);
```

---

## Project Structure

```
notebook-lm-gateway/
├── index.js                 # Express server, Playwright session pool, API routes
├── login.js                 # Chrome cookie extractor (macOS Keychain decryption)
├── public/
│   └── index.html           # Terminal-themed web UI (single-file, no build step)
├── Dockerfile               # Node 20 slim + Playwright Chromium + build tools
├── docker-compose.yml       # Production config with persistent volume
├── .dockerignore            # Excludes node_modules, .git, gateway.db
├── .gitignore               # Excludes node_modules, auth-state.json, gateway.db
├── package.json             # Dependencies: express, playwright, better-sqlite3, cors
├── postman_collection.json  # Postman collection for API testing
├── auth-state.json          # Google cookies (generated, gitignored)
└── gateway.db               # SQLite database (auto-created, gitignored)
```

### Key Components

| File                | Role                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js`          | Express server with cookie-based device identity, Playwright page pool (LRU, max 5), query queue with serialized execution, HTML→markdown parser, session warmup |
| `login.js`          | Extracts Google cookies from Chrome's SQLite DB, decrypts via macOS Keychain (AES-128-CBC) or Windows DPAPI (AES-256-GCM), exports Playwright-compatible state   |
| `public/index.html` | Single-file terminal UI — JetBrains Mono, WebSocket-free, vanilla JS, responsive sidebar, history replay, session expiry panel                                   |

---

## Tech Stack

| Layer         | Technology                                   |
| ------------- | -------------------------------------------- |
| **Runtime**   | Node.js 20                                   |
| **Server**    | Express 5                                    |
| **Browser**   | Playwright + Chromium (headless)             |
| **Database**  | better-sqlite3 (WAL mode)                    |
| **Auth**      | Chrome cookie extraction via macOS Keychain or Windows PowerShell DPAPI |
| **Identity**  | Cookie-based UUID (`nlm_uid`, 1-year expiry) |
| **UI**        | Vanilla HTML/CSS/JS, JetBrains Mono          |
| **Container** | Docker (node:20-slim + Playwright deps)      |

---

## License

MIT
