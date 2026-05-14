const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const DB_DIR = process.env.DB_DIR || __dirname;
const DB_PATH = path.join(DB_DIR, 'gateway.db');
const PORT = process.env.PORT || 3005;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS) || 5;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true);

// --- Database ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
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
`);

const stmtInsert = db.prepare(`INSERT INTO conversations (ip, notebook, query) VALUES (?, ?, ?)`);
const stmtComplete = db.prepare(`UPDATE conversations SET response=?, markdown=?, status='completed', duration_ms=?, completed_at=datetime('now') WHERE id=?`);
const stmtFail = db.prepare(`UPDATE conversations SET status='failed', response=?, completed_at=datetime('now') WHERE id=?`);
const stmtHistory = db.prepare(`SELECT id,query,response,markdown,status,duration_ms,created_at,completed_at FROM conversations WHERE ip=? AND notebook=? ORDER BY created_at DESC LIMIT ?`);
const stmtAll = db.prepare(`SELECT id,ip,notebook,query,response,status,duration_ms,created_at FROM conversations ORDER BY created_at DESC LIMIT ?`);
const stmtGetPref = db.prepare(`SELECT notebook FROM user_preferences WHERE ip=?`);
const stmtSetPref = db.prepare(`INSERT INTO user_preferences (ip, notebook) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET notebook=excluded.notebook`);
const stmtGetNbs = db.prepare(`SELECT url, title FROM saved_notebooks WHERE ip=? ORDER BY created_at DESC`);
const stmtSaveNb = db.prepare(`INSERT INTO saved_notebooks (ip, url, title) VALUES (?, ?, ?) ON CONFLICT(ip, url) DO UPDATE SET title=excluded.title`);
const stmtDeleteNb = db.prepare(`DELETE FROM saved_notebooks WHERE ip=? AND url=?`);
const stmtGetAnyNb = db.prepare(`SELECT DISTINCT url, title FROM saved_notebooks LIMIT 2`);

// --- Globals ---
const crypto = require('crypto');

let browser, context, storageState;
const sessions = new Map();

// Assign each browser a unique ID via cookie
app.use((req, res, next) => {
    let uid = req.headers.cookie?.match(/nlm_uid=([^;]+)/)?.[1];
    if (!uid) {
        uid = crypto.randomUUID();
        res.setHeader('Set-Cookie', `nlm_uid=${uid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    req.clientId = uid;
    next();
});

