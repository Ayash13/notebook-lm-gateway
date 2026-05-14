const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '../..');
const DB_PATH = path.join(DB_DIR, 'gateway.db');

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

module.exports = {
    db,
    stmtInsert: db.prepare(`INSERT INTO conversations (ip, notebook, query) VALUES (?, ?, ?)`),
    stmtComplete: db.prepare(`UPDATE conversations SET response=?, markdown=?, status='completed', duration_ms=?, completed_at=datetime('now') WHERE id=?`),
    stmtFail: db.prepare(`UPDATE conversations SET status='failed', response=?, completed_at=datetime('now') WHERE id=?`),
    stmtHistory: db.prepare(`SELECT id,query,response,markdown,status,duration_ms,created_at,completed_at FROM conversations WHERE ip=? AND notebook=? ORDER BY created_at DESC LIMIT ?`),
    stmtAll: db.prepare(`SELECT id,ip,notebook,query,response,status,duration_ms,created_at FROM conversations ORDER BY created_at DESC LIMIT ?`),
    stmtGetPref: db.prepare(`SELECT notebook FROM user_preferences WHERE ip=?`),
    stmtSetPref: db.prepare(`INSERT INTO user_preferences (ip, notebook) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET notebook=excluded.notebook`),
    stmtGetNbs: db.prepare(`SELECT url, title FROM saved_notebooks WHERE ip=? ORDER BY created_at DESC`),
    stmtSaveNb: db.prepare(`INSERT INTO saved_notebooks (ip, url, title) VALUES (?, ?, ?) ON CONFLICT(ip, url) DO UPDATE SET title=excluded.title`),
    stmtDeleteNb: db.prepare(`DELETE FROM saved_notebooks WHERE ip=? AND url=?`),
    stmtGetAnyNb: db.prepare(`SELECT DISTINCT url, title FROM saved_notebooks LIMIT 2`)
};
