/*
 * Subtle interface sounds for justinmartin.wiki.
 *
 * Sounds are the "Minimal" Web Audio patch by Raphael Salaja (as used on
 * kosta.fyi), rendered to short WAV clips in assets/sounds/. This module plays
 * them through the Web Audio API for low latency and overlapping playback.
 *
 * Zero dependencies. Loads before src/main.js and exposes window.uiSound so the
 * page's own handlers can trigger context-specific sounds (accordion, Kitdrop).
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 */
(function () {
    'use strict';

    var BASE = '/assets/sounds/';
    var MASTER = 0.35; // overall level — kept low so sounds stay subtle

    // name -> per-sound gain, relative to master. Tune individual sounds here.
    var SOUNDS = {
        click: 1.0,
        expand: 0.9,
        collapse: 0.9,
        pop: 0.95,
        slide: 0.9
    };

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { // no Web Audio — expose a no-op API so callers never crash
        window.uiSound = { play: function () {} };
        return;
    }

    var ctx = null;
    var master = null;
    var buffers = {};   // name -> AudioBuffer
    var loading = {};   // name -> Promise<AudioBuffer|null>

    function ensureCtx() {
        if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = MASTER;
            master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') { ctx.resume(); }
        return ctx;
    }

    function load(name) {
        if (buffers[name]) { return Promise.resolve(buffers[name]); }
        if (loading[name]) { return loading[name]; }
        loading[name] = fetch(BASE + name + '.wav')
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return ensureCtx().decodeAudioData(buf); })
            .then(function (decoded) { buffers[name] = decoded; return decoded; })
            .catch(function () { return null; });
        return loading[name];
    }

    function play(name, opts) {
        if (!(name in SOUNDS)) { return; }
        ensureCtx();
        load(name).then(function (buffer) {
            if (!buffer) { return; }
            var src = ctx.createBufferSource();
            src.buffer = buffer;
            var g = ctx.createGain();
            var scale = (opts && opts.volume != null) ? opts.volume : 1;
            g.gain.value = SOUNDS[name] * scale;
            src.connect(g);
            g.connect(master);
            src.start(0);
        });
    }

    // Fetch + decode every clip once, right after the first interaction, so
    // later plays are instant without fetching anything at page load.
    var warmed = false;
    function warm() {
        if (warmed) { return; }
        warmed = true;
        ensureCtx();
        Object.keys(SOUNDS).forEach(load);
    }

    // Clicks: links play "click"; [data-sound] overrides the sound name.
    // Accordion/Kitdrop buttons are handled in main.js so they get their own
    // open/close sounds, and are intentionally not matched here.
    document.addEventListener('click', function (e) {
        var el = e.target;
        if (!el || !el.closest) { return; }
        var t = el.closest('a[href], [data-sound]');
        if (!t) { return; }
        warm();
        play(t.getAttribute('data-sound') || 'click');
    }, true);

    window.uiSound = { play: play };
})();
