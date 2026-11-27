#!/usr/bin/env node
// Run with node scripts/preview-apps.js [port]. Edits live in the system temp directory.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setupCategories, withSoftwareItems } = require('../src/setup.js');

const port = Number(process.argv[2] || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Expected a port from 1 to 65535.');
const source = path.resolve(__dirname, '..');
const identity = createHash('sha256').update(source + ':' + port).digest('hex').slice(0, 16);
const state = path.join(os.tmpdir(), 'wiki-apps-' + identity);
const uploaded = path.join(state, 'media');
const saved = path.join(state, 'apps.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-apps-build-'));

function privateDirectory(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
        throw new Error('Preview storage must be a private directory owned by the current user: ' + dir);
    }
}
privateDirectory(state);
privateDirectory(uploaded);

function copySource(name, destination) {
    fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, dereference: true });
}

// A build can remove or overwrite generated pages. Run it on a fresh copy so a failed
// save never disturbs the served site, and a successful save also removes old routes.
function build(data, content) {
    const dir = fs.mkdtempSync(path.join(scratch, 'site-'));
    try {
        for (const name of ['build.js', 'index.html', 'src', 'updates.json']) copySource(name, dir);
        fs.writeFileSync(path.join(dir, 'apps.json'), data);
        fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(content, null, 2) + '\n');
        execFileSync(process.execPath, [path.join(dir, 'build.js')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
        return dir;
    } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}

function etag(data) {
    return '"' + createHash('sha256').update(data).digest('hex') + '"';
}
for (const name of ['admin', 'assets', 'mcp', 'robots.txt', 'sitemap.xml']) copySource(name, scratch);
const stored = JSON.parse(fs.readFileSync(fs.existsSync(saved) ? saved : path.join(source, 'apps.json')));
const initial = JSON.stringify(Array.isArray(stored) ? stored : stored.pages, null, 2) + '\n';
let softwareItems = stored.softwareItems ?? [];
const sourceContent = JSON.parse(fs.readFileSync(path.join(source, 'content.json')));
let current = build(initial, withSoftwareItems(sourceContent, softwareItems));
let revision = etag(initial);

function fail(status, message) {
    throw Object.assign(new Error(message), { status });
}
function json(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(data));
}

async function body(req, limit) {
    if (Number(req.headers['content-length']) > limit) fail(413, 'The file is too large.');
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) fail(413, 'The file is too large.');
        parts.push(chunk);
    }
    return Buffer.concat(parts);
}

const mime = {
    '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
    '.txt': 'text/plain', '.xml': 'application/xml'
};

function fileResponse(req, res, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.some(part => part.startsWith('.') || /[\\\0]/.test(part))) fail(404, 'File not found.');
    let dir = current;
    if (['assets', 'admin', 'mcp', 'sitemap.xml', 'robots.txt'].includes(parts[0])) dir = scratch;
    else if (parts.length && !['index.html', 'apps', 'blog', 'src', 'apps.json', 'content.json', 'updates.json'].includes(parts[0])) fail(404, 'File not found.');
    let filename = path.join(dir, ...parts);
    if (parts.length === 3 && parts[0] === 'assets' && parts[1] === 'apps' && /^upload-[a-f0-9-]+\.(webp|webm)$/.test(parts[2])) {
        filename = path.join(uploaded, parts[2]);
    }
    if (fs.statSync(filename, { throwIfNoEntry: false })?.isDirectory()) {
        if (!pathname.endsWith('/')) {
            res.writeHead(301, { Location: encodeURI(pathname) + '/' });
            return res.end();
        }
        filename = path.join(filename, 'index.html');
    }
    const stat = fs.statSync(filename, { throwIfNoEntry: false });
    if (!stat?.isFile()) fail(404, 'File not found.');

    const headers = { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (pathname === '/apps.json') headers.ETag = revision;
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    // Mobile WebKit requests byte ranges even for short WebM previews.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
        start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(end, Number(range[2])) : end;
        if (start > end || (!range[1] && !range[2])) {
            res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
            return res.end();
        }
        status = 206;
        headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (!stat.size || req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filename, { fd: fs.openSync(filename, 'r'), start, end });
    res.once('close', () => stream.destroy());
    stream.on('error', () => res.destroy()).pipe(res);
}

