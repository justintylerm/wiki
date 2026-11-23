// Used by both the static site build and the status editor's classic script.
function youtubeVideoId(value) {
    if (typeof value !== 'string') return '';
    const input = value.trim();
    if (!input || /[\\\s]/.test(input)) return '';

    let url;
    try {
        url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
    } catch {
        return '';
    }
    if (url.username || url.password || url.port) return '';

    const host = url.hostname;
    const path = url.pathname.replace(/\/$/, '');
    let id;
    if (host === 'youtu.be' || host === 'www.youtu.be') {
        id = path.slice(1);
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
        id = path === '/watch' ? url.searchParams.get('v') : path.match(/^\/(?:embed|shorts|live)\/([^/]+)$/)?.[1];
    } else if (host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com') {
        id = path.match(/^\/embed\/([^/]+)$/)?.[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { youtubeVideoId };
