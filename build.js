#!/usr/bin/env node
/**
 * Build step for justinmartin.wiki. Zero dependencies. Run: node build.js
 *
 *  1. Injects content.json into index.html between <!-- cms:x --> ... <!-- /cms:x --> markers.
 *  2. Renders published posts inline in the feed and leaves lightweight redirects at
 *     legacy blog/<slug>/ URLs so old bookmarks open the matching feed article.
 *  3. Builds standalone app trays at apps/<slug>/ and links them from My setup.
 */
const fs = require('fs');
const path = require('path');
const { youtubeVideoId } = require('./src/youtube.js');
const { setupCategories } = require('./src/setup.js');

const root = __dirname;
const content = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function inject(name, replacement) {
    html = fillMarker(html, name, replacement);
}

function fillMarker(template, name, replacement) {
    const re = new RegExp(`(<!-- cms:${name} -->)[\\s\\S]*?(<!-- /cms:${name} -->)`, 'g');
    if (!re.test(template)) throw new Error(`Marker cms:${name} not found in index.html`);
    return template.replace(re, (_, open, close) => open + replacement + close);
}

// Greeting (inline HTML allowed)
inject('greeting', content.greeting);

// Bio paragraphs (fade-up stagger: delay-3, delay-4, then delay-5 for the rest)
inject('bio', content.bio.map((p, i) =>
    `\n            <p class="fade-up delay-${Math.min(3 + i, 5)}">${p}</p>\n`
).join('') + '        ');