async function saveApps(req, res) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'Expected JSON.');
    const bytes = await body(req, 2 * 1024 * 1024);
    if (req.headers['if-match'] && req.headers['if-match'] !== revision) fail(412, 'The pages changed. Reload before saving.');
    let payload;
    try { payload = JSON.parse(bytes); } catch { fail(400, 'Invalid JSON.'); }
    const apps = Array.isArray(payload) ? payload : payload?.pages;
    const additions = payload?.softwareItems ?? [];
    if (!Array.isArray(apps)) fail(400, 'Expected a list of app pages.');
    if (!Array.isArray(additions) || additions.some(item => typeof item !== 'string' || !item.trim())) {
        fail(400, 'Expected software item names.');
    }
    const slugs = new Set();
    for (const app of apps) {
        if (!app || typeof app.slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(app.slug) || slugs.has(app.slug)) {
            fail(400, 'Each app needs a unique URL slug using lowercase letters, numbers or hyphens.');
        }
        slugs.add(app.slug);
    }
    const data = JSON.stringify(apps, null, 2) + '\n';
    const labels = [...new Set([...softwareItems, ...additions])];
    const content = withSoftwareItems(sourceContent, labels);
    let next;
    try { next = build(data, content); } catch (error) {
        const detail = String(error.stderr || error.message).trim();
        console.error(detail);
        fail(422, 'Could not build these app pages. Check the page fields and media links.');
    }
    const pending = path.join(state, randomUUID() + '.tmp');
    try {
        fs.writeFileSync(pending, JSON.stringify({pages: apps, softwareItems: labels}), { flag: 'wx', mode: 0o600 });
        fs.renameSync(pending, saved);
    } catch (error) {
        fs.rmSync(next, { recursive: true, force: true });
        throw error;
    }
    const previous = current;
    softwareItems = labels;
    current = next;
    revision = etag(data);
    fs.rmSync(previous, { recursive: true, force: true });
    json(res, 200, { setupCategories: setupCategories(content) }, { ETag: revision });
}

async function upload(req, res, url) {
    const ext = path.extname(url.searchParams.get('filename') || '').toLowerCase();
    if (ext !== '.webp' && ext !== '.webm') fail(415, 'Choose a WebP image or a WebM video.');
    const type = req.headers['content-type']?.split(';')[0];
    if (type !== mime[ext] && type !== 'application/octet-stream') fail(415, 'Unexpected media type.');
    const bytes = await body(req, 50 * 1024 * 1024);
    const valid = ext === '.webp'
        ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        : bytes.subarray(0, 4).toString('hex') === '1a45dfa3';
    if (!valid) fail(415, 'The contents do not match the file extension.');
    const name = 'upload-' + randomUUID() + ext;
    fs.writeFileSync(path.join(uploaded, name), bytes, { flag: 'wx', mode: 0o600 });
    json(res, 201, { src: 'assets/apps/' + name });
}

const server = http.createServer(async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const host = req.headers.host;
        if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) fail(403, 'Loopback hosts only.');
        const origin = 'http://' + host;
        const url = new URL(req.url, origin);
        if (url.origin !== origin) fail(403, 'Unknown origin.');
        if (req.method === 'GET' || req.method === 'HEAD') {
            let pathname;
            try { pathname = decodeURIComponent(url.pathname); } catch { fail(400, 'Invalid URL encoding.'); }
            return fileResponse(req, res, pathname);
        }
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
            fail(403, 'Preview changes must originate from the local editor.');
        }
        if (req.method === 'PUT' && url.pathname === '/__preview/apps') return await saveApps(req, res);
        if (req.method === 'POST' && url.pathname === '/__preview/media') return await upload(req, res, url);
        fail(405, 'Unsupported request.');
    } catch (error) {
        if (!error.status) console.error(error);
        if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The local preview could not finish this request.' });
        else res.destroy();
    }
});
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(0));
server.listen(port, '127.0.0.1', () => {
    console.log('Preview: http://127.0.0.1:' + port + '/');
    console.log('Local editor data: ' + state);
});
