const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../core/db');
const browser = require('../core/browser');

const router = express.Router();
const AUTH_STATE_PATH = path.join(__dirname, '../..', 'auth-state.json');

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
        
        const exist = db.stmtGetNbs.all(ip).find(n => n.url === url);
        let title = exist ? exist.title : 'Connecting...';
        
        res.json({ success: true, data: { notebook: url, ip, title } }); 

        browser.getSession(ip, url).then(s => {
            if (!exist) db.stmtSaveNb.run(ip, url, s.title);
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
