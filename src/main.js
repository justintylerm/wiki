const nowPlaying = document.getElementById('now-playing');
        const fadeUpElements = Array.from(document.querySelectorAll('.fade-up'));
        const mobileBreakpoint = window.matchMedia('(max-width: 1100px)');
        const coarsePointer = window.matchMedia('(any-pointer: coarse)');
        const accordions = document.querySelector('.accordions');
        const nowPlayingSafeGap = 100;

        function updateNowPlayingVisibility() {
            if (!nowPlaying || !accordions) return;
            const hasExpandedContent = Array.from(accordions.querySelectorAll('.accordion-content'))
                .some((content) => content.getBoundingClientRect().height > 1);
            if (!hasExpandedContent || mobileBreakpoint.matches) {
                nowPlaying.classList.remove('hidden');
                return;
            }

            const safeZoneTop = nowPlaying.getBoundingClientRect().top - nowPlayingSafeGap;
            const accordionBottom = accordions.getBoundingClientRect().bottom;
            nowPlaying.classList.toggle('hidden', accordionBottom > safeZoneTop);
        }

        if ('ResizeObserver' in window && accordions) {
            const accordionResizeObserver = new ResizeObserver(updateNowPlayingVisibility);
            accordionResizeObserver.observe(accordions);
        }

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

        const setupContent = document.getElementById('accordion-setup');
        const setupCategory = document.querySelector('.setup-category');
        let lastCategoryTapWidth = 0;
        const setupItems = setupContent?.querySelector('.accordion-inner');
        const loadouts = Array.from(setupContent?.querySelectorAll('[data-category]') ?? []);
        if (setupContent && !loadouts.length) setupContent.closest('.accordion').hidden = true;

        function fitOpenSetup() {
            if (setupItems && !setupContent.inert) {
                setupContent.style.height = setupItems.getBoundingClientRect().height + 'px';
            }
        }

        // During a shrink, a second tap can land where the category was a moment ago.
        function tappedRecedingCategory(event) {
            if (!lastCategoryTapWidth || !event.detail || !mobileBreakpoint.matches || !coarsePointer.matches) return false;
            const box = setupCategory.getBoundingClientRect();
            return event.clientX >= box.right && event.clientX < box.left + lastCategoryTapWidth
                && event.clientY >= box.top && event.clientY < box.bottom
                && setupCategory.getAnimations().some(animation => animation.transitionProperty === 'width');
        }

        if (setupCategory && loadouts.length) {
            const setupLabel = setupCategory.querySelector('.setup-category-label');
            let selectedLoadout = 0;

            function fitSetupLabel() {
                setupCategory.style.setProperty('--category-width', setupLabel.getBoundingClientRect().width + 'px');
            }

            function showSetupCategory() {
                loadouts.forEach((list, index) => { list.hidden = index !== selectedLoadout; });
                const name = loadouts[selectedLoadout].dataset.category.toLowerCase();
                const nextName = loadouts[(selectedLoadout + 1) % loadouts.length].dataset.category.toLowerCase();
                setupLabel.textContent = name;
                fitSetupLabel();
                if (loadouts.length > 1) {
                    setupCategory.title = 'Next setup: ' + nextName;
                    setupCategory.setAttribute('aria-label', name + ', switch to ' + nextName + ' setup');
                } else {
                    setupCategory.setAttribute('aria-disabled', 'true');
                }
            }

            showSetupCategory();
            setupCategory.addEventListener('click', (event) => {
                if (event.detail) lastCategoryTapWidth = setupCategory.getBoundingClientRect().width;
                selectedLoadout = (selectedLoadout + 1) % loadouts.length;
                showSetupCategory();
                fitOpenSetup();
            });

            if ('ResizeObserver' in window) {
                new ResizeObserver(fitOpenSetup).observe(setupItems);
                new ResizeObserver(fitSetupLabel).observe(setupLabel);
            }
        }

        document.querySelectorAll('.accordion-trigger').forEach(trigger => {
            trigger.addEventListener('click', (event) => {
                if (trigger.getAttribute('aria-controls') === 'accordion-mind') {
                    if (trigger.getAttribute('aria-expanded') === 'true') closeFeed();
                    else openFeed(trigger);
                    return;
                }

                const accordion = trigger.closest('.accordion');
                const content = accordion.querySelector('.accordion-content');
                const isOpen = accordion.classList.contains('open');

                if (content === setupContent && setupCategory) {
                    if (isOpen && tappedRecedingCategory(event)) {
                        setupCategory.click();
                        return;
                    }
                    lastCategoryTapWidth = 0;
                    setupContent.inert = isOpen;
                    setupCategory.disabled = isOpen || loadouts.length < 2;
                    if (isOpen) setupContent.style.height = '0px';
                    else fitOpenSetup();
                } else {
                    content.style.maxHeight = isOpen ? '0px' : content.scrollHeight + 'px';
                }
                accordion.classList.toggle('open', !isOpen);
                trigger.setAttribute('aria-expanded', String(!isOpen));

                if (window.uiSound) window.uiSound.play(isOpen ? 'collapse' : 'expand');
                updateNowPlayingVisibility();
            });
        });

        let wasMobile = mobileBreakpoint.matches;

        function handleBreakpointChange() {
            const isMobile = mobileBreakpoint.matches;
            if (!isMobile || !coarsePointer.matches) finishFeedLoading?.();
            if (isMobile !== wasMobile) {
                restartFadeUps();
                if (isMobile) {
                    closeFeed();
                }
                wasMobile = isMobile;
            }
            updateNowPlayingVisibility();
        }

        mobileBreakpoint.addEventListener('change', handleBreakpointChange);
        coarsePointer.addEventListener('change', handleBreakpointChange);
        window.addEventListener('resize', handleBreakpointChange);
        updateNowPlayingVisibility();

        /* Feed — a fixed stream of CMS thoughts and published notes */
        const feedWindow = document.getElementById('feed-window');
        const feedClose = document.getElementById('feed-close');
        const feedScroll = document.getElementById('feed-scroll');
        const feedLoader = document.getElementById('feed-loader');
        let finishFeedLoading = null;
        let feedReturnFocus = null;
        let feedHideTimer = null;

        /* WebM previews carry no source until the feed is open and they scroll into view, then
           autoplay muted with no controls. Closing the feed drops every source again so
           nothing keeps buffering in the background. */
        const feedVideos = Array.from(feedWindow ? feedWindow.querySelectorAll('video[data-src]') : []);
        let feedVideoObserver = null;

        const youtubePlayers = feedWindow?.querySelectorAll('iframe.feed-youtube') || [];

        for (const frame of youtubePlayers) {
            const preview = frame.parentElement.querySelector('.feed-youtube-preview');
            preview?.addEventListener('click', () => {
                const source = new URL(frame.dataset.src);
                source.searchParams.set('autoplay', '1');
                frame.loading = 'eager';
                frame.hidden = false;
                frame.src = source.href;
                preview.hidden = true;
                frame.focus({ preventScroll: true });
            });
        }

        function syncFeedYouTube() {
            if (!document.body.classList.contains('feed-open')) return;
            const mobile = mobileBreakpoint.matches && coarsePointer.matches;
            for (const frame of youtubePlayers) {
                const preview = frame.parentElement.querySelector('.feed-youtube-preview');
                if (preview) preview.hidden = !mobile;
                frame.hidden = mobile && Boolean(preview);
                if (frame.hidden) {
                    frame.removeAttribute('src');
                    const image = preview.querySelector('img');
                    if (!image.hasAttribute('src')) image.src = image.dataset.src;
                } else if (!frame.hasAttribute('src')) {
                    frame.src = frame.dataset.src;
                }
            }
        }
        mobileBreakpoint.addEventListener('change', syncFeedYouTube);
        coarsePointer.addEventListener('change', syncFeedYouTube);

        for (const video of feedVideos) {
            const showFrame = () => {
                if (video.videoWidth && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                    video.classList.add('has-frame');
                }
            };
            for (const event of ['loadeddata', 'canplay', 'playing']) video.addEventListener(event, showFrame);
            for (const event of ['waiting', 'error', 'emptied']) {
                video.addEventListener(event, () => video.classList.remove('has-frame'));
            }
        }

        function prepareMobileFeed() {
            const viewport = feedScroll.getBoundingClientRect();
            const pending = new Set(Array.from(feedScroll.querySelectorAll('img, video[data-src], iframe.feed-youtube')).filter(media => {
                const box = media.getBoundingClientRect();
                return !media.closest('[inert]') && box.width > 0 && box.bottom > viewport.top &&
                    box.top < viewport.bottom && box.right > viewport.left && box.left < viewport.right;
            }));
            const controller = new AbortController();
            const options = { signal: controller.signal };
            let minimumElapsed = false;
            feedScroll.inert = true;
            feedScroll.setAttribute('aria-busy', 'true');
            feedLoader.hidden = false;

            function reveal() {
                if (controller.signal.aborted) return;
                controller.abort();
                clearTimeout(minimum);
                clearTimeout(deadline);
                feedScroll.inert = false;
                feedScroll.removeAttribute('aria-busy');
                feedLoader.hidden = true;
                finishFeedLoading = null;
            }
            // Give fast opens one brief, steady indicator while slower media loads in parallel.
            const minimum = setTimeout(() => {
                minimumElapsed = true;
                if (!pending.size) reveal();
            }, 550);
            // Stalled media must not hold the rest of the feed indefinitely.
            const deadline = setTimeout(reveal, 4000);
            finishFeedLoading = reveal;

            for (const media of pending) {
                const ready = () => {
                    pending.delete(media);
                    if (minimumElapsed && !pending.size) reveal();
                };
                if (media instanceof HTMLImageElement) {
                    media.loading = 'eager';
                    media.decode().then(ready, ready);
                } else if (media instanceof HTMLVideoElement) {
                    media.preload = 'auto';
                    if (media.hasAttribute('src') && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) ready();
                    else {
                        media.addEventListener('loadeddata', ready, options);
                        media.addEventListener('canplay', ready, options);
                        media.addEventListener('error', ready, options);
                    }
                } else {
                    media.loading = 'eager';
                    media.addEventListener('load', () => {
                        // Removing src on close also fires a load for about:blank.
                        if (media.hasAttribute('src') && media.contentDocument?.URL !== 'about:blank') ready();
                    }, options);
                    media.addEventListener('error', ready, options);
                }
            }
        }

        function playFeedVideo(video) {
            video.muted = true;
            if (!video.getAttribute('src')) {
                video.src = video.dataset.src;
                video.load();
            }
            const playing = video.play();
            if (playing && playing.catch) playing.catch(() => {});
        }

        function wakeFeedVideos() {
            if (!feedVideos.length) return;
            if (!feedVideoObserver) {
                feedVideoObserver = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) playFeedVideo(entry.target);
                        else entry.target.pause();
                    });
                }, { root: feedScroll, rootMargin: '200px 0px' });
            }
            feedVideos.forEach((video) => feedVideoObserver.observe(video));
        }

        function sleepFeedVideos() {
            if (document.fullscreenElement && feedWindow.contains(document.fullscreenElement)) {
                document.exitFullscreen().catch(() => {});
            }
            youtubePlayers.forEach((frame) => {
                frame.removeAttribute('src');
                frame.loading = 'lazy';
            });
            if (feedVideoObserver) feedVideoObserver.disconnect();
            feedVideos.forEach((video) => {
                video.classList.remove('has-frame');
                video.pause();
                if (video.getAttribute('src')) {
                    video.removeAttribute('src');
                    video.load();
                }
            });
        }

        function openFeed(trigger, linkedPost = null) {
            if (!feedWindow) return;
            if (window.uiSound) window.uiSound.play('pop');
            clearTimeout(feedHideTimer);
            feedReturnFocus = trigger || document.activeElement;
            trigger.setAttribute('aria-expanded', 'true');
            trigger.closest('.accordion').classList.add('panel-open');
            document.body.classList.add('feed-open');

            feedWindow.hidden = false;
            if (feedScroll) feedScroll.scrollTop = 0;
            syncFeedYouTube();
            if (mobileBreakpoint.matches && coarsePointer.matches) {
                if (linkedPost) {
                    setPostExpanded(linkedPost, true, { updateUrl: false, sound: false });
                    feedScroll.scrollTop = Math.max(0, linkedPost.offsetTop - 18);
                }
                prepareMobileFeed();
            }
            wakeFeedVideos();

            requestAnimationFrame(() => {
                if (trigger.getAttribute('aria-expanded') === 'true') feedWindow.classList.add('open');
            });
            document.addEventListener('keydown', onFeedKeydown);
            feedClose.focus();
        }

        function closeFeed() {
            if (!feedWindow || feedWindow.hidden) return;
            finishFeedLoading?.();
            closeExpandedPosts(true);
            sleepFeedVideos();
            if (window.uiSound) window.uiSound.play('slide');
            feedWindow.classList.remove('open');
            document.body.classList.remove('feed-open');
            document.removeEventListener('keydown', onFeedKeydown);
            clearTimeout(feedHideTimer);
            if (mobileBreakpoint.matches && coarsePointer.matches) {
                feedWindow.hidden = true;
            } else {
                feedHideTimer = setTimeout(() => {
                    if (!feedWindow.classList.contains('open')) feedWindow.hidden = true;
                }, 420);
            }

            const trigger = document.querySelector('[aria-controls="accordion-mind"]');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                trigger.closest('.accordion').classList.remove('panel-open');
            }
            if (feedReturnFocus && typeof feedReturnFocus.focus === 'function') feedReturnFocus.focus();
            feedReturnFocus = null;
        }

        function onFeedKeydown(e) {
            if (e.key !== 'Escape') return;
            if (document.fullscreenElement) return;
            const expanded = feedWindow.querySelector('.feed-item--post.is-expanded');
            if (expanded) setPostExpanded(expanded, false, { updateUrl: true });
            else closeFeed();
        }

        if (feedWindow) {
            feedClose.addEventListener('click', closeFeed);
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

        /* Photo galleries scroll natively; clicking the photo peeking at the edge snaps it into view. */
        document.querySelectorAll('.feed-post-gallery-track').forEach((track) => {
            track.addEventListener('click', (event) => {
                const slide = event.target.closest('.feed-post-gallery-slide');
                if (!slide) return;
                const inset = parseFloat(getComputedStyle(track).paddingLeft) || 0;
                const left = slide.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft - inset;
                if (Math.abs(left - track.scrollLeft) < 4) return;
                track.scrollTo({ left, behavior: 'smooth' });
            });
        });

        function openFeedFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const slug = params.get('post');
            if (!slug && !params.has('feed')) return;
            const trigger = document.querySelector('[aria-controls="accordion-mind"]');
            const article = slug && Array.from(document.querySelectorAll('.feed-item--post'))
                .find((item) => item.dataset.postSlug === slug);
            openFeed(trigger, article);
            if (!article || (mobileBreakpoint.matches && coarsePointer.matches)) return;
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
