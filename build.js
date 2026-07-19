#!/usr/bin/env node
/**
 * Injects content.json into index.html between <!-- cms:x --> ... <!-- /cms:x --> markers.
 * Zero dependencies. Run: node build.js
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

// Last updated (two spots share one marker name; inject handles both via /g)
inject('updated', `Last updated ${content.lastUpdated}`);

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html from content.json');
