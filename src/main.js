const nowPlaying = document.getElementById('now-playing');
        const fadeUpElements = Array.from(document.querySelectorAll('.fade-up'));
        const mobileBreakpoint = window.matchMedia('(max-width: 1100px)');

        function restartFadeUps() {
            fadeUpElements.forEach((el) => {
                el.style.animation = 'none';
                el.style.opacity = '0';
                el.style.transform = 'translateY(14px)';
            });

            void document.body.offsetHeight;

            fadeUpElements.forEach((el) => {
                el.style.animation = '';
            });

            requestAnimationFrame(() => {
                fadeUpElements.forEach((el) => {
                    el.style.animation = 'fadeUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards';
                });
            });
        }

        document.querySelectorAll('.accordion-trigger').forEach(trigger => {
            trigger.addEventListener('click', () => {
                // "What's on my mind" opens the floating feed on desktop. On mobile,
                // the same content remains available through the compact accordion.
                if (trigger.getAttribute('aria-controls') === 'accordion-mind') {
                    if (feedWindow.hidden) openFeed(trigger);
                    else closeFeed();
                    return;
                }

                const accordion = trigger.parentElement;
                const content = accordion.querySelector('.accordion-content');
                const isOpen = accordion.classList.contains('open');

                if (isOpen) {
                    content.style.maxHeight = '0px';
                    accordion.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                } else {
                    content.style.maxHeight = content.scrollHeight + 'px';
                    accordion.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                }

                if (window.uiSound) window.uiSound.play(isOpen ? 'collapse' : 'expand');

                const anyOpen = document.querySelector('.accordion.open');

                if (anyOpen) {
                    nowPlaying.classList.add('hidden');
                } else {
                    nowPlaying.classList.remove('hidden');
                }
            });
        });

        let wasMobile = mobileBreakpoint.matches;

        function handleBreakpointChange() {
            const isMobile = mobileBreakpoint.matches;
            if (isMobile !== wasMobile) {
                restartFadeUps();
                if (isMobile) {
                    closeFeed();
                }
                wasMobile = isMobile;
            }
        }

        mobileBreakpoint.addEventListener('change', handleBreakpointChange);
        window.addEventListener('resize', handleBreakpointChange);

        /* Feed — a fixed stream of CMS thoughts and published notes */
        const feedWindow = document.getElementById('feed-window');
        const feedClose = document.getElementById('feed-close');
        const feedScroll = document.getElementById('feed-scroll');
        let feedReturnFocus = null;
        let feedHideTimer = null;

        function clampFeed() {
            if (!feedWindow) return;
            const maxLeft = Math.max(0, window.innerWidth - feedWindow.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - feedWindow.offsetHeight);
            const left = Math.min(Math.max(parseFloat(feedWindow.style.left) || 0, 0), maxLeft);
            const top = Math.min(Math.max(parseFloat(feedWindow.style.top) || 0, 0), maxTop);
            feedWindow.style.left = left + 'px';
            feedWindow.style.top = top + 'px';
        }

        function openFeed(trigger) {
            if (!feedWindow) return;
            if (window.uiSound) window.uiSound.play('pop');
            clearTimeout(feedHideTimer);
            feedReturnFocus = trigger || document.activeElement;
            trigger.setAttribute('aria-expanded', 'true');
            trigger.parentElement.classList.add('panel-open');

            feedWindow.hidden = false;
            feedWindow.style.left = mobileBreakpoint.matches
                ? '0px'
                : Math.max(30, window.innerWidth - feedWindow.offsetWidth - 30) + 'px';
            feedWindow.style.top = mobileBreakpoint.matches ? '0px' : '30px';
            clampFeed();
            if (feedScroll) feedScroll.scrollTop = 0;

            requestAnimationFrame(() => feedWindow.classList.add('open'));
            document.addEventListener('keydown', onFeedKeydown);
            feedClose.focus();
        }

        function closeFeed() {
            if (!feedWindow || feedWindow.hidden) return;
            closeExpandedPosts(true);
            if (window.uiSound) window.uiSound.play('slide');
            feedWindow.classList.remove('open');
            document.removeEventListener('keydown', onFeedKeydown);
            clearTimeout(feedHideTimer);
            feedHideTimer = setTimeout(() => {
                if (!feedWindow.classList.contains('open')) feedWindow.hidden = true;
            }, 420);

            const trigger = document.querySelector('[aria-controls="accordion-mind"]');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                trigger.parentElement.classList.remove('panel-open');
            }
            if (feedReturnFocus && typeof feedReturnFocus.focus === 'function') feedReturnFocus.focus();
            feedReturnFocus = null;
        }

        function onFeedKeydown(e) {
            if (e.key !== 'Escape') return;
            const expanded = feedWindow.querySelector('.feed-item--post.is-expanded');
            if (expanded) setPostExpanded(expanded, false, { updateUrl: true });
            else closeFeed();
        }

        if (feedWindow) {
            feedClose.addEventListener('click', closeFeed);
            window.addEventListener('resize', () => { if (!feedWindow.hidden) clampFeed(); });
        }

        /* Inline feed articles */
        function updatePostUrl(slug) {
            const url = new URL(window.location.href);
            if (slug) url.searchParams.set('post', slug);
            else url.searchParams.delete('post');
            url.searchParams.delete('feed');
            history.replaceState({}, '', url.pathname + url.search + url.hash);
        }

        function setPostExpanded(article, expanded, options) {
            if (!article) return;
            const opts = options || {};
            const button = article.querySelector('.feed-post-toggle');
            const body = article.querySelector('.feed-post-body');
            if (!button || !body) return;

            if (expanded) {
                document.querySelectorAll('.feed-item--post.is-expanded').forEach((other) => {
                    if (other !== article) setPostExpanded(other, false, { updateUrl: false });
                });
            }

            article.classList.toggle('is-expanded', expanded);
            button.setAttribute('aria-expanded', String(expanded));
            button.querySelector('.feed-post-toggle-label').textContent = expanded ? 'Close note' : 'Read full note';
            body.setAttribute('aria-hidden', String(!expanded));
            body.inert = !expanded;

            if (window.uiSound && opts.sound !== false) {
                window.uiSound.play(expanded ? 'expand' : 'collapse');
            }
            if (opts.updateUrl !== false) updatePostUrl(expanded ? article.dataset.postSlug : '');

            if (expanded && opts.scroll === true && feedScroll) {
                setTimeout(() => {
                    feedScroll.scrollTo({ top: Math.max(0, article.offsetTop - 18), behavior: 'smooth' });
                }, 80);
            }
        }

        function closeExpandedPosts(updateUrl) {
            document.querySelectorAll('.feed-item--post.is-expanded').forEach((article) => {
                setPostExpanded(article, false, { updateUrl: false, sound: false, scroll: false });
            });
            if (updateUrl) updatePostUrl('');
        }

        document.querySelectorAll('.feed-post-toggle').forEach((button) => {
            button.addEventListener('click', () => {
                const article = button.closest('.feed-item--post');
                setPostExpanded(article, !article.classList.contains('is-expanded'), { updateUrl: true });
            });
        });

        /* Shared feed likes — public totals with one ordinary vote per browser. */
        const likeStorageKey = 'justinmartin-feed-likes-v1';
        const likeCountCacheKey = 'justinmartin-feed-like-counts-v1';
        const likeApiBase = 'https://api.counterapi.dev/v1/justinmartin-wiki';
        let savedLikes = {};
        let cachedLikeCounts = {};

        try {
            savedLikes = JSON.parse(localStorage.getItem(likeStorageKey) || '{}') || {};
        } catch (err) {
            savedLikes = {};
        }
        try {
            cachedLikeCounts = JSON.parse(localStorage.getItem(likeCountCacheKey) || '{}') || {};
        } catch (err) {
            cachedLikeCounts = {};
        }

        function saveLikes() {
            try { localStorage.setItem(likeStorageKey, JSON.stringify(savedLikes)); } catch (err) {}
        }

        function cacheLikeCount(likeId, count) {
            cachedLikeCounts[likeId] = Math.max(0, Number(count) || 0);
            try { localStorage.setItem(likeCountCacheKey, JSON.stringify(cachedLikeCounts)); } catch (err) {}
        }

        function setLikeButtonState(button, liked, count) {
            const itemLabel = button.closest('.feed-item--post') ? 'note' : 'update';
            button.setAttribute('aria-pressed', String(liked));
            button.setAttribute('aria-label', liked ? `Remove like from this ${itemLabel}` : `Like this ${itemLabel}`);
            button.querySelector('.feed-like-count').textContent = String(Math.max(0, Number(count) || 0));
        }

        function animateLikeButton(button) {
            button.classList.remove('is-reacting');
            void button.offsetWidth;
            button.classList.add('is-reacting');
            setTimeout(() => button.classList.remove('is-reacting'), 320);
        }

        async function fetchLikeCount(button) {
            const likeId = button.dataset.likeId;
            const cachedCount = cachedLikeCounts[likeId] || 0;
            button._lastConfirmedCount = cachedCount;
            setLikeButtonState(button, button._desiredLiked, cachedCount);
            try {
                const response = await fetch(`${likeApiBase}/${encodeURIComponent(likeId)}/`, { mode: 'cors' });
                if (!response.ok) return;
                const data = await response.json();
                button._lastConfirmedCount = Math.max(0, Number(data.count) || 0);
                cacheLikeCount(likeId, data.count);
                if (!button._syncing && button._desiredLiked === button._confirmedLiked) {
                    setLikeButtonState(button, button._desiredLiked, data.count);
                }
            } catch (err) {
                // Keep the control usable with a zero count if the service is unavailable.
            }
        }

        async function syncLikeButton(button) {
            if (button._syncing) return;
            button._syncing = true;
            const likeId = button.dataset.likeId;

            while (button._confirmedLiked !== button._desiredLiked) {
                const requestedState = button._desiredLiked;
                try {
                    const action = requestedState ? 'up' : 'down';
                    const response = await fetch(`${likeApiBase}/${encodeURIComponent(likeId)}/${action}`, {
                        mode: 'cors',
                        keepalive: true
                    });
                    if (!response.ok) throw new Error(`Like request failed (${response.status})`);
                    const data = await response.json();
                    button._confirmedLiked = requestedState;
                    button._lastConfirmedCount = Math.max(0, Number(data.count) || 0);
                    cacheLikeCount(likeId, data.count);

                    // A second click may have happened while this request was running.
                    // Preserve that newer visual state and process it on the next loop.
                    if (button._desiredLiked === requestedState) {
                        setLikeButtonState(button, requestedState, data.count);
                    }
                } catch (err) {
                    button._desiredLiked = button._confirmedLiked;
                    if (button._confirmedLiked) savedLikes[likeId] = true;
                    else delete savedLikes[likeId];
                    saveLikes();
                    cacheLikeCount(likeId, button._lastConfirmedCount || 0);
                    setLikeButtonState(button, button._confirmedLiked, button._lastConfirmedCount || 0);
                    break;
                }
            }

            button._syncing = false;
        }

        document.querySelectorAll('.feed-like').forEach((button) => {
            button._confirmedLiked = !!savedLikes[button.dataset.likeId];
            button._desiredLiked = button._confirmedLiked;
            button._syncing = false;
            fetchLikeCount(button);
            button.addEventListener('click', () => {
                const likeId = button.dataset.likeId;
                const nextLiked = !button._desiredLiked;
                const currentCount = Number(button.querySelector('.feed-like-count').textContent) || 0;
                const nextCount = Math.max(0, currentCount + (nextLiked ? 1 : -1));

                // Match the reference interaction: update every visible part instantly,
                // then reconcile with the shared counter in the background.
                button._desiredLiked = nextLiked;
                if (nextLiked) savedLikes[likeId] = true;
                else delete savedLikes[likeId];
                saveLikes();
                cacheLikeCount(likeId, nextCount);
                setLikeButtonState(button, nextLiked, nextCount);
                animateLikeButton(button);
                syncLikeButton(button);
            });
        });

        function openFeedFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const slug = params.get('post');
            if (!slug && !params.has('feed')) return;
            const trigger = document.querySelector('[aria-controls="accordion-mind"]');
            openFeed(trigger);
            if (!slug) return;
            const article = Array.from(document.querySelectorAll('.feed-item--post'))
                .find((item) => item.dataset.postSlug === slug);
            if (!article) return;
            setTimeout(() => setPostExpanded(article, true, {
                updateUrl: false,
                sound: false,
                scroll: true
            }), 340);
        }

        openFeedFromUrl();

        /* Last.fm Now Playing */
        (function() {
            const apiKey = 'ce4365f9eb48e70656fdf420c9b72ed8';
            const user = 'Justintylerm';
            const el = document.getElementById('now-playing');

            async function fetchTrack() {
                try {
                    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${user}&api_key=${apiKey}&format=json&limit=1`;
                    const response = await fetch(url);
                    const data = await response.json();
                    const track = data.recenttracks?.track?.[0];
                    if (track) {
                        const song = track.name || '';
                        const artist = track.artist?.['#text'] || '';
                        if (song && artist) {
                            el.textContent = `Now playing “${song}” by ${artist}`;
                        }
                    }
                } catch (err) {
                    console.error('Last.fm fetch error:', err);
                }
            }

            fetchTrack();
            setInterval(fetchTrack, 30000);
        })();

        /* iNaturalist plant observation count */
        (function() {
            const els = Array.from(document.querySelectorAll('#inat-count, .inat-count'));
            if (!els.length) return;
            fetch('https://api.inaturalist.org/v1/observations?user_id=justintylerm&taxon_id=47126&per_page=0')
                .then((r) => r.json())
                .then((d) => { if (typeof d.total_results === 'number') els.forEach((el) => { el.textContent = d.total_results; }); })
                .catch(() => {});
        })();
