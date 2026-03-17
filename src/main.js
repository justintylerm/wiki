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
                wasMobile = isMobile;
            }
        }

        mobileBreakpoint.addEventListener('change', handleBreakpointChange);
        window.addEventListener('resize', handleBreakpointChange);

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