// Hobbies tags (optional url per tag)
inject('hobbies', '\n' + content.hobbies.map((h) => {
    const label = h.label;
    if (h.url) {
        const url = h.url.replace(/&(?!amp;)/g, '&amp;');
        return `                            <a class="tag" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return `                            <span class="tag">${label}</span>`;
}).join('\n') + '\n                        ');

// Photo caption
inject('caption', content.photoCaption);

// Last updated — stamped at build time (America/Chicago) so every deploy
// self-dates. Runs on every push, so no source of publish is ever missed
// and nothing has to be edited by hand. Format: MM-DD-YY.
const stamp = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: '2-digit'
}).format(new Date()).replace(/\//g, '-');
inject('updated', `Last updated ${stamp}`);

const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const apps = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
const appSlugs = new Set();
const appsByItem = new Map();
for (const app of apps) {
    if (typeof app.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug) || appSlugs.has(app.slug)) {
        throw new Error(`Invalid or duplicate app slug: ${app.slug}`);
    }
    appSlugs.add(app.slug);
    const item = (app.setupItem || '').trim().toLowerCase();
    if (item) {
        if (appsByItem.has(item)) throw new Error(`Multiple pages linked to setup item: ${app.setupItem}`);
        appsByItem.set(item, app);
    }
}

const setupLists = [];
for (const category of setupCategories(content)) {
    const label = category.label.trim().toLowerCase();
    const items = category.items.map(item => item.trim()).filter(Boolean);
    if (!label || !items.length) continue;
    const tags = items.map(item => {
        const app = appsByItem.get(item.toLowerCase());
        const tag = app
            ? `<a class="tag" data-app-link="${app.slug}" href="/apps/${app.slug}/">${escapeHtml(item)}</a>`
            : `<span class="tag">${escapeHtml(item)}</span>`;
        return '                            ' + tag;
    });
    setupLists.push(`                        <div class="tag-list setup-loadout" data-category="${escapeHtml(label)}"${setupLists.length ? ' hidden' : ''}>
${tags.join('\n')}
                        </div>`);
}
inject('setup', '\n' + setupLists.join('\n') + '\n                    ');

// Feed article blocks. Existing paragraph/list posts remain valid while newer
// posts can mix headings, quotes, individual images, and multi-image galleries.
const normalizeBlock = (b) => {
    if (typeof b === 'string') return { type: 'p', text: b };
    if (!b || typeof b !== 'object') return { type: 'p', text: '' };
    if (b.type === 'ul') return { type: 'ul', items: Array.isArray(b.items) ? b.items : [] };
    if (b.type === 'heading') return { type: 'heading', text: b.text || '' };
    if (b.type === 'quote') return { type: 'quote', text: b.text || '' };
    if (b.type === 'image') return { type: 'image', src: b.src || '', alt: b.alt || '', caption: b.caption || '' };
    if (b.type === 'gallery') return { type: 'gallery', images: Array.isArray(b.images) ? b.images : [] };
    return { type: 'p', text: b.text || '' };
};

const assetHref = (src) => {
    const value = String(src || '').trim();
    if (!value) return '';
    return /^(?:https?:|data:|\/)/i.test(value) ? value : `/${value}`;
};

// A status can embed YouTube in place of one WebM or up to five photos. `images` lists every photo in
// order; `image` stays as the first one so older readers keep working.
const MAX_POST_IMAGES = 5;
const postImages = (post) => {
    const list = Array.isArray(post.images) && post.images.length ? post.images : (post.image ? [post.image] : []);
    return list.map(assetHref).filter(Boolean).slice(0, MAX_POST_IMAGES);
};

function renderCarousel(slides, label) {
    return `
                    <div class="feed-post-gallery" role="group" aria-roledescription="carousel" aria-label="${escapeHtml(label)}">
                        <div class="feed-post-gallery-track" tabindex="0">${slides.map(slide => `
                            <figure class="feed-post-gallery-slide">${slide}</figure>`).join('')}
                        </div>
                    </div>`;
}

const renderPostMedia = (post) => {
    const youtubeId = post.type === 'status' && youtubeVideoId(post.youtubeUrl);
    if (youtubeId) {
        const statusText = String(post.text || '').replace(/<[^>]*>/g, '').trim();
        const title = escapeHtml(post.youtubeTitle || statusText || 'YouTube video');
        return `
                    <figure class="feed-post-media">
                        <button class="feed-youtube-preview" type="button" aria-label="Play ${title}" hidden>
                            <img data-src="https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg" loading="lazy" decoding="async" alt="">
                        </button>
                        <iframe class="feed-youtube" data-src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=0&amp;controls=1&amp;playsinline=1" title="${title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
                    </figure>`;
    }
    const videoSrc = assetHref(post.video);
    if (videoSrc) {
        return `
                    <figure class="feed-post-media">
                        <video class="feed-post-video" data-src="${escapeHtml(videoSrc)}" muted loop playsinline preload="none" aria-label="${escapeHtml(post.title || 'Post preview video')}"></video>
                    </figure>`;
    }
    const images = postImages(post);
    if (!images.length) return '';
    const alt = escapeHtml(post.imageAlt || post.title || '');
    if (images.length === 1) {
        return `
                    <figure class="feed-post-media">
                        <img src="${escapeHtml(images[0])}" alt="${alt}" loading="lazy" decoding="async">
                    </figure>`;
    }
    // Several photos scroll sideways: one snapped into view, the next peeking in at the edge.
    const slides = images.map((src, i) => {
        const label = alt ? `${alt} (${i + 1} of ${images.length})` : `Photo ${i + 1} of ${images.length}`;
        return `<img src="${escapeHtml(src)}" alt="${label}" loading="lazy" decoding="async" draggable="false">`;
    });
    return renderCarousel(slides, `${images.length} photos`);
};

const renderFeedBlock = (rawBlock) => {
    const block = normalizeBlock(rawBlock);
    if (block.type === 'ul') {
        const items = block.items.filter((item) => String(item).trim())
            .map((item) => `<li>${item}</li>`).join('');
        return items ? `<ul class="feed-article-list">${items}</ul>` : '';
    }
    if (block.type === 'heading') {
        return block.text ? `<h3 class="feed-article-heading">${block.text}</h3>` : '';
    }
    if (block.type === 'quote') {
        return block.text ? `<blockquote class="feed-article-quote">${block.text}</blockquote>` : '';
    }
    if (block.type === 'image') {
        const src = assetHref(block.src);
        if (!src) return '';
        const caption = block.caption ? `<figcaption class="feed-article-caption">${block.caption}</figcaption>` : '';
        return `<figure class="feed-article-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}" loading="lazy" decoding="async">${caption}</figure>`;
    }
    if (block.type === 'gallery') {
        const figures = block.images.map((entry) => typeof entry === 'string' ? { src: entry } : (entry || {}))
            .map((entry) => {
                const src = assetHref(entry.src);
                if (!src) return '';
                const caption = entry.caption ? `<figcaption class="feed-article-caption">${entry.caption}</figcaption>` : '';
                return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(entry.alt || '')}" loading="lazy" decoding="async">${caption}</figure>`;
            }).filter(Boolean).join('');
        return figures ? `<div class="feed-article-gallery">${figures}</div>` : '';
    }
    return block.text ? `<p class="feed-article-p">${block.text}</p>` : '';
};

// updates.json is the single chronological source for both lean statuses and full
// notes. The admin writes both formats here so navigation never grows per post.
let updates = [];
const updatesPath = path.join(root, 'updates.json');
if (fs.existsSync(updatesPath)) {
    try {
        updates = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));
    } catch (err) {
        console.error('updates.json is not valid JSON:', err.message);
        process.exit(1);
    }
}
if (!Array.isArray(updates)) updates = [];

// ---------------------------------------------------------------------------
// Latest posts tree → cms:posts (top 3 published, newest first)
// Rendered as an analog file-tree inside the "What's on my mind" accordion.
// The (MM-DD) suffix is derived here from each post's date, not stored in the post.
// ---------------------------------------------------------------------------

