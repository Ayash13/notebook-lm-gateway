const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../core/db');
const browser = require('../core/browser');

const router = express.Router();
const AUTH_STATE_PATH = path.join(__dirname, '../..', 'auth-state.json');

router.get('/api', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nlm::gateway API Docs</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
<style>
:root {
    --bg: #101014;
    --surface: #16161c;
    --s2: #1e1e26;
    --border: #2a2a35;
    --green: #5af7a8;
    --green-dim: #3dd68e;
    --green-dark: #1a3a2a;
    --cyan: #64d8ff;
    --yellow: #f5d67b;
    --red: #ff6b7a;
    --text: #d4d4dc;
    --muted: #6b6b80;
    --font: 'JetBrains Mono', monospace;
}
body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font) !important;
}
.swagger-ui {
    font-family: var(--font) !important;
    background-color: var(--bg) !important;
    color: var(--text) !important;
}
.swagger-ui .info .title,
.swagger-ui .info p,
.swagger-ui .info li,
.swagger-ui .info a,
.swagger-ui .info h1,
.swagger-ui .info h2,
.swagger-ui .info h3,
.swagger-ui .info h4,
.swagger-ui .info h5 {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui .info .title {
    color: var(--green) !important;
    font-weight: 700;
}
.swagger-ui .topbar { display: none !important; }
.swagger-ui .scheme-container {
    background: var(--surface) !important;
    border-bottom: 1px solid var(--border) !important;
    box-shadow: none !important;
    padding: 16px 30px !important;
    margin-bottom: 20px !important;
}
.swagger-ui .scheme-container label {
    color: var(--muted) !important;
}
.swagger-ui select {
    background: var(--bg) !important;
    color: var(--text) !important;
    border: 1px solid var(--border) !important;
    border-radius: 4px !important;
    font-family: var(--font) !important;
    outline: none;
    cursor: pointer;
}
.swagger-ui .opblock-tag {
    color: var(--cyan) !important;
    border-bottom: 1px solid var(--border) !important;
    font-family: var(--font) !important;
    font-size: 16px !important;
}
.swagger-ui .opblock-tag:hover {
    background: rgba(100, 216, 255, 0.03) !important;
}
.swagger-ui .opblock-tag small {
    color: var(--muted) !important;
}
.swagger-ui .opblock {
    background: var(--surface) !important;
    border: 1px solid var(--border) !important;
    box-shadow: none !important;
    border-radius: 6px !important;
}
.swagger-ui .opblock .opblock-summary-path,
.swagger-ui .opblock .opblock-summary-description,
.swagger-ui .opblock .opblock-summary-operation-id {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui .opblock .opblock-summary-method {
    font-family: var(--font) !important;
    font-weight: bold !important;
    border-radius: 4px !important;
}
.swagger-ui .opblock.opblock-get {
    border-color: rgba(100, 216, 255, 0.3) !important;
    background: rgba(100, 216, 255, 0.02) !important;
}
.swagger-ui .opblock.opblock-get .opblock-summary-method {
    background: var(--cyan) !important;
    color: #000 !important;
}
.swagger-ui .opblock.opblock-get .opblock-summary {
    border-bottom: 1px solid rgba(100, 216, 255, 0.15) !important;
}
.swagger-ui .opblock.opblock-post {
    border-color: rgba(90, 247, 168, 0.3) !important;
    background: rgba(90, 247, 168, 0.02) !important;
}
.swagger-ui .opblock.opblock-post .opblock-summary-method {
    background: var(--green) !important;
    color: #000 !important;
}
.swagger-ui .opblock.opblock-post .opblock-summary {
    border-bottom: 1px solid rgba(90, 247, 168, 0.15) !important;
}
.swagger-ui .opblock.opblock-patch {
    border-color: rgba(245, 214, 123, 0.3) !important;
    background: rgba(245, 214, 123, 0.02) !important;
}
.swagger-ui .opblock.opblock-patch .opblock-summary-method {
    background: var(--yellow) !important;
    color: #000 !important;
}
.swagger-ui .opblock.opblock-patch .opblock-summary {
    border-bottom: 1px solid rgba(245, 214, 123, 0.15) !important;
}
.swagger-ui .opblock.opblock-delete {
    border-color: rgba(255, 107, 122, 0.3) !important;
    background: rgba(255, 107, 122, 0.02) !important;
}
.swagger-ui .opblock.opblock-delete .opblock-summary-method {
    background: var(--red) !important;
    color: #000 !important;
}
.swagger-ui .opblock.opblock-delete .opblock-summary {
    border-bottom: 1px solid rgba(255, 107, 122, 0.15) !important;
}
.swagger-ui .opblock-section-header {
    background: transparent !important;
    border-bottom: 1px solid var(--border) !important;
}
.swagger-ui .opblock-section-header h4 {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui .tabli button {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui .tabli.active button {
    color: var(--green) !important;
}
.swagger-ui .parameter__name,
.swagger-ui .parameter__type,
.swagger-ui .parameter__deprecated,
.swagger-ui .parameter__in {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui .parameter__name.required span {
    color: var(--red) !important;
}
.swagger-ui .parameter__extension,
.swagger-ui .parameter__in {
    color: var(--muted) !important;
}
.swagger-ui .response-col_status,
.swagger-ui .response-col_links {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui input[type=text],
.swagger-ui textarea {
    background: var(--bg) !important;
    color: var(--text) !important;
    border: 1px solid var(--border) !important;
    border-radius: 4px !important;
    outline: none !important;
    font-family: var(--font) !important;
}
.swagger-ui input[type=text]:focus,
.swagger-ui textarea:focus {
    border-color: var(--green) !important;
}
.swagger-ui table thead tr td,
.swagger-ui table thead tr th {
    color: var(--muted) !important;
    border-bottom: 1px solid var(--border) !important;
    font-family: var(--font) !important;
}
.swagger-ui table tbody tr td {
    color: var(--text) !important;
    font-family: var(--font) !important;
}
.swagger-ui .btn {
    border-radius: 4px !important;
    font-family: var(--font) !important;
    transition: 0.2s !important;
    border-width: 1px !important;
}
.swagger-ui .btn.execute {
    background-color: var(--green-dark) !important;
    border-color: var(--green) !important;
    color: var(--green) !important;
}
.swagger-ui .btn.execute:hover {
    background-color: var(--green) !important;
    color: #000 !important;
}
.swagger-ui .btn.cancel {
    background-color: rgba(255, 107, 122, 0.1) !important;
    border-color: var(--red) !important;
    color: var(--red) !important;
}
.swagger-ui .btn.cancel:hover {
    background-color: var(--red) !important;
    color: #fff !important;
}
.swagger-ui .btn.try-out__btn {
    border-color: var(--cyan) !important;
    color: var(--cyan) !important;
    background: transparent !important;
}
.swagger-ui .btn.try-out__btn:hover {
    background: rgba(100, 216, 255, 0.1) !important;
}
.swagger-ui .model-box {
    background: var(--bg) !important;
    border: 1px solid var(--border) !important;
    border-radius: 4px !important;
}
.swagger-ui .model {
    color: var(--text) !important;
}
.swagger-ui .model-title {
    color: var(--cyan) !important;
}
.swagger-ui .prop-type {
    color: var(--green-dim) !important;
}
.swagger-ui .prop-format {
    color: var(--muted) !important;
}
.swagger-ui pre {
    background: var(--bg) !important;
    border: 1px solid var(--border) !important;
    border-radius: 4px !important;
    color: var(--green) !important;
    font-family: var(--font) !important;
}
.swagger-ui .highlight-code {
    background: var(--bg) !important;
}
.swagger-ui .microsite-link {
    display: none !important;
}
.swagger-ui .dialog-ux .modal-ux {
    background: var(--surface) !important;
    border: 1px solid var(--border) !important;
}
.swagger-ui .dialog-ux .modal-ux-header h3 {
    color: var(--text) !important;
}
.swagger-ui .dialog-ux .modal-ux-content p {
    color: var(--muted) !important;
}
</style>
</head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:'/swagger.json',dom_id:'#swagger-ui',deepLinking:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],layout:'BaseLayout'})</script>
</body></html>`);
});

router.get('/health', (req, res) => {
    const ip = req.clientId;
    const pref = db.stmtGetPref.get(ip);
    let userNotebook = pref ? pref.notebook : null;
    let userTitle = null;

    if (!userNotebook) {
        const anyNbs = db.stmtGetAnyNb.all();
        if (anyNbs.length === 1) {
            userNotebook = anyNbs[0].url;
            userTitle = anyNbs[0].title;
            db.stmtSetPref.run(ip, userNotebook);
        }
    }
    
    const savedNotebooks = db.stmtGetNbs.all(ip);
    if (userNotebook) {
        const found = savedNotebooks.find(n => n.url === userNotebook);
        if (found) userTitle = found.title;
    }
    
    const details = [];
    for (const [k, s] of browser.sessions) { details.push({ ip: k, notebook: s.notebook, queue: s.queue.length }); }

    let session = { status: 'unknown' };
    try {
        if (fs.existsSync(AUTH_STATE_PATH) && !fs.statSync(AUTH_STATE_PATH).isDirectory()) {
            const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
            const key = ['SID', '__Secure-1PSID', 'SSID', 'OSID'];
            const important = raw.cookies.filter(c => key.includes(c.name) && c.expires > 0);
            if (important.length) {
                const earliest = important.reduce((a, b) => a.expires < b.expires ? a : b);
                const expiresAt = new Date(earliest.expires * 1000);
                const now = new Date();
                const diffMs = expiresAt - now;
                session = {
                    status: diffMs > 0 ? 'valid' : 'expired',
                    expires_at: expiresAt.toISOString(),
                    remaining: diffMs > 0 ? `${Math.floor(diffMs / 86400000)}d ${Math.floor((diffMs % 86400000) / 3600000)}h` : 'expired',
                    account: raw.cookies.find(c => c.name === 'SAPISID')?.domain || '.google.com'
                };
            }
        }
    } catch {}

    res.json({ status: 'running', ip, currentNotebook: userNotebook, currentNotebookTitle: userTitle, savedNotebooks, session, sessions: { active: details.length, max: parseInt(process.env.MAX_SESSIONS) || 5, details } });
});

router.post('/api/ask', async (req, res) => {
    const ip = req.clientId;
    let nb = req.body.notebook;
    
    if (nb) {
        db.stmtSetPref.run(ip, nb);
    } else {
        const pref = db.stmtGetPref.get(ip);
        nb = pref ? pref.notebook : null;
        if (!nb) {
            const anyNbs = db.stmtGetAnyNb.all();
            if (anyNbs.length === 1) {
                nb = anyNbs[0].url;
                db.stmtSetPref.run(ip, nb);
            }
        }
    }
    
    if (!nb) return res.status(400).json({ success: false, error: { code: 'MISSING_NOTEBOOK', message: 'Notebook URL is required for the first query' } });
    if (!req.body.query) return res.status(400).json({ success: false, error: { code: 'MISSING_QUERY', message: 'query is required' } });

    const query = req.body.query;
    const row = db.stmtInsert.run(ip, nb, query);
    const id = row.lastInsertRowid;
    const start = Date.now();
    try {
        let s = browser.sessions.get(ip);
        if (!s || s.page.isClosed() || s.notebook !== nb) {
            s = await browser.getSession(ip, nb);
        } else { s.lastUsed = Date.now(); }
        const data = await browser.enqueue(s, query);
        const dur = Date.now() - start;
        db.stmtComplete.run(data.text, data.markdown, dur, id);
        res.json({ success: true, data: { id: Number(id), query, response: data.text, markdown: data.markdown, duration_ms: dur, notebook: nb }, meta: { ip, timestamp: new Date().toISOString() } });
    } catch (e) {
        db.stmtFail.run(e.message, id);
        res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: e.message } });
    }
});

router.get('/api/history', (req, res) => {
    const ip = req.clientId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let nb = req.query.notebook;
    if (!nb) {
        const pref = db.stmtGetPref.get(ip);
        nb = pref ? pref.notebook : null;
        if (!nb) {
            const anyNbs = db.stmtGetAnyNb.all();
            if (anyNbs.length === 1) {
                nb = anyNbs[0].url;
                db.stmtSetPref.run(ip, nb);
            }
        }
    }
    if (!nb) return res.json({ success: true, data: [], meta: { ip, count: 0 } });
    
    const rows = db.stmtHistory.all(ip, nb, limit);
    res.json({ success: true, data: rows, meta: { ip, notebook: nb, count: rows.length } });
});

router.get('/api/logs', (req, res) => {
    const rows = db.stmtAll.all(Math.min(parseInt(req.query.limit) || 50, 200));
    res.json({ success: true, data: rows, meta: { count: rows.length } });
});

router.get('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const pref = db.stmtGetPref.get(ip);
    let current = pref ? pref.notebook : null;
    const list = db.stmtGetNbs.all(ip);
    
    let currentTitle = null;
    if (!current) {
        const anyNbs = db.stmtGetAnyNb.all();
        if (anyNbs.length === 1) {
            current = anyNbs[0].url;
            currentTitle = anyNbs[0].title;
            db.stmtSetPref.run(ip, current);
        }
    } else {
        const found = list.find(n => n.url === current);
        if (found) currentTitle = found.title;
    }
    
    res.json({ success: true, data: { current, currentTitle, profiles: list } });
});

router.post('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const { url } = req.body;
    if (!url?.includes('notebooklm.google.com/notebook/')) return res.status(400).json({ success: false, error: { code: 'INVALID_URL', message: 'Invalid URL' } });
    try { 
        db.stmtSetPref.run(ip, url);
        
        let exist = db.stmtGetNbs.all(ip).find(n => n.url === url);
        if (!exist) {
            db.stmtSaveNb.run(ip, url, 'Untitled');
            exist = { title: 'Untitled' };
        }
        
        res.json({ success: true, data: { notebook: url, ip, title: exist.title } }); 

        browser.getSession(ip, url).then(s => {
            if (s.title && s.title !== 'Unknown Notebook') db.stmtSaveNb.run(ip, url, s.title);
        }).catch(e => console.error('[bg session error]', e));
    }
    catch (e) { 
        console.error('[API /notebook error]', e);
        res.status(500).json({ success: false, error: { code: 'SWITCH_FAILED', message: e.message } }); 
    }
});

router.patch('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const { url, title } = req.body;
    if(!url || !title) return res.status(400).json({success:false});
    db.stmtSaveNb.run(ip, url, title);
    res.json({ success: true });
});

router.delete('/api/notebook', (req, res) => {
    const ip = req.clientId;
    const { url } = req.body;
    if(!url) return res.status(400).json({success:false});
    db.stmtDeleteNb.run(ip, url);
    const pref = db.stmtGetPref.get(ip);
    if(pref && pref.notebook === url) {
        db.db.prepare(`DELETE FROM user_preferences WHERE ip=?`).run(ip);
    }
    res.json({ success: true });
});

module.exports = router;
