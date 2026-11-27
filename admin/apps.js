'use strict';

const byId = id => document.getElementById(id);
const itemKey = value => (value || '').trim().toLowerCase();
const slugify = value => itemKey(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const github = 'https://api.github.com/repos/justintylerm/wiki/contents/';
const token = localPreview ? '' : localStorage.getItem('wiki_admin_token');
const pageSelect = byId('page');
const form = byId('form');
const saveButton = byId('save');
const setup = byId('setupItem');
const addSoftware = new Option('Add a new software item…', '');
let pages = [];
let categories = [];
let revision = '';
let selected = -1;
let slides = [];
let dirty = false;
let busy = false;
let slugEdited = false;

function status(message, error = false) {
    byId('status').textContent = message;
    byId('status').classList.toggle('error', error);
}

function setBusy(value) {
    busy = value;
    byId('fields').disabled = busy;
    byId('newPage').disabled = busy;
    pageSelect.disabled = busy || pages.length === 0;
    saveButton.disabled = busy || !dirty;
}

function markDirty() {
    dirty = true;
    saveButton.disabled = busy;
    status('Unsaved changes');
}

async function requireSuccess(response) {
    if (response.ok) return response;
    if ([409, 412].includes(response.status)) {
        throw new Error('Another editor saved changes. Copy your edits and reload before saving.');
    }
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || details.message || ('Request failed (' + response.status + ').'));
}

const ghFile = (path, options = {}) => fetch(github + path, {
    ...options,
    headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
    },
    cache: 'no-store'
});

async function readData(path) {
    if (localPreview) {
        const response = await requireSuccess(await fetch('/' + path, {cache: 'no-store'}));
        if (path === 'apps.json') revision = response.headers.get('etag') || '';
        return response.json();
    }
    const response = await requireSuccess(await ghFile(path + '?ref=main'));
    const file = await response.json();
    if (path === 'apps.json') revision = file.sha;
    const bytes = Uint8Array.from(atob(file.content), character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

function asBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Unable to read the file.'));
        reader.readAsDataURL(blob);
    });
}

function putGithubFile(path, message, content, sha) {
    return ghFile(path, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message, content, branch: 'main', sha})
    });
}

async function savePages(next, message) {
    const labels = next.filter(page => page.addToSoftware).map(page => page.setupItem);
    const updatedPages = next.map(({addToSoftware, ...page}) => page);
    if (localPreview) {
        const headers = {'Content-Type': 'application/json'};
        if (revision) headers['If-Match'] = revision;
        const response = await requireSuccess(await fetch('/__preview/apps', {
            method: 'PUT', headers, body: JSON.stringify({pages: updatedPages, softwareItems: labels})
        }));
        revision = response.headers.get('etag') || '';
        categories = (await response.json()).setupCategories;
    } else if (labels.length) {
        const saved = await WikiAppStorage.publishWithSoftwareItems({token, pages: updatedPages, labels, revision});
        revision = saved.revision;
        categories = WikiSetup.setupCategories(saved.content);
    } else {
        const content = await asBase64(new Blob([JSON.stringify(updatedPages, null, 2) + '\n']));
        const response = await requireSuccess(await putGithubFile('apps.json', message, content, revision));
        revision = (await response.json()).content.sha;
    }
    pages = updatedPages;
}

async function uploadSlide(slide) {
    if (slide.src) return;
    const file = slide.file;
    if (localPreview) {
        const query = new URLSearchParams({filename: file.name});
        const response = await requireSuccess(await fetch('/__preview/media?' + query, {
            method: 'POST',
            headers: {'Content-Type': file.type || 'application/octet-stream'},
            body: file
        }));
        slide.src = (await response.json()).src;
    } else {
        // A content-based name lets a failed save reuse an upload on retry.
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        const extension = file.name.split('.').pop().toLowerCase();
        const path = 'assets/apps/' + hex + '.' + extension;
        const existing = await ghFile(path + '?ref=main');
        if (existing.status === 404) {
            await requireSuccess(await putGithubFile(path, 'Add app visual: ' + file.name, await asBase64(file)));
        } else {
            await requireSuccess(existing);
        }
        slide.src = path;
    }
}

function releasePreviews() {
    slides.forEach(slide => { if (slide.previewUrl) URL.revokeObjectURL(slide.previewUrl); });
}