// "07-27-26" -> "07-27"
const mmdd = (date) => {
    const [mm, dd] = String(date == null ? '' : date).split('-');
    return mm && dd ? `${mm}-${dd}` : '';
};
const updateTimestamp = (update) => {
    const created = Date.parse(update && update.createdAt ? update.createdAt : '');
    if (Number.isFinite(created)) return created;
    const [mm, dd, yy] = String(update && update.date ? update.date : '').split('-');
    return Date.parse(`20${yy || '00'}-${mm || '01'}-${dd || '01'}T12:00:00-05:00`) || 0;
};

const updateDate = (update) => {
    const date = new Date(update && update.createdAt ? update.createdAt : '');
    if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: '2-digit'
        }).format(date).replace(/\//g, '-');
    }
    return String(update && update.date ? update.date : '');
};

const publishedUpdates = updates
    .filter((update) => update && update.published && (update.type === 'status' || update.type === 'note'))
    .sort((a, b) => updateTimestamp(b) - updateTimestamp(a));
const publishedPosts = publishedUpdates.filter((update) => update.type === 'note' && update.slug);
const publishedStatuses = publishedUpdates.filter((update) => update.type === 'status' && String(update.text || '').trim());

// The compact mobile accordion shows the newest lean statuses. Desktop opens the
// full mixed feed instead.
inject('thoughts', '\n' + publishedStatuses.slice(0, 3).map((status) =>
    `                            <li>${status.text}</li>`
).join('\n') + '\n                        ');

const latest = publishedPosts.slice(0, 3);

const postRows = latest.map((p) => {
    const md = mmdd(updateDate(p));
    const label = md ? `${escapeHtml(p.title)} (${escapeHtml(md)})` : escapeHtml(p.title);
    return `                            <li><a href="/?post=${encodeURIComponent(p.slug)}">${label}</a></li>`;
}).join('\n');

inject('posts', `
                        <div class="posts-title">Latest posts</div>
                        <ul class="posts-list">
${postRows}
                        </ul>
                        <ul class="posts-list posts-list--archive">
                            <li><a href="/?feed=all">Archive</a></li>
                        </ul>
                    `);

