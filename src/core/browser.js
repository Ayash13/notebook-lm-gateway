const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '../..', 'auth-state.json');
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS) || 5;

let browser, context, storageState;
const sessions = new Map();

async function boot() {
    if (!fs.existsSync(AUTH_STATE_PATH)) { console.error('Run: node login.js'); process.exit(1); }
    if (fs.statSync(AUTH_STATE_PATH).isDirectory()) {
        console.error('Error: auth-state.json is a directory, not a file. Verify your Docker volume/file mount paths.');
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const valid = ['Strict', 'Lax', 'None'];
    raw.cookies = raw.cookies.filter(c => c.name && c.value && c.domain).map(c => ({
        ...c, sameSite: valid.includes(c.sameSite) ? c.sameSite : 'Lax', expires: c.expires > 0 ? c.expires : -1
    }));
    storageState = raw;
    browser = await chromium.launch({ 
        headless: true,
        args: [
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--blink-settings=imagesEnabled=false'
        ]
    });
    context = await browser.newContext({
        storageState, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    await context.route('**/*', route => {
        const type = route.request().resourceType();
        const url = route.request().url();
        if (['image', 'media', 'font'].includes(type) || url.includes('play.google.com/log') || url.includes('google-analytics')) {
            route.abort();
        } else {
            route.continue();
        }
    });

    console.log('[ready] browser initialized');
}

async function shutdown() {
    for (const [, s] of sessions) try { await s.page.close(); } catch {}
    await context?.close(); await browser?.close();
}

async function createPage(notebookUrl) {
    try {
        const page = await context.newPage();
        await page.goto(notebookUrl, { waitUntil: 'commit', timeout: 60_000 });
        await page.waitForSelector('textarea.query-box-input', { timeout: 60_000 });
        let rawTitle = await page.textContent('.title-label-inner').catch(() => null);
        const title = rawTitle ? cleanText(rawTitle) : 'Unknown Notebook';
        return { page, title };
    } catch (e) {
        if (e.message.includes('browser has been closed') || e.message.includes('Target page')) {
            console.error('[playwright crash] Rebooting browser...');
            await boot();
            const page = await context.newPage();
            await page.goto(notebookUrl, { waitUntil: 'commit', timeout: 60_000 });
            await page.waitForSelector('textarea.query-box-input', { timeout: 60_000 });
            let rawTitle = await page.textContent('.title-label-inner').catch(() => null);
            const title = rawTitle ? cleanText(rawTitle) : 'Unknown Notebook';
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

    if (s && s.page) try { await s.page.close(); } catch {}
    const { page, title } = await createPage(notebookUrl);
    s = { page, title, notebook: notebookUrl, queue: [], busy: false, lastUsed: Date.now() };
    sessions.set(ip, s);
    return s;
}

function cleanText(text) { return text.replace(/<[^>]+>/g, '').trim(); }

function parseMarkdown(html) {
    return html.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gs, '### $1\n\n')
        .replace(/<p[^>]*>(.*?)<\/p>/gs, '$1\n\n')
        .replace(/<ul[^>]*>(.*?)<\/ul>/gs, '$1\n').replace(/<ol[^>]*>(.*?)<\/ol>/gs, '$1\n')
        .replace(/<li[^>]*>(.*?)<\/li>/gs, '- $1\n').replace(/<div[^>]*class="paragraph[^"]*"[^>]*>(.*?)<\/div>/gs, '$1\n\n')
        .replace(/<button[^>]*class="[^"]*citation-marker[^"]*"[^>]*>.*?<\/button>/g, '')
        .replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').replace(/\s{2,}/g, ' ').trim();
}

async function sendQuery(page, query) {
    const count = await page.locator('.chat-message-pair').count();
    await page.locator('textarea.query-box-input').fill(query);
    
    // Pressing Enter is slightly faster and bypasses any Angular UI button animations
    await page.keyboard.press('Enter');
    
    await page.waitForFunction(c => document.querySelectorAll('.chat-message-pair').length > c, count, { timeout: 120_000 });
    const latest = page.locator('.chat-message-pair').last();
    const content = latest.locator('.to-user-container .message-text-content');
    
    // Wait for the LLM to finish streaming its text
    await latest.locator('.message-actions').waitFor({ state: 'visible', timeout: 120_000 });
    
    // Remove citation markers from the DOM
    await content.evaluate(node => {
        node.querySelectorAll('.citation-marker').forEach(el => el.remove());
    });

    return { text: cleanText(await content.innerText()), markdown: parseMarkdown(await content.innerHTML()) };
}

async function processQueue(session) {
    if (session.busy || session.queue.length === 0) return;
    session.busy = true;
    const { query, resolve, reject } = session.queue.shift();
    try { resolve(await sendQuery(session.page, query)); } catch (e) { reject(e); }
    finally { session.busy = false; processQueue(session); }
}

function enqueue(session, query) {
    return new Promise((resolve, reject) => {
        session.queue.push({ query, resolve, reject });
        processQueue(session);
    });
}

module.exports = { boot, shutdown, getSession, enqueue, sessions };
