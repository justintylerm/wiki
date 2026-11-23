// Load the provider's API on the first Play gesture and share it across status cards.
let youtubeAPIRequest;
function loadYouTubeAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!youtubeAPIRequest) {
        youtubeAPIRequest = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            function fail() {
                clearTimeout(timeout);
                script.remove();
                youtubeAPIRequest = null;
                reject(new Error('YouTube player API unavailable'));
            }
            const timeout = setTimeout(fail, 12000);
            window.onYouTubeIframeAPIReady = () => {
                clearTimeout(timeout);
                resolve(window.YT);
            };
            script.onerror = fail;
            script.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(script);
        });
    }
    return youtubeAPIRequest;
}

function videoClock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    const pair = (number) => String(number).padStart(2, '0');
    return (minutes >= 60 ? Math.floor(minutes / 60) + ':' + pair(minutes % 60) : minutes)
        + ':' + pair(whole % 60);
}

function setupYouTubePlayer(card) {
    const poster = card.querySelector('.youtube-poster');
    const posterMute = card.querySelector('.youtube-mute');
    const posterFullscreen = card.querySelector('.youtube-fullscreen');
    const toggle = card.querySelector('.youtube-toggle');
    const mute = card.querySelector('.youtube-volume-toggle');
    const seek = card.querySelector('.youtube-seek');
    const time = card.querySelector('.youtube-time');
    const fullscreen = card.querySelector('.youtube-toolbar-fullscreen');
    const native = card.querySelector('.youtube-native');
    let muted = false;
    let frame;
    let player;
    let ready = false;
    let scrubbing = false;
    let tick, readyTimeout;

    function showMute(value) {
        muted = value;
        for (const button of [posterMute, mute]) {
            button.setAttribute('aria-pressed', String(muted));
            button.title = muted ? 'Unmute' : 'Mute';
        }
    }

    function showFullscreen() {
        const active = document.fullscreenElement === card || card.classList.contains('youtube-expanded');
        for (const button of [posterFullscreen, fullscreen]) {
            button.setAttribute('aria-pressed', String(active));
            button.title = active ? 'Exit fullscreen' : 'Fullscreen';
        }
    }

    async function toggleFullscreen() {
        if (document.fullscreenElement === card) await document.exitFullscreen();
        else if (card.classList.contains('youtube-expanded')) card.classList.remove('youtube-expanded');
        else {
            try { await card.requestFullscreen(); }
            catch { card.classList.add('youtube-expanded'); }
        }
        showFullscreen();
    }

    function showTime(current, duration) {
        const elapsed = videoClock(current);
        const total = videoClock(duration);
        time.textContent = elapsed + ' / ' + total;
        seek.setAttribute('aria-valuetext', elapsed + ' of ' + total);
    }

    function syncControls() {
        if (!ready) return;
        const state = player.getPlayerState();
        const running = state === YT.PlayerState.PLAYING;
        const canPause = running || state === YT.PlayerState.BUFFERING;
        const action = canPause ? 'Pause' : state === YT.PlayerState.ENDED ? 'Replay' : 'Play';
        // A playing video may briefly buffer without the visitor pausing it.
        if (state !== YT.PlayerState.BUFFERING) card.classList.toggle('is-running', running);
        toggle.dataset.action = action.toLowerCase();
        toggle.setAttribute('aria-label', action);
        toggle.title = action;
        showMute(player.isMuted());
        const duration = player.getDuration() || 0;
        seek.disabled = !duration;
        seek.max = String(duration);
        if (!scrubbing) {
            const current = player.getCurrentTime() || 0;
            seek.value = String(current);
            showTime(current, duration);
        }
    }

    function release() {
        clearInterval(tick);
        clearTimeout(readyTimeout);
        ready = false;
        scrubbing = false;
        const oldFrame = frame;
        frame = null;
        if (player) player.destroy();
        player = null;
        oldFrame?.remove();
    }

    function insertFrame(custom, autoplay, start) {
        const iframe = document.createElement('iframe');
        const params = new URLSearchParams({
            controls: custom ? '0' : '1',
            autoplay: autoplay ? '1' : '0',
            mute: muted ? '1' : '0',
            playsinline: '1'
        });
        if (custom) {
            params.set('enablejsapi', '1');
            params.set('origin', location.origin);
        }
        if (start > 0) params.set('start', String(Math.floor(start)));
        iframe.title = card.querySelector('.youtube-title').textContent;
        iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.src = 'https://www.youtube-nocookie.com/embed/' + card.dataset.youtubeId + '?' + params;
        card.appendChild(iframe);
        return iframe;
    }

    function useNative() {
        const restoreFocus = card.contains(document.activeElement);
        const start = ready ? player.getCurrentTime() : 0;
        const state = ready ? player.getPlayerState() : null;
        if (ready) showMute(player.isMuted());
        release();
        card.classList.remove('is-running');
        card.classList.add('use-native');
        const autoplay = state == null || (state !== YT.PlayerState.PAUSED && state !== YT.PlayerState.ENDED);
        frame = insertFrame(false, autoplay, start);
        if (restoreFocus) frame.focus({ preventScroll: true });
    }

    function start(event) {
        if (frame) return;
        poster.hidden = true;
        toggle.disabled = mute.disabled = seek.disabled = true;
        toggle.dataset.action = 'play';
        toggle.setAttribute('aria-label', 'Play');
        toggle.title = 'Play';
        seek.value = '0';
        showTime(0, 0);
        card.classList.add('is-playing');
        const currentFrame = frame = insertFrame(true, true, 0);
        frame.focus({ preventScroll: true });
        const keyboardStart = event.detail === 0;
        const fallback = () => { if (frame === currentFrame) useNative(); };
        readyTimeout = setTimeout(fallback, 14000);
        loadYouTubeAPI().then((api) => {
            if (frame !== currentFrame) return;
            player = new api.Player(currentFrame, {
                host: 'https://www.youtube-nocookie.com',
                events: {
                    onReady() {
                        if (frame !== currentFrame) return;
                        clearTimeout(readyTimeout);
                        ready = true;
                        toggle.disabled = mute.disabled = false;
                        syncControls();
                        tick = setInterval(syncControls, 500);
                        if (keyboardStart && document.activeElement === frame) toggle.focus({ preventScroll: true });
                    },
                    onStateChange() { if (frame === currentFrame) syncControls(); },
                    onError: fallback
                }
            });
        }).catch(fallback);
    }

    card.querySelector('.youtube-play').addEventListener('click', start);
    posterMute.addEventListener('click', () => showMute(!muted));
    mute.addEventListener('click', () => {
        if (!ready) return;
        if (player.isMuted()) player.unMute();
        else player.mute();
        showMute(!muted);
    });
    toggle.addEventListener('click', () => {
        if (!ready) return;
        if (toggle.dataset.action === 'pause') player.pauseVideo();
        else player.playVideo();
    });
    seek.addEventListener('input', () => {
        scrubbing = true;
        showTime(seek.valueAsNumber, Number(seek.max));
    });
    seek.addEventListener('change', () => {
        scrubbing = false;
        if (ready) player.seekTo(seek.valueAsNumber, true);
    });
    seek.addEventListener('pointercancel', () => { scrubbing = false; });
    native.addEventListener('click', useNative);
    for (const button of [posterFullscreen, fullscreen]) button.addEventListener('click', toggleFullscreen);
    card.addEventListener('fullscreenchange', showFullscreen);
    // A cross-origin iframe can receive mouse moves without updating its parent's :hover.
    card.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse') card.classList.add('mouse-outside');
    });
    card.addEventListener('pointerenter', () => card.classList.remove('mouse-outside'));

    return () => {
        release();
        poster.hidden = false;
        card.classList.remove('is-playing', 'is-running', 'use-native', 'youtube-expanded', 'mouse-outside');
        showFullscreen();
    };
}
