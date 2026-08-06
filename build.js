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

const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Feed likes use stable, URL-safe IDs. Notes keep their slug; updates are keyed
// from their content so moving one within the feed doesn't reset its counter.
const stableLikeHash = (value) => {
    let hash = 2166136261;
    for (const char of String(value || '')) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const renderLikeButton = (likeId, itemLabel) => `
                    <button class="feed-like" type="button" data-like-id="${escapeHtml(likeId)}" aria-pressed="false" aria-label="Like this ${itemLabel}">
                        <svg class="feed-like-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg>
                        <span class="feed-like-count" aria-live="polite">0</span>
                    </button>`;

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

// posts.json is the single source of truth for both the "Latest posts" tree below
// and the blog page generator further down. Load it once, here, and reuse.
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
// "MM-DD-YY" -> "YY-MM-DD" so plain string compare sorts chronologically.
const postSortKey = (p) => {
    const [mm, dd, yy] = String(p && p.date ? p.date : '').split('-');
    return `${yy || ''}-${mm || ''}-${dd || ''}`;
};

const publishedPosts = posts
    .filter((p) => p && p.published && p.slug)
    .sort((a, b) => postSortKey(b).localeCompare(postSortKey(a)));

const latest = publishedPosts.slice(0, 3);

const postRows = latest.map((p) => {
    const md = mmdd(p.date);
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
// The homepage thoughts become status entries and published posts become richer
// note cards. This keeps the mockup connected to the two existing CMS sources.
// ---------------------------------------------------------------------------
const feedDate = escapeHtml(content.lastUpdated || stamp);
const statusCards = (Array.isArray(content.thoughts) ? content.thoughts : []).map((thought) => {
    // The compact mobile accordion owns the unique observation-count id; the
    // feed uses a class so the live count can update in both places.
    const status = String(thought).replace(/id=(['"])inat-count\1/g, 'class="inat-count"');
    const likeId = `update-${stableLikeHash(thought)}`;
    return `                <article class="feed-item feed-item--status" data-feed-id="${likeId}">
                    <div class="feed-meta"><time>${feedDate}</time></div>
                    <p class="feed-status">${status}</p>${renderLikeButton(likeId, 'update')}
                </article>`;
});

const noteCards = publishedPosts.map((post) => {
    const blocks = (Array.isArray(post.body) ? post.body : []).map(normalizeBlock);
    const summaryIndex = blocks.findIndex((block) => block.type === 'p' && String(block.text).trim());
    const summary = summaryIndex >= 0 ? blocks[summaryIndex].text : '';
    const expandedBlocks = blocks.filter((block, index) => index !== summaryIndex)
        .map(renderFeedBlock).filter(Boolean).join('\n                            ');
    const image = post.image ? `
                    <figure class="feed-post-media">
                        <img src="${escapeHtml(assetHref(post.image))}" alt="${escapeHtml(post.imageAlt || post.title || '')}" loading="lazy" decoding="async">
                    </figure>` : '';
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
    const likeId = `note-${post.slug}`;
    return `                <article class="feed-item feed-item--post" id="post-${escapeHtml(post.slug)}" data-post-slug="${escapeHtml(post.slug)}" data-feed-id="${escapeHtml(likeId)}">
                    <div class="feed-meta"><time>${escapeHtml(post.date || '')}</time></div>
                    <h2 class="feed-post-title">${escapeHtml(post.title || 'Untitled')}</h2>
                    ${summary ? `<p class="feed-post-summary">${summary}</p>` : ''}${image}${expandable}${renderLikeButton(likeId, 'note')}
                </article>`;
});

// Put the newest status first, then the latest note, then the remaining statuses.
// This makes the initial mockup read like a mixed social stream instead of two lists.
const feedCards = statusCards.length
    ? [statusCards[0], ...noteCards, ...statusCards.slice(1)]
    : noteCards;
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
