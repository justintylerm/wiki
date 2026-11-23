#!/usr/bin/env node
/**
 * Build step for justinmartin.wiki. Zero dependencies. Run: node build.js
 *
 *  1. Injects content.json into index.html between <!-- cms:x --> ... <!-- /cms:x --> markers.
 *  2. Renders published posts inline in the feed and leaves lightweight redirects at
 *     legacy blog/<slug>/ URLs so old bookmarks open the matching feed article.
 */
const fs = require('fs');
const path = require('path');
const { youtubeVideoId } = require('./src/youtube.js');

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

const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

const volumeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z"/><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path class="sound-on" d="M15 8.5a5 5 0 0 1 0 7M18 5.5a9 9 0 0 1 0 13"/><path class="sound-off" d="m16 9 5 6m0-6-5 6"/></g></svg>';
const fullscreenIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path class="expand-icon" d="M3 9V4h6m6 0h6v5m0 6v5h-6m-6 0H3v-5"/><path class="collapse-icon" d="M9 3v6H3m12-6v6h6m-6 12v-6h6M9 21v-6H3"/></svg>';

const renderPostMedia = (post) => {
    const youtubeId = post.type === 'status' && youtubeVideoId(post.youtubeUrl);
    if (youtubeId) {
        const statusText = String(post.text || '').replace(/<[^>]*>/g, '').trim();
        const title = escapeHtml(post.youtubeTitle || statusText || 'YouTube video');
        return `
                    <figure class="feed-post-media feed-youtube" data-youtube-id="${youtubeId}">
                        <div class="youtube-poster">
                            <img src="https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
                            <a class="youtube-title" href="https://www.youtube.com/watch?v=${youtubeId}" target="_blank" rel="noopener noreferrer" title="${title}">${title}</a>
                            <button class="youtube-play" type="button" aria-label="Play ${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3v18l15-9z"/></svg></button>
                            <button class="youtube-mute" type="button" aria-label="Mute video" aria-pressed="false" title="Mute">
                                ${volumeIcon}
                            </button>
                        </div>
                        <button class="youtube-fullscreen" type="button" aria-label="Fullscreen" aria-pressed="false" title="Fullscreen">
                            ${fullscreenIcon}
                        </button>
                        <div class="youtube-toolbar" role="group" aria-label="Video playback controls">
                            <button type="button" class="youtube-toggle" data-action="play" aria-label="Play" title="Play">
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path class="play-icon" d="M6 3v18l15-9z"/><path class="pause-icon" d="M5 4h5v16H5zm9 0h5v16h-5z"/><path class="replay-icon" fill="none" stroke="currentColor" stroke-width="2" d="M4 4v6h6M4 10a8 8 0 1 1 .5 6"/></svg>
                            </button>
                            <input class="youtube-seek" type="range" min="0" max="0" value="0" step="1" aria-label="Seek through video" disabled>
                            <span class="youtube-time">0:00</span>
                            <button type="button" class="youtube-volume-toggle" aria-label="Mute video" aria-pressed="false" title="Mute">${volumeIcon}</button>
                            <button type="button" class="youtube-native" aria-label="Use YouTube controls for captions and settings" title="Captions and settings in YouTube controls">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m9 4 1-2h4l1 2 2 1 2 .2 2 3.5-1 1.8v3l1 1.8-2 3.5-2 .2-2 1-1 2h-4l-1-2-2-1-2-.2-2-3.5 1-1.8v-3l-1-1.8 2-3.5L7 5z"/><circle cx="12" cy="12" r="3.2"/></svg>
                            </button>
                            <button type="button" class="youtube-toolbar-fullscreen" aria-label="Fullscreen" aria-pressed="false" title="Fullscreen">${fullscreenIcon}</button>
                        </div>
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
        return `
                            <figure class="feed-post-gallery-slide"><img src="${escapeHtml(src)}" alt="${label}" loading="lazy" decoding="async" draggable="false"></figure>`;
    }).join('');
    return `
                    <div class="feed-post-gallery" role="group" aria-roledescription="carousel" aria-label="${images.length} photos">
                        <div class="feed-post-gallery-track" tabindex="0">${slides}
                        </div>
                    </div>`;
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

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html from content.json');

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
