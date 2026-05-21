const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const browser = require('./src/core/browser');
const routes = require('./src/api/routes');
const db = require('./src/core/db');

const PORT = process.env.PORT || 3005;
const app = express();

app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

// Pages
const publicDir = path.join(__dirname, 'public');
app.get('/', async (req, res) => { await res.sendFile('landing.html', { root: publicDir }); });
app.get('/chat', async (req, res) => { await res.sendFile('chat.html', { root: publicDir }); });

// Static assets (CSS, JS, swagger.json)
app.use(express.static(path.join(__dirname, 'public')));

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

// API Routes
app.use('/', routes);

// Start
app.listen(PORT, async () => {
    console.log(`[start] http://localhost:${PORT}`);
    try { 
        await browser.boot(); 
    } catch (e) { 
        console.error('[error]', e.message); 
        process.exit(1); 
    }
});

process.on('SIGINT', async () => {
    await browser.shutdown();
    db.db.close(); 
    process.exit(0);
});