function renderSlides() {
    const list = byId('slides');
    list.replaceChildren();
    slides.forEach((slide, index) => {
        const row = document.createElement('li');
        const video = /\.webm(?:$|[?#])/i.test(slide.file?.name || slide.src);
        const visual = document.createElement(video ? 'video' : 'img');
        visual.src = slide.previewUrl || new URL(slide.src, location.origin + '/').href;
        if (video) {
            visual.preload = 'metadata';
            visual.muted = true;
            visual.playsInline = true;
            visual.controls = true;
            visual.setAttribute('aria-label', slide.alt || 'Video preview');
        } else {
            visual.alt = slide.alt;
        }
        const details = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = 'Slide ' + (index + 1) + ' description';
        const alt = document.createElement('input');
        alt.value = slide.alt;
        alt.addEventListener('input', () => {
            slide.alt = alt.value;
            if (video) visual.setAttribute('aria-label', alt.value || 'Video preview');
            else visual.alt = alt.value;
        });
        label.append(alt);
        const tools = document.createElement('div');
        tools.className = 'tools';
        function action(text, disabled, change) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'text-button';
            button.textContent = text;
            button.disabled = disabled;
            button.setAttribute('aria-label', text + ', slide ' + (index + 1));
            button.addEventListener('click', () => {
                const nextIndex = change();
                markDirty();
                renderSlides();
                (list.children[nextIndex]?.querySelector('input') || byId('addMedia')).focus();
            });
            tools.append(button);
        }
        function move(to) {
            slides.splice(index, 1);
            slides.splice(to, 0, slide);
            return to;
        }
        action('Earlier', index === 0, () => move(index - 1));
        action('Later', index === slides.length - 1, () => move(index + 1));
        action('Remove', false, () => {
            if (slide.previewUrl) URL.revokeObjectURL(slide.previewUrl);
            slides.splice(index, 1);
            return Math.min(index, slides.length - 1);
        });
        details.append(label, tools);
        row.append(visual, details);
        list.append(row);
    });
}

function addingSoftware() {
    return setup.selectedOptions[0] === addSoftware;
}

function updateSoftwareField() {
    byId('softwareLabelField').hidden = !addingSoftware();
    byId('softwareLabel').placeholder = byId('name').value.trim() || 'Use the app name';
}

function showPage(index, draftItem = '') {
    releasePreviews();
    selected = index;
    const page = pages[index];
    dirty = false;
    slugEdited = !!page;
    pageSelect.replaceChildren(...pages.map((entry, i) => new Option(entry.name, String(i))));
    if (!page) pageSelect.add(new Option('New page', '-1'));
    pageSelect.value = String(index);
    for (const field of ['name', 'version', 'slug', 'heading', 'linkLabel', 'linkUrl']) {
        byId(field).value = page?.[field] || '';
    }
    if (draftItem) {
        byId('name').value = draftItem;
        byId('slug').value = slugify(draftItem);
    }
    byId('body').value = (page?.body || []).join('\n\n');
    const linkedItem = page?.setupItem || draftItem;
    const standalone = new Option('Standalone page only', '');
    setup.replaceChildren(standalone, addSoftware);
    let existingOption;
    for (const category of categories) {
        const group = document.createElement('optgroup');
        group.label = category.label;
        for (const item of category.items) {
            const option = new Option(item, item);
            option.disabled = pages.some((entry, i) => i !== index && itemKey(entry.setupItem) === itemKey(item));
            if (itemKey(item) === itemKey(linkedItem)) existingOption = option;
            group.append(option);
        }
        setup.append(group);
    }
    if (page?.setupItem && !page.addToSoftware && !existingOption) {
        existingOption = new Option(page.setupItem + ' (removed from My setup)', page.setupItem);
        setup.add(existingOption);
    }
    const newItem = page?.addToSoftware || (draftItem && !existingOption);
    const chosen = newItem ? addSoftware : existingOption || standalone;
    chosen.selected = true;
    byId('softwareLabel').value = newItem ? linkedItem : '';
    updateSoftwareField();
    slides = (page?.media || []).map(media => ({...media, alt: media.alt || ''}));
    renderSlides();
    byId('preview').hidden = !page;
    if (page) byId('preview').href = '/apps/' + encodeURIComponent(page.slug) + '/';
    byId('deletePage').hidden = !page;
    byId('files').value = '';
    form.hidden = false;
    setBusy(false);
    status(localPreview ? 'Local preview' : 'Up to date');
    if (draftItem) markDirty();
    const address = new URL(location.href);
    if (address.searchParams.has('setupItem')) {
        if (linkedItem) address.searchParams.set('setupItem', linkedItem);
        else address.searchParams.delete('setupItem');
        history.replaceState(null, '', address);
    }
}

const canDiscard = () => !dirty || confirm('Discard unsaved changes to this page?');
pageSelect.addEventListener('change', () => {
    if (canDiscard()) showPage(Number(pageSelect.value));
    else pageSelect.value = String(selected);
});
byId('newPage').addEventListener('click', () => {
    if (!canDiscard()) return;
    showPage(-1);
    byId('name').focus();
});
byId('slug').addEventListener('input', () => { slugEdited = true; });
byId('name').addEventListener('input', () => {
    if (!slugEdited) byId('slug').value = slugify(byId('name').value);
    updateSoftwareField();
});
setup.addEventListener('change', updateSoftwareField);
form.addEventListener('input', event => { if (event.target !== byId('files')) markDirty(); });
byId('addMedia').addEventListener('click', () => byId('files').click());
byId('files').addEventListener('change', () => {
    const files = Array.from(byId('files').files || []);
    byId('files').value = '';
    if (!files.length) return;
    const invalid = files.find(file => !/\.(webm|webp)$/i.test(file.name) || file.size > 50 * 1024 * 1024 || !file.size);
    if (invalid) {
        status('Choose a WebP or WebM file up to 50 MB. Check “' + invalid.name + '”.', true);
        return;
    }
    for (const file of files) slides.push({file, previewUrl: URL.createObjectURL(file), alt: ''});
    markDirty();
    renderSlides();
});

function collectPage() {
    const data = {...pages[selected]};
    for (const field of ['name', 'version', 'slug', 'heading', 'linkLabel', 'linkUrl']) {
        data[field] = byId(field).value.trim();
    }
    if (!data.name || !data.heading) throw new Error('Enter an app name and heading.');
    if (addingSoftware()) {
        data.setupItem = byId('softwareLabel').value.trim() || data.name;
        data.addToSoftware = true;
    } else {
        data.setupItem = setup.value.trim();
        delete data.addToSoftware;
    }
    if (data.setupItem && pages.some((entry, i) => i !== selected && itemKey(entry.setupItem) === itemKey(data.setupItem))) {
        throw new Error('This setup item already has a page. Choose another item or edit its existing page.');
    }
    if (pages.some((entry, i) => i !== selected && entry.slug === data.slug)) {
        throw new Error('This page slug is already in use. Choose another.');
    }
    if (Boolean(data.linkLabel) !== Boolean(data.linkUrl)) {
        throw new Error('Enter both link text and a URL, or leave both empty.');
    }
    if (data.linkUrl && !/^(?:https?:\/\/[^\s/]+(?:[/?#]|$)|\/(?![\\/]))/i.test(data.linkUrl)) {
        throw new Error('Use an http(s) URL or a path beginning with a single slash.');
    }
    data.body = byId('body').value.trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return data;
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !dirty || !form.reportValidity()) return;
    setBusy(true);
    try {
        const data = collectPage();
        for (const [i, slide] of slides.entries()) {
            if (slide.src) continue;
            status('Uploading slide ' + (i + 1) + ' of ' + slides.length + '…');
            await uploadSlide(slide);
        }
        data.media = slides.map(({src, alt}) => ({src, alt: alt.trim()}));
        const next = [...pages];
        const index = selected < 0 ? next.length : selected;
        next[index] = data;
        status(localPreview ? 'Saving preview…' : 'Publishing…');
        await savePages(next, 'Save app page: ' + data.name);
        showPage(index);
        status(localPreview ? 'Saved to local preview' : 'Published. The site is rebuilding.');
    } catch (error) {
        status(error.message, true);
    } finally {
        setBusy(false);
    }
});

byId('deletePage').addEventListener('click', async () => {
    const page = pages[selected];
    if (!page || busy || !confirm('Delete the ' + page.name + ' page and remove its link from My setup?')) return;
    setBusy(true);
    status('Deleting page…');
    try {
        await savePages(pages.filter((_, index) => index !== selected), 'Delete app page: ' + page.name);
        showPage(pages.length ? Math.min(selected, pages.length - 1) : -1);
        status('Page deleted');
    } catch (error) {
        status(error.message, true);
    } finally {
        setBusy(false);
    }
});

window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (!saveButton.disabled) form.requestSubmit();
    }
});

async function start() {
    const requestedItem = (new URLSearchParams(location.search).get('setupItem') || '').trim();
    if (!localPreview && !token) {
        const params = new URLSearchParams({view: 'apps'});
        if (requestedItem) params.set('setupItem', requestedItem);
        location.replace('./?' + params);
        return;
    }
    if (!localPreview) saveButton.textContent = 'Publish';
    try {
        const [loaded, content] = await Promise.all([readData('apps.json'), readData('content.json')]);
        pages = loaded;
        categories = WikiSetup.setupCategories(content);
        if (requestedItem) {
            const index = pages.findIndex(page => itemKey(page.setupItem) === itemKey(requestedItem));
            showPage(index, index < 0 ? requestedItem : '');
        } else {
            showPage(pages.length ? 0 : -1);
        }
    } catch (error) {
        status('Could not load app pages. ' + error.message, true);
    }
}
start();
