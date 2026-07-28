#!/usr/bin/env node
/**
 * Build step for justinmartin.wiki. Zero dependencies. Run: node build.js
 *
 *  1. Injects content.json into index.html between <!-- cms:x --> ... <!-- /cms:x --> markers.
 *  2. Generates a static page per published post in posts.json at blog/<slug>/index.html,
 *     reusing the homepage's own <style> block so the two never drift apart.
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const content = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function inject(name, replacement) {
    const re = new RegExp(`(<!-- cms:${name} -->)[\\s\\S]*?(<!-- /cms:${name} -->)`, 'g');
    let found = false;
    // Replacement via function so "$" in content is never treated as a capture-group reference.
    html = html.replace(re, (m, open, close) => { found = true; return open + replacement + close; });
    if (!found) {
        console.error(`Marker cms:${name} not found in index.html`);
        process.exit(1);
    }
}

// Greeting (inline HTML allowed)
inject('greeting', content.greeting);

// Bio paragraphs (fade-up stagger: delay-3, delay-4, then delay-5 for the rest)
inject('bio', content.bio.map((p, i) =>
    `\n            <p class="fade-up delay-${Math.min(3 + i, 5)}">${p}</p>\n`
).join('') + '        ');

// Thoughts list
inject('thoughts', '\n' + content.thoughts.map((t) =>
    `                            <li>${t}</li>`
).join('\n') + '\n                        ');

// Hobbies tags (optional url per tag)
inject('hobbies', '\n' + content.hobbies.map((h) => {
    const label = h.label;
    if (h.url) {
        const url = h.url.replace(/&(?!amp;)/g, '&amp;');
        return `                            <a class="tag" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return `                            <span class="tag">${label}</span>`;
}).join('\n') + '\n                        ');

// Setup tags
inject('setup', '\n' + content.setup.map((s) =>
    `                            <span class="tag">${s}</span>`
).join('\n') + '\n                        ');

// Photo caption
inject('caption', content.photoCaption);

// Last updated — stamped at build time (America/Chicago) so every deploy
// self-dates. Runs on every push, so no source of publish is ever missed
// and nothing has to be edited by hand. Format: MM-DD-YY.
const stamp = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: '2-digit'
}).format(new Date()).replace(/\//g, '-');
inject('updated', `Last updated ${stamp}`);

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html from content.json');

// ---------------------------------------------------------------------------
// Blog posts → blog/<slug>/index.html
// ---------------------------------------------------------------------------

const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Plain-text (for <title>/meta): drop tags, collapse whitespace, then escape.
const metaText = (s, max) => {
    const text = String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const clipped = max && text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
    return escapeHtml(clipped);
};

// Body blocks: { type:'p', text } or { type:'ul', items:[] }. Legacy posts stored
// plain strings for paragraphs — normalize those so old posts keep rendering.
const normalizeBlock = (b) => {
    if (typeof b === 'string') return { type: 'p', text: b };
    if (b && b.type === 'ul') return { type: 'ul', items: Array.isArray(b.items) ? b.items : [] };
    return { type: 'p', text: (b && b.text) || '' };
};

// Pull the homepage's inline <style> so post pages are pixel-identical, no duplication.
const sharedStyle = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];

function renderPost(post) {
    const url = `https://justinmartin.wiki/blog/${post.slug}/`;
    const title = escapeHtml(post.title || 'Untitled');
    const desc = metaText(post.body && post.body[0], 155);
    const ogImage = post.image
        ? `https://justinmartin.wiki/${post.image}`
        : 'https://justinmartin.wiki/assets/photo.webp';

    // Body blocks reuse the bio's .bio p styling and the homepage .thoughts-list bullets,
    // with the fade-up stagger (delay-3..5) carried across blocks.
    let delay = 3;
    const bodyHtml = (post.body || []).map(normalizeBlock)
        .filter((b) => b.type === 'ul' ? b.items.some((i) => String(i).trim()) : String(b.text).trim())
        .map((b) => {
            const d = Math.min(delay++, 5);
            if (b.type === 'ul') {
                const lis = b.items.filter((i) => String(i).trim())
                    .map((i) => `                <li>${i}</li>`).join('\n');
                return `            <ul class="thoughts-list fade-up delay-${d}">\n${lis}\n            </ul>`;
            }
            return `            <p class="fade-up delay-${d}">${b.text}</p>`;
        }).join('\n');

    const photo = post.image ? `
    <aside class="photo-column" aria-label="Post image">
        <img class="photo-main" src="/${post.image}" alt="${escapeHtml(post.imageAlt || post.title || '')}" decoding="async">
    </aside>` : '';

    const bodyClass = post.image ? '' : ' class="no-photo"';
    const dateLine = post.date ? `Last updated ${escapeHtml(post.date)}` : '';

    // Post-only tweaks appended after the shared homepage styles.
    const extraStyle = `
    <style>
        .back-link{text-decoration:none}
        .back-link:hover{opacity:.55}
        .bio .thoughts-list{margin-bottom:20px}
        .bio > :last-child{margin-bottom:0}
        @media (min-width:1101px){.no-photo .page{margin-right:auto}}
    </style>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} &middot; Justin Martin</title>
    <meta name="description" content="${desc}">
    <meta name="theme-color" content="#ffffff">
    <link rel="canonical" href="${url}">
    <link rel="icon" type="image/png" href="/assets/png-354cc08a9867.png">

    <meta property="og:type" content="article">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${ogImage}">
    <meta name="twitter:card" content="summary_large_image">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400&display=swap">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400&display=swap" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400&display=swap"></noscript>

    ${sharedStyle}${extraStyle}
</head>
<body${bodyClass}>
    <div class="page-wrapper">
    <main class="page">
        <div class="bio">
            <h1 class="bio-greeting fade-up delay-2">${title}</h1>
${bodyHtml}
        </div>

        <div class="footer footer-mobile">${dateLine}</div>
    </main>
${photo}
    </div>

    <div class="footer footer-desktop">${dateLine}</div>

    <a class="now-playing back-link" href="/">&larr; Back</a>
</body>
</html>
`;
}

const blogDir = path.join(root, 'blog');
// Rebuild blog/ from scratch every run so deleted / renamed / unpublished posts
// never leave an orphan folder behind.
fs.rmSync(blogDir, { recursive: true, force: true });

let posts = [];
const postsPath = path.join(root, 'posts.json');
if (fs.existsSync(postsPath)) {
    try {
        posts = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
    } catch (err) {
        console.error('posts.json is not valid JSON:', err.message);
        process.exit(1);
    }
}
if (!Array.isArray(posts)) posts = [];

const live = posts.filter((p) => p && p.published && p.slug);
live.forEach((post) => {
    const dir = path.join(blogDir, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPost(post));
});
console.log(`Built ${live.length} post page(s) into blog/`);