// --- Session ---
async function createPage(notebookUrl) {
    try {
        const page = await context.newPage();
        await page.goto(notebookUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForSelector('textarea.query-box-input', { timeout: 60_000 });
        const title = await page.textContent('.title-label-inner').catch(() => null) || 'Unknown Notebook';
        return { page, title };
    } catch (e) {
        if (e.message.includes('browser has been closed') || e.message.includes('Target page, context or browser has been closed')) {
            console.error('[playwright crash] Rebooting browser...');
            await boot();
            // Retry once
            const page = await context.newPage();
            await page.goto(notebookUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await page.waitForSelector('textarea.query-box-input', { timeout: 60_000 });
            const title = await page.textContent('.title-label-inner').catch(() => null) || 'Unknown Notebook';
            return { page, title };
        }
        throw e;
    }
}

async function getSession(ip, notebookUrl) {
    let s = sessions.get(ip);
    if (s && s.notebook === notebookUrl && s.page && !s.page.isClosed()) { s.lastUsed = Date.now(); return s; }

    if (!s && sessions.size >= MAX_SESSIONS) {
        let oldest = null;
        for (const [k, v] of sessions) if (!oldest || v.lastUsed < oldest.lastUsed) oldest = { key: k, session: v };
        if (oldest) { try { await oldest.session.page.close(); } catch {} sessions.delete(oldest.key); }
    }
    if (s?.page && !s.page.isClosed()) try { await s.page.close(); } catch {}

    const { page, title } = await createPage(notebookUrl);
    s = { page, notebook: notebookUrl, title, queue: [], processing: false, lastUsed: Date.now() };
    sessions.set(ip, s);
    console.log(`[session] ${ip} (${sessions.size}/${MAX_SESSIONS})`);
    return s;
}

// --- Queue ---
async function processQueue(s) {
    if (s.processing || s.queue.length === 0) return;
    s.processing = true;
    const { query, resolve, reject } = s.queue.shift();
    try { resolve(await sendQuery(s.page, query)); } catch (e) { reject(e); }
    s.processing = false;
    processQueue(s);
}

function enqueue(s, query) {
    return new Promise((resolve, reject) => { s.queue.push({ query, resolve, reject }); processQueue(s); });
}

// --- Parser ---
function cleanText(raw) {
    return raw.replace(/\n(\d+)\n/g, '').replace(/\n(\d+)$/g, '')
        .replace(/(\d+)\n/g, (m, n) => parseInt(n) <= 20 ? '' : m).replace(/\s{2,}/g, ' ').trim();
}

function parseMarkdown(html) {
    return html.replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**').replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
        .replace(/<li[^>]*>(.*?)<\/li>/gs, '- $1\n').replace(/<div[^>]*class="paragraph[^"]*"[^>]*>(.*?)<\/div>/gs, '$1\n\n')
        .replace(/<button[^>]*class="[^"]*citation-marker[^"]*"[^>]*>.*?<\/button>/g, '')
        .replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').replace(/\s{2,}/g, ' ').trim();
}

// --- Core ---
async function sendQuery(page, query) {
    const count = await page.locator('.chat-message-pair').count();
    await page.locator('textarea.query-box-input').fill(query);
    await page.locator('button.submit-button').click();
    await page.waitForFunction(c => document.querySelectorAll('.chat-message-pair').length > c, count, { timeout: 120_000 });
    const latest = page.locator('.chat-message-pair').last();
    const content = latest.locator('.to-user-container .message-text-content');
    await latest.locator('.message-actions').waitFor({ state: 'visible', timeout: 120_000 });
    return { text: cleanText(await content.innerText()), markdown: parseMarkdown(await content.innerHTML()) };
}

// --- Boot ---
async function boot() {
    if (!fs.existsSync(AUTH_STATE_PATH)) { console.error('Run: node login.js'); process.exit(1); }
    const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const valid = ['Strict', 'Lax', 'None'];
    raw.cookies = raw.cookies.filter(c => c.name && c.value && c.domain).map(c => ({
        ...c, sameSite: valid.includes(c.sameSite) ? c.sameSite : 'Lax', expires: c.expires > 0 ? c.expires : -1
    }));
    storageState = raw;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
        storageState, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });
    console.log('[ready] gateway online');
}

// --- Routes ---
app.get('/health', (req, res) => {
    const ip = req.clientId;
    const pref = stmtGetPref.get(ip);
    let userNotebook = pref ? pref.notebook : null;
    let userTitle = null;

    if (!userNotebook) {
        const anyNbs = stmtGetAnyNb.all();
        if (anyNbs.length === 1) {
            userNotebook = anyNbs[0].url;
            userTitle = anyNbs[0].title;
            stmtSetPref.run(ip, userNotebook);
        }
    }
    
    const savedNotebooks = stmtGetNbs.all(ip);
    if (userNotebook) {
        const found = savedNotebooks.find(n => n.url === userNotebook);
        if (found) userTitle = found.title;
    }
    
    const details = [];
    for (const [k, s] of sessions) { details.push({ ip: k, notebook: s.notebook, queue: s.queue.length }); }

    // Session expiry from auth cookies
    let session = { status: 'unknown' };
    try {
        const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
        const key = ['SID', '__Secure-1PSID', 'SSID', 'OSID'];
        const important = raw.cookies.filter(c => key.includes(c.name) && c.expires > 0);
        if (important.length) {
            const earliest = important.reduce((a, b) => a.expires < b.expires ? a : b);
            const expiresAt = new Date(earliest.expires * 1000);
            const now = new Date();
            const diffMs = expiresAt - now;
            const diffDays = Math.floor(diffMs / 86400000);
            const diffHours = Math.floor((diffMs % 86400000) / 3600000);
            session = {
                status: diffMs > 0 ? 'valid' : 'expired',
                expires_at: expiresAt.toISOString(),
                remaining: diffMs > 0 ? `${diffDays}d ${diffHours}h` : 'expired',
                account: raw.cookies.find(c => c.name === 'SAPISID')?.domain || '.google.com'
            };
        }
    } catch {}

    res.json({ status: 'running', ip, currentNotebook: userNotebook, currentNotebookTitle: userTitle, savedNotebooks, session, sessions: { active: details.length, max: MAX_SESSIONS, details } });
});

