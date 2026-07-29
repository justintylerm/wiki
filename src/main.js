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
                // "My setup" toggles the floating Kitdrop preview on desktop instead of
                // expanding. Mobile falls through to the normal accordion behavior.
                if (trigger.getAttribute('aria-controls') === 'accordion-setup' && !mobileBreakpoint.matches) {
                    if (kitWindow.hidden) openKitdrop(trigger);
                    else closeKitdrop();
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
                if (isMobile) closeKitdrop();
                wasMobile = isMobile;
            }
        }

        mobileBreakpoint.addEventListener('change', handleBreakpointChange);
        window.addEventListener('resize', handleBreakpointChange);

        /* Kitdrop preview — floating, draggable window opened from "My setup" (desktop) */
        const kitWindow = document.getElementById('kitdrop-window');
        const kitBar = document.getElementById('kitdrop-bar');
        const kitClose = document.getElementById('kitdrop-close');
        const kitFrame = document.getElementById('kitdrop-frame');
        let kitReturnFocus = null;
        let kitHideTimer = null;

        // Hide the loading spinner once the iframe's page has loaded.
        if (kitFrame) {
            kitFrame.addEventListener('load', function () {
                if (kitFrame.getAttribute('src')) kitWindow.classList.add('kit-loaded');
            });
        }

        function clampWindow() {
            // Keep the window within the viewport after opening or resizing.
            const maxLeft = Math.max(0, window.innerWidth - kitWindow.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - kitWindow.offsetHeight);
            const left = Math.min(Math.max(parseFloat(kitWindow.style.left) || 0, 0), maxLeft);
            const top = Math.min(Math.max(parseFloat(kitWindow.style.top) || 0, 0), maxTop);
            kitWindow.style.left = left + 'px';
            kitWindow.style.top = top + 'px';
        }

        function openKitdrop(trigger) {
            if (!kitWindow || mobileBreakpoint.matches) return;
            clearTimeout(kitHideTimer); // cancel any pending hide from a very recent close
            kitReturnFocus = trigger || document.activeElement;

            // Lazy-load the iframe on first open; keep it loaded afterwards.
            if (!kitFrame.src && kitFrame.dataset.src) kitFrame.src = kitFrame.dataset.src;

            kitWindow.hidden = false;
            // Center it, then clamp into view.
            kitWindow.style.left = ((window.innerWidth - kitWindow.offsetWidth) / 2) + 'px';
            kitWindow.style.top = Math.max(24, (window.innerHeight - kitWindow.offsetHeight) / 2) + 'px';
            clampWindow();

            requestAnimationFrame(() => kitWindow.classList.add('open'));
            document.addEventListener('keydown', onKitKeydown);
            // Click anywhere outside the window closes it. Deferred so the opening
            // click doesn't immediately trigger it as it bubbles to the document.
            setTimeout(() => document.addEventListener('mousedown', onKitOutside), 0);
            kitClose.focus();
        }

        function closeKitdrop() {
            if (!kitWindow || kitWindow.hidden) return;
            kitWindow.classList.remove('open');
            document.removeEventListener('keydown', onKitKeydown);
            document.removeEventListener('mousedown', onKitOutside);

            // Hide after the fade-out. Cancellable, and guarded so a fast reopen
            // (which re-adds .open) is never hidden by this stale timer.
            clearTimeout(kitHideTimer);
            kitHideTimer = setTimeout(() => {
                if (!kitWindow.classList.contains('open')) kitWindow.hidden = true;
            }, 320);

            if (kitReturnFocus && typeof kitReturnFocus.focus === 'function') kitReturnFocus.focus();
            kitReturnFocus = null;
        }

        function onKitKeydown(e) {
            if (e.key === 'Escape') closeKitdrop();
        }

        function onKitOutside(e) {
            if (!kitWindow.contains(e.target)) closeKitdrop();
        }

        if (kitWindow) {
            kitClose.addEventListener('click', closeKitdrop);

            // Drag by the top bar (pointer events). Ignore drags that start on the close button.
            let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
            kitBar.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.kitdrop-close')) return;
                dragging = true;
                startX = e.clientX;
                startY = e.clientY;
                startLeft = parseFloat(kitWindow.style.left) || 0;
                startTop = parseFloat(kitWindow.style.top) || 0;
                kitBar.setPointerCapture(e.pointerId);
            });
            kitBar.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                const maxLeft = Math.max(0, window.innerWidth - kitWindow.offsetWidth);
                const maxTop = Math.max(0, window.innerHeight - kitWindow.offsetHeight);
                kitWindow.style.left = Math.min(Math.max(startLeft + (e.clientX - startX), 0), maxLeft) + 'px';
                kitWindow.style.top = Math.min(Math.max(startTop + (e.clientY - startY), 0), maxTop) + 'px';
            });
            const endDrag = (e) => {
                if (!dragging) return;
                dragging = false;
                try { kitBar.releasePointerCapture(e.pointerId); } catch (err) {}
            };
            kitBar.addEventListener('pointerup', endDrag);
            kitBar.addEventListener('pointercancel', endDrag);

            window.addEventListener('resize', () => { if (!kitWindow.hidden) clampWindow(); });
        }

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
            const el = document.getElementById('inat-count');
            if (!el) return;
            fetch('https://api.inaturalist.org/v1/observations?user_id=justintylerm&taxon_id=47126&per_page=0')
                .then((r) => r.json())
                .then((d) => { if (typeof d.total_results === 'number') el.textContent = d.total_results; })
                .catch(() => {});
        })();
