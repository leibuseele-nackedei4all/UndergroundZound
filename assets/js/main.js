/* Leib & Seele – UndergroundZound
 * Small, dependency-free script:
 *  - shows one "page" (section) at a time, based on the URL hash (#sets, #workshop …)
 *  - docked player that keeps playing while you browse (SoundCloud + self-hosted MP3)
 *  - privacy friendly click-to-load embeds (YouTube, Google Calendar)
 *  - contact form that opens the visitor's e-mail program
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
   * Router: one view visible at a time
   * ------------------------------------------------------------------ */
  var views = $$('.view');
  var viewIds = views.map(function (v) { return v.id; });
  var navLinks = $$('[data-nav]');
  var nav = $('#site-nav');
  var navToggle = $('.nav-toggle');
  var firstRun = true;

  function viewFor(id) {
    if (!id) return 'home';
    if (viewIds.indexOf(id) !== -1) return id;
    var el = document.getElementById(id);
    var parent = el && el.closest('.view');
    return parent ? parent.id : null;
  }

  function route() {
    var id = decodeURIComponent(location.hash.slice(1));
    var viewId = viewFor(id);
    if (!viewId) {
      // e.g. #main from the skip link: keep the current view (or fall back to home)
      if ($('.view.is-active')) return;
      viewId = 'home';
    }

    views.forEach(function (v) { v.classList.toggle('is-active', v.id === viewId); });
    navLinks.forEach(function (a) {
      if (a.getAttribute('data-nav') === viewId) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    var view = document.getElementById(viewId);
    if (view.dataset.title) document.title = view.dataset.title;

    var target = id && id !== viewId ? document.getElementById(id) : null;
    if (target) {
      target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }

    if (!firstRun) {
      var heading = $('h1', view);
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
    firstRun = false;
    closeNav();
  }

  function closeNav() {
    if (!nav) return;
    nav.classList.remove('is-open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
  document.addEventListener('click', function (e) {
    if (nav && nav.classList.contains('is-open') && !e.target.closest('.site-header')) closeNav();
  });

  window.addEventListener('hashchange', route);
  route();

  /* ------------------------------------------------------------------
   * Docked player
   * ------------------------------------------------------------------ */
  var dock = $('#dock');
  var dockSC = $('#dock-sc');
  var dockAudio = $('#dock-audio');
  var audio = $('#audio');
  var toggleBtn = $('#dock-toggle');
  var seek = $('#dock-seek');
  var timeEl = $('#dock-time');
  var durEl = $('#dock-duration');
  var titleEl = $('#dock-title');
  var artistEl = $('#dock-artist');
  var coverEl = $('#dock-cover');
  var statusEl = $('#dock-status');
  var closeBtn = $('#dock-close');
  var current = null;
  var dragging = false;

  var SC_OPTIONS = 'color=%23edc858&auto_play=true&hide_related=true&show_comments=false' +
    '&show_user=true&show_reposts=false&show_teaser=false&visual=false';

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setDockHeight() {
    var h = dock.classList.contains('is-open') ? dock.offsetHeight : 0;
    document.documentElement.style.setProperty('--dock-h', h + 'px');
  }

  function openDock() {
    if (dock.hidden) {
      dock.hidden = false;
      void dock.offsetHeight; // allow the slide-in transition
    }
    dock.classList.add('is-open');
    window.requestAnimationFrame(setDockHeight);
  }

  function closeDock() {
    audio.pause();
    audio.removeAttribute('src');
    audio.removeAttribute('data-src');
    audio.load();
    dockSC.innerHTML = '';
    current = null;
    dock.classList.remove('is-open');
    document.documentElement.style.setProperty('--dock-h', '0px');
    window.setTimeout(function () { if (!current) dock.hidden = true; }, 400);
    statusEl.textContent = 'Player geschlossen';
    markCards();
  }

  function trackFromCard(card) {
    return {
      type: card.getAttribute('data-type'),
      src: card.getAttribute('data-src'),
      title: card.getAttribute('data-title'),
      artist: card.getAttribute('data-artist'),
      cover: card.getAttribute('data-cover') || ''
    };
  }

  function markCards() {
    var audioPlaying = current && current.type === 'audio' && !audio.paused;
    $$('.track').forEach(function (card) {
      var isCurrent = !!current && card.getAttribute('data-src') === current.src;
      card.classList.toggle('is-current', isCurrent);
      card.classList.toggle('is-playing', isCurrent && (current.type === 'sc' || audioPlaying));
      var btn = $('.track__play', card);
      if (!btn) return;
      var showPause = isCurrent && audioPlaying;
      $('use', btn).setAttribute('href', showPause ? '#i-pause' : '#i-play');
      btn.setAttribute('aria-label', card.getAttribute('data-title') + (showPause ? ' pausieren' : ' abspielen'));
    });
    toggleBtn.classList.toggle('is-paused', !audioPlaying);
    toggleBtn.setAttribute('aria-label', audioPlaying ? 'Pause' : 'Abspielen');
  }

  function playSoundCloud(track) {
    audio.pause();
    dockAudio.hidden = true;
    var iframe = $('iframe', dockSC);
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'SoundCloud-Player';
      iframe.setAttribute('allow', 'autoplay; encrypted-media');
      iframe.setAttribute('scrolling', 'no');
      dockSC.appendChild(iframe);
    }
    iframe.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(track.src) + '&' + SC_OPTIONS;
    openDock();
  }

  function playFile(track) {
    dockSC.innerHTML = '';
    dockAudio.hidden = false;
    titleEl.textContent = track.title;
    artistEl.textContent = '– ' + track.artist;
    coverEl.src = track.cover || 'assets/img/emblem.webp';
    if (audio.getAttribute('data-src') !== track.src) {
      audio.src = track.src;
      audio.setAttribute('data-src', track.src);
      seek.value = 0;
      timeEl.textContent = '0:00';
      durEl.textContent = '0:00';
    }
    var p = audio.play();
    if (p && p.catch) p.catch(function () { markCards(); });
    openDock();
    setMediaSession(track);
  }

  function select(track) {
    if (current && current.src === track.src) {
      if (track.type === 'audio') {
        if (audio.paused) audio.play(); else audio.pause();
      }
      openDock();
      return;
    }
    current = track;
    statusEl.textContent = 'Spielt jetzt: ' + track.title + ' – ' + track.artist;
    if (track.type === 'audio') playFile(track); else playSoundCloud(track);
    markCards();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.track__play');
    if (!btn) return;
    var card = btn.closest('.track');
    if (card) select(trackFromCard(card));
  });

  toggleBtn.addEventListener('click', function () {
    if (!current || current.type !== 'audio') return;
    if (audio.paused) audio.play(); else audio.pause();
  });
  closeBtn.addEventListener('click', closeDock);

  audio.addEventListener('play', markCards);
  audio.addEventListener('pause', markCards);
  audio.addEventListener('loadedmetadata', function () { durEl.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', function () {
    if (dragging || !audio.duration) return;
    seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    timeEl.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('ended', function () {
    // continue with the next self-hosted track of the same list
    var cards = $$('.track[data-type="audio"]');
    var idx = -1;
    cards.forEach(function (c, i) { if (current && c.getAttribute('data-src') === current.src && idx === -1) idx = i; });
    var cur = cards[idx];
    var next = cards[idx + 1];
    if (cur && next && cur.parentNode === next.parentNode) select(trackFromCard(next));
    else markCards();
  });

  seek.addEventListener('input', function () {
    dragging = true;
    if (audio.duration) timeEl.textContent = fmt((seek.value / 1000) * audio.duration);
  });
  seek.addEventListener('change', function () {
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
    dragging = false;
  });

  function setMediaSession(track) {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    var art = new URL(track.cover || 'assets/img/emblem.webp', location.href).href;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'Leib & Seele',
      artwork: [{ src: art, sizes: '400x400', type: 'image/webp' }]
    });
    try {
      navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
      navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
      navigator.mediaSession.setActionHandler('seekto', function (d) { if (d.seekTime != null) audio.currentTime = d.seekTime; });
    } catch (err) { /* older browsers */ }
  }

  window.addEventListener('resize', function () { if (!dock.hidden) setDockHeight(); });

  /* ------------------------------------------------------------------
   * Click-to-load embeds (nothing is loaded from YouTube/Google before)
   * ------------------------------------------------------------------ */
  $$('.embed').forEach(function (box) {
    var btn = $('.embed__load', box);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.src = box.getAttribute('data-embed');
      iframe.title = box.getAttribute('data-embed-title') || '';
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      box.innerHTML = '';
      box.appendChild(iframe);
      box.classList.add('is-loaded');
      if (box.classList.contains('embed--video') && current) closeDock();
    });
  });

  /* ------------------------------------------------------------------
   * Contact form -> opens the visitor's mail program
   * ------------------------------------------------------------------ */
  var form = $('#contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.reportValidity && !form.reportValidity()) return;
      var get = function (name) { return (form.elements[name] && form.elements[name].value || '').trim(); };
      var name = (get('Vorname') + ' ' + get('Nachname')).trim();
      var subject = 'Nachricht über die Website' + (name ? ' von ' + name : '');
      var body = get('Nachricht') + '\n\n--\n' + name + '\nE-Mail: ' + get('E-Mail') +
        (get('Telefon') ? '\nTelefon: ' + get('Telefon') : '');
      window.location.href = 'mailto:leibuseele@gmail.com?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
    });
  }

  /* ------------------------------------------------------------------
   * Click the animated logo to replay the fly-in
   * ------------------------------------------------------------------ */
  var logo = $('.hero__logo');
  if (logo && !reducedMotion && window.fetch && window.URL && URL.createObjectURL) {
    var logoBlob = null;
    var lastUrl = null;
    logo.addEventListener('click', function () {
      var src = logo.getAttribute('src');
      var p = logoBlob ? Promise.resolve(logoBlob) : fetch(src.indexOf('blob:') === 0 ? 'assets/img/logo-leibundseele.webp' : src)
        .then(function (r) { return r.blob(); })
        .then(function (b) { logoBlob = b; return b; });
      p.then(function (b) {
        var url = URL.createObjectURL(b);
        logo.src = url;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = url;
      }).catch(function () { /* ignore */ });
    });
  }
})();