app.post('/api/ask', async (req, res) => {
    const ip = req.clientId;
    let nb = req.body.notebook;
    
    if (nb) {
        stmtSetPref.run(ip, nb);
    } else {
        const pref = stmtGetPref.get(ip);
        nb = pref ? pref.notebook : null;
    }
    
    if (!nb) return res.status(400).json({ success: false, error: { code: 'MISSING_NOTEBOOK', message: 'Notebook URL is required for the first query' } });
    if (!req.body.query) return res.status(400).json({ success: false, error: { code: 'MISSING_QUERY', message: 'query is required' } });

    const query = req.body.query;
    const row = stmtInsert.run(ip, nb, query);
    const id = row.lastInsertRowid;
    const start = Date.now();
    try {
        let s = sessions.get(ip);
        if (!s || s.page.isClosed() || s.notebook !== nb) {
            s = await getSession(ip, nb);
        } else { s.lastUsed = Date.now(); }
        const data = await enqueue(s, query);
        const dur = Date.now() - start;
        stmtComplete.run(data.text, data.markdown, dur, id);
        res.json({ success: true, data: { id: Number(id), query, response: data.text, markdown: data.markdown, duration_ms: dur, notebook: nb }, meta: { ip, timestamp: new Date().toISOString() } });
    } catch (e) {
        stmtFail.run(e.message, id);
        res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: e.message } });
    }
});

app.get('/api/history', (req, res) => {
    const ip = req.clientId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let nb = req.query.notebook;
    if (!nb) {
        const pref = stmtGetPref.get(ip);
        nb = pref ? pref.notebook : null;
        if (!nb) {
            const anyNbs = stmtGetAnyNb.all();
            if (anyNbs.length === 1) {
                nb = anyNbs[0].url;
                stmtSetPref.run(ip, nb);
            }
        }
    }
    if (!nb) return res.json({ success: true, data: [], meta: { ip, count: 0 } });
    
    const rows = stmtHistory.all(ip, nb, limit);
    res.json({ success: true, data: rows, meta: { ip, notebook: nb, count: rows.length } });
});

app.get('/api/logs', (req, res) => {
    const rows = stmtAll.all(Math.min(parseInt(req.query.limit) || 50, 200));
    res.json({ success: true, data: rows, meta: { count: rows.length } });
});

app.post('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const { url } = req.body;
    if (!url?.includes('notebooklm.google.com/notebook/')) return res.status(400).json({ success: false, error: { code: 'INVALID_URL', message: 'Invalid URL' } });
    try { 
        stmtSetPref.run(ip, url);
        
        // Find existing title
        const exist = stmtGetNbs.all(ip).find(n => n.url === url);
        let title = exist ? exist.title : 'Connecting...';
        
        res.json({ success: true, data: { notebook: url, ip, title } }); 

        // Load session in background to make switching instant
        getSession(ip, url).then(s => {
            stmtSaveNb.run(ip, url, s.title);
        }).catch(e => console.error('[bg session error]', e));
    }
    catch (e) { 
        console.error('[API /notebook error]', e);
        res.status(500).json({ success: false, error: { code: 'SWITCH_FAILED', message: e.message } }); 
    }
});

app.patch('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const { url, title } = req.body;
    if(!url || !title) return res.status(400).json({success:false});
    stmtSaveNb.run(ip, url, title);
    res.json({ success: true });
});

app.delete('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const { url } = req.body;
    if(!url) return res.status(400).json({success:false});
    stmtDeleteNb.run(ip, url);
    // If deleted notebook is active, clear it
    const pref = stmtGetPref.get(ip);
    if(pref && pref.notebook === url) {
        db.prepare(`DELETE FROM user_preferences WHERE ip=?`).run(ip);
    }
    res.json({ success: true });
});

// --- Start ---
app.listen(PORT, async () => {
    console.log(`[start] http://localhost:${PORT}`);
    try { await boot(); } catch (e) { console.error('[error]', e.message); process.exit(1); }
});

process.on('SIGINT', async () => {
    for (const [, s] of sessions) try { await s.page.close(); } catch {}
    await context?.close(); await browser?.close(); db.close(); process.exit(0);
});