// ---------------------------------------------------------------------------
// Feed window → cms:feed
// Statuses and full notes are rendered from the same ordered update stream.
// ---------------------------------------------------------------------------
const renderStatusCard = (update) => {
    // The compact mobile accordion owns the unique observation-count id; the
    // feed uses a class so the live count can update in both places.
    const status = String(update.text || '').trim().replace(/id=(['"])inat-count\1/g, 'class="inat-count"');
    const media = renderPostMedia(update);
    return `                <article class="feed-item feed-item--status">
                    <div class="feed-meta"><time>${escapeHtml(updateDate(update))}</time></div>
                    ${status ? `<p class="feed-status">${status}</p>` : ''}${media}
                </article>`;
};

const renderNoteCard = (post) => {
    const blocks = (Array.isArray(post.body) ? post.body : []).map(normalizeBlock);
    const summaryIndex = blocks.findIndex((block) => block.type === 'p' && String(block.text).trim());
    const summary = summaryIndex >= 0 ? blocks[summaryIndex].text : '';
    const expandedBlocks = blocks.filter((block, index) => index !== summaryIndex)
        .map(renderFeedBlock).filter(Boolean).join('\n                            ');
    const media = renderPostMedia(post);
    const bodyId = `feed-post-body-${escapeHtml(post.slug)}`;
    const expandable = expandedBlocks ? `
                    <button class="feed-post-toggle" type="button" aria-expanded="false" aria-controls="${bodyId}">
                        <span class="feed-post-toggle-label">Read full note</span>
                        <svg class="feed-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
                    </button>
                    <div class="feed-post-body" id="${bodyId}" aria-hidden="true" inert>
                        <div class="feed-post-body-inner">
                            <div class="feed-article">
                            ${expandedBlocks}
                            </div>
                        </div>
                    </div>` : '';
    return `                <article class="feed-item feed-item--post" id="post-${escapeHtml(post.slug)}" data-post-slug="${escapeHtml(post.slug)}">
                    <div class="feed-meta"><time>${escapeHtml(updateDate(post))}</time></div>
                    <h2 class="feed-post-title">${escapeHtml(post.title || 'Untitled')}</h2>
                    ${summary ? `<p class="feed-post-summary">${summary}</p>` : ''}${media}${expandable}
                </article>`;
};

const feedCards = publishedUpdates.map((update) => update.type === 'status'
    ? renderStatusCard(update)
    : renderNoteCard(update));
inject('feed', `\n${feedCards.join('\n')}\n            `);

// App fields are plain text. Only local paths and web URLs become links.
function appHref(input) {
    const value = String(input || '').trim();
    if (!value || /[\\\u0000-\u001f]/.test(value)) return '';
    return /^(?:https?:\/\/|\/(?!\/))/i.test(value) ? value : '';
}

function renderApp(app) {
    const slides = (app.media || []).flatMap(({ src, alt }, i) => {
        const url = appHref(assetHref(src));
        const pathname = url.split(/[?#]/)[0];
        if (/\.webm$/i.test(pathname)) {
            return [`<video src="${escapeHtml(url)}" aria-label="${escapeHtml(alt || app.name + ' demo')}" muted loop playsinline controls preload="metadata"></video>`];
        }
        if (/\.webp$/i.test(pathname)) {
            return [`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" decoding="async" loading="${i === 0 ? 'eager' : 'lazy'}" draggable="false">`];
        }
        return [];
    });
    const url = appHref(app.linkUrl);
    const body = (app.body || []).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('\n');
    return `
    <section id="app-window" class="feed-window app-window open" role="dialog" aria-labelledby="app-name" data-app-slug="${app.slug}">
        <header class="feed-bar">
            <span class="feed-heading" id="app-name">${escapeHtml(app.name)}</span>
            <a class="feed-close app-close" href="/" data-sound="slide" aria-label="Close ${escapeHtml(app.name)}">&times;</a>
        </header>
        <div class="feed-scroll app-scroll">
            <article class="feed-items app-content">
                ${app.version ? `<div class="feed-meta">${escapeHtml(app.version)}</div>` : ''}
                <h1 class="app-title">${escapeHtml(app.heading || app.name)}</h1>
                ${body ? `<div class="app-body">${body}</div>` : ''}
                ${url && app.linkLabel ? `<p class="app-link"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.linkLabel)}</a></p>` : ''}
                ${slides.length ? renderCarousel(slides, app.name + ' gallery') : ''}
            </article>
        </div>
    </section>\n`;
}

inject('app-page', '');
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html from content.json');

const appsDir = path.join(root, 'apps');
fs.mkdirSync(appsDir, { recursive: true });
for (const app of apps) {
    const title = escapeHtml(`${app.name} · Justin Martin`);
    const description = escapeHtml(app.heading || app.name);
    const route = 'https://justinmartin.wiki/apps/' + app.slug + '/';
    const cover = (app.media || []).map(({ src }) => appHref(assetHref(src)))
        .find(url => /\.webp(?:[?#]|$)/i.test(url));
    const page = fillMarker(html, 'app-page', renderApp(app))
        .replace('<body>', '<body class="app-open">')
        // Keep the homepage metadata available when a directly opened tray closes in place.
        .replace(/<title>([^<]*)<\/title>/, (_, home) => `<title data-home="${home.replace(/"/g, '&quot;')}">${title}</title>`)
        .replace(/(property="og:title" content=")([^"]*)"/, (_, prefix, home) => `${prefix}${title}" data-home="${home}"`)
        .replace(/((?:name="description"|property="og:description") content=")([^"]*)"/g, (_, prefix, home) => `${prefix}${description}" data-home="${home}"`)
        .replace(/(<link rel="canonical" href="|property="og:url" content=")([^"]*)"/g, (_, prefix, home) => `${prefix}${route}" data-home="${home}"`)
        .replace(/(property="og:image" content=")([^"]*)"/, (original, prefix, home) =>
            cover ? `${prefix}${escapeHtml(new URL(cover, route).href)}" data-home="${home}"` : original);
    const dir = path.join(appsDir, app.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page);
}
// Remove only obsolete generated pages when the editor deletes or renames an app.
for (const dir of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || appSlugs.has(dir.name)) continue;
    const routeDir = path.join(appsDir, dir.name);
    const file = path.join(routeDir, 'index.html');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('<!-- cms:app-page -->')) {
        fs.unlinkSync(file);
        if (!fs.readdirSync(routeDir).length) fs.rmdirSync(routeDir);
    }
}
console.log(`Built ${apps.length} standalone app page(s) into apps/`);

const blogDir = path.join(root, 'blog');
// Keep legacy post URLs alive without maintaining a second reading experience.
// Each route immediately opens the corresponding article inside the homepage feed.
fs.rmSync(blogDir, { recursive: true, force: true });
publishedPosts.forEach((post) => {
    const dir = path.join(blogDir, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    const destination = `/?post=${encodeURIComponent(post.slug)}`;
    const title = escapeHtml(post.title || 'Post');
    fs.writeFileSync(path.join(dir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} &middot; Justin Martin</title>
    <link rel="canonical" href="https://justinmartin.wiki${destination}">
    <meta http-equiv="refresh" content="0;url=${destination}">
    <script>location.replace(${JSON.stringify(destination)});<\/script>
</head>
<body><p><a href="${destination}">Open ${title} in the feed</a></p></body>
</html>
`);
});
console.log(`Built ${publishedPosts.length} legacy post redirect(s) into blog/`);
