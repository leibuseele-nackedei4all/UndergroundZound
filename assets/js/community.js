/*
 * Leib & Seele community — static Supabase client.
 * This file contains only browser-safe public configuration handling. The
 * database, Storage buckets, and Row Level Security rules live in Supabase.
 */
(function () {
  'use strict';

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var community = $('#club');
  if (!community) return;

  var config = window.MEMBER_CONFIG || {};
  var supabaseUrl = String(config.supabaseUrl || '').trim();
  var publicKey = String(config.supabasePublicKey || config.anonKey || '').trim();
  var client = null;
  var clientPromise = null;
  var currentUser = null;
  var currentProfile = null;
  var activeTab = 'feed';
  var currentPitchId = null;
  var relationshipRows = [];
  var selectedConversationId = null;
  var selectedPeer = null;
  var messageChannel = null;
  var feedRequestId = 0;
  var postKind = 'text';
  var postFile = null;
  var postPreviewUrl = null;
  var avatarPreviewUrl = null;
  var mediaRecorder = null;
  var recorderStream = null;
  var recorderParts = [];
  var recorderStartedAt = 0;
  var recorderTimer = null;
  var recorderLimitTimer = null;
  var signedUrlCache = new Map();
  var authMode = 'login';
  var staticEventsBound = false;

  var authPanel = $('#member-auth-panel');
  var dashboard = $('#member-dashboard');
  var setupNote = $('#member-setup-note');
  var globalStatus = $('#member-global-status');
  var loginForm = $('#member-login-form');
  var registerForm = $('#member-register-form');
  var trigger = $('#member-trigger');
  var triggerLabel = $('#member-trigger-label');
  var triggerIcon = $('#member-trigger-icon');
  var triggerAvatar = $('#member-trigger-avatar');

  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    if (kind) node.dataset.kind = kind;
    else delete node.dataset.kind;
    node.hidden = !text;
  }

  function showGlobal(text, kind) { setStatus(globalStatus, text, kind); }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function initials(profile) {
    var value = profile && (profile.display_name || profile.username || profile.name) || 'L&S';
    var parts = value.trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : value.slice(0, 2)).toUpperCase();
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeIcon(symbol) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + symbol);
    svg.appendChild(use);
    return svg;
  }

  function safeUrl(value) {
    if (!value) return '';
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
    } catch (error) { return ''; }
  }

  function formatDate(value, withTime) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
  }

  function formatTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function friendlyError(error) {
    var message = error && error.message ? String(error.message) : '';
    var lower = message.toLowerCase();
    if (lower.indexOf('invalid login credentials') !== -1 || lower.indexOf('invalid credentials') !== -1) return 'E-Mail-Adresse oder Passwort stimmen nicht.';
    if (lower.indexOf('email not confirmed') !== -1) return 'Bitte bestätige zuerst den Link in deiner E-Mail.';
    if (lower.indexOf('already registered') !== -1 || lower.indexOf('already been registered') !== -1) return 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an.';
    if (lower.indexOf('password should be at least') !== -1 || lower.indexOf('weak password') !== -1) return 'Bitte verwende ein längeres Passwort.';
    if (lower.indexOf('duplicate key') !== -1 || lower.indexOf('profiles_username_key') !== -1) return 'Dieser Benutzername ist bereits vergeben.';
    if (lower.indexOf('row-level security') !== -1 || lower.indexOf('permission denied') !== -1) return 'Der Zugriff wurde von der Datenbank abgelehnt. Prüfe die Supabase-Migration und RLS-Regeln.';
    if (lower.indexOf('failed to fetch') !== -1 || lower.indexOf('network') !== -1) return 'Der Server ist gerade nicht erreichbar. Prüfe die Verbindung und deine Supabase-Einstellungen.';
    return message || 'Das hat leider nicht geklappt. Bitte versuche es erneut.';
  }

  function callbackUrl() {
    return window.location.origin + window.location.pathname + '#club';
  }

  function keyLooksPrivileged(key) {
    if (/^sb_secret_/i.test(key) || /service_role/i.test(key)) return true;
    var parts = key.split('.');
    if (parts.length !== 3 || !window.atob) return false;
    try {
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      payload += '='.repeat((4 - payload.length % 4) % 4);
      return JSON.parse(window.atob(payload)).role === 'service_role';
    } catch (error) { return false; }
  }

  function configIsReady() {
    return /^https?:\/\//i.test(supabaseUrl) && publicKey.length > 12 && publicKey.indexOf('YOUR_') !== 0 && !keyLooksPrivileged(publicKey);
  }

  function setAuthControlsEnabled(enabled) {
    $$('#member-login-form input, #member-login-form button, #member-register-form input, #member-register-form button, #member-password-update-form input, #member-password-update-form button, #member-social-consent, [data-oauth-provider], #member-forgot-password').forEach(function (node) {
      node.disabled = !enabled;
    });
  }

  function setAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    loginForm.hidden = authMode !== 'login';
    registerForm.hidden = authMode !== 'register';
    $$('[data-auth-mode]').forEach(function (button) {
      var selected = button.dataset.authMode === authMode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    showGlobal('', '');
  }

  function fillAvatar(node, profile, bucket) {
    if (!node) return;
    node.replaceChildren();
    var path = profile && profile.avatar_path;
    var url = path ? getSignedUrl(bucket || 'avatars', path) : '';
    if (url) {
      var image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', function () {
        image.remove();
        node.textContent = initials(profile);
      }, { once: true });
      node.appendChild(image);
    } else {
      node.textContent = initials(profile);
    }
  }

  function updateHeader() {
    var signedIn = !!currentUser;
    if (triggerLabel) triggerLabel.textContent = signedIn ? (currentProfile && currentProfile.display_name || 'Mitglied') : 'Einloggen';
    if (triggerIcon) triggerIcon.hidden = signedIn;
    if (triggerAvatar) {
      triggerAvatar.hidden = !signedIn;
      if (signedIn && currentProfile && currentProfile.avatar_path) fillAvatar(triggerAvatar, currentProfile, 'avatars');
      else if (signedIn) triggerAvatar.textContent = initials(currentProfile);
      else triggerAvatar.replaceChildren();
    }
    if (trigger) trigger.setAttribute('aria-label', signedIn ? 'Mitgliederbereich: ' + (currentProfile && currentProfile.display_name || 'Konto') : 'Einloggen oder Konto erstellen');
  }

  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === 'function') return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var existing = $('script[data-member-supabase-sdk]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.supabase); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Die lokale Supabase-Bibliothek konnte nicht geladen werden.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = new URL('assets/js/vendor/supabase.min.js', document.baseURI).href;
      script.async = true;
      script.dataset.memberSupabaseSdk = 'true';
      script.onload = function () {
        if (window.supabase && typeof window.supabase.createClient === 'function') resolve(window.supabase);
        else reject(new Error('Die Supabase-Bibliothek ist nicht verfügbar.'));
      };
      script.onerror = function () { reject(new Error('Die lokale Supabase-Bibliothek konnte nicht geladen werden.')); };
      document.head.appendChild(script);
    });
  }

  function boot() {
    if (client || clientPromise || window.location.hash.slice(1) !== 'club') return;
    if (!configIsReady()) {
      if (setupNote) setupNote.hidden = false;
      setAuthControlsEnabled(false);
      if (keyLooksPrivileged(publicKey)) showGlobal('Aus Sicherheitsgründen wird ein Secret- oder service_role-Schlüssel im Browser nicht akzeptiert. Verwende ausschließlich den Publishable- oder anon-Key.', 'error');
      return;
    }
    if (setupNote) setupNote.hidden = true;
    setAuthControlsEnabled(true);
    clientPromise = loadSdk().then(function (library) {
      client = library.createClient(supabaseUrl, publicKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
      });
      client.auth.onAuthStateChange(function (event, session) {
        // Defer network calls outside the auth callback; the SDK shares its auth lock.
        window.setTimeout(function () { applySession(session, event); }, 0);
      });
      return client.auth.getSession();
    }).then(function (result) {
      if (result.error) throw result.error;
      return applySession(result.data.session, 'INITIAL_SESSION');
    }).catch(function (error) {
      clientPromise = null;
      showGlobal(friendlyError(error), 'error');
    });
  }

  function applySession(session, event) {
    var nextUser = session && session.user ? session.user : null;
    if (!nextUser) {
      if (currentUser && messageChannel && client) client.removeChannel(messageChannel);
      messageChannel = null;
      currentUser = null;
      currentProfile = null;
      selectedConversationId = null;
      selectedPeer = null;
      currentPitchId = null;
      authPanel.classList.remove('is-recovering');
      $('#member-password-update-form').hidden = true;
      authPanel.hidden = false;
      dashboard.hidden = true;
      updateHeader();
      if (event === 'SIGNED_OUT') showGlobal('Du wurdest abgemeldet.', 'success');
      return Promise.resolve();
    }
    var changedUser = !currentUser || currentUser.id !== nextUser.id;
    currentUser = nextUser;
    if (!changedUser && currentProfile && event !== 'USER_UPDATED' && event !== 'PASSWORD_RECOVERY') return Promise.resolve();
    return loadCurrentProfile().then(function () {
      if (!currentProfile) {
        authPanel.hidden = false;
        dashboard.hidden = true;
        showGlobal('Dein Profil konnte nicht geladen werden. Prüfe, ob die Supabase-Migration vollständig ausgeführt wurde.', 'error');
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        authPanel.classList.add('is-recovering');
        authPanel.hidden = false;
        dashboard.hidden = true;
        $('#member-password-update-form').hidden = false;
        $('#member-new-password').value = '';
        $('#member-new-password-confirm').value = '';
        updateHeader();
        showGlobal('Wähle jetzt ein neues Passwort.', 'success');
        return;
      }
      authPanel.classList.remove('is-recovering');
      $('#member-password-update-form').hidden = true;
      authPanel.hidden = true;
      dashboard.hidden = false;
      $('#member-sidebar-name').textContent = currentProfile.display_name || 'Mitglied';
      $('#member-sidebar-handle').textContent = '@' + (currentProfile.username || 'mitglied');
      $('#member-welcome').textContent = 'Willkommen, ' + (currentProfile.display_name || 'Mitglied');
      fillAvatar($('#member-sidebar-avatar'), currentProfile, 'avatars');
      fillAvatar($('#member-composer-avatar'), currentProfile, 'avatars');
      updateHeader();
      showGlobal('', '');
      if (changedUser || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') switchTab('feed');
      else if (activeTab === 'profile') populateProfileForm();
    }).catch(function (error) {
      showGlobal(friendlyError(error), 'error');
    });
  }

  async function loadCurrentProfile() {
    var result = await client.from('profiles')
      .select('id,username,display_name,bio,city,pronouns,birth_date,favorite_genres,website,soundcloud_url,profile_visibility,avatar_path,created_at')
      .eq('id', currentUser.id).maybeSingle();
    if (result.error) throw result.error;
    currentProfile = result.data || null;
    if (currentProfile && currentProfile.avatar_path) await signPaths('avatars', [currentProfile.avatar_path]);
  }

  function getSignedUrl(bucket, path) {
    if (!path) return '';
    var cached = signedUrlCache.get(bucket + ':' + path);
    return cached && cached.expiresAt > Date.now() ? cached.url : '';
  }

  async function signPaths(bucket, paths) {
    var unique = Array.from(new Set((paths || []).filter(Boolean)));
    var missing = unique.filter(function (path) {
      var entry = signedUrlCache.get(bucket + ':' + path);
      return !entry || entry.expiresAt <= Date.now();
    });
    if (!missing.length || !client) return;
    var result = await client.storage.from(bucket).createSignedUrls(missing, 3600);
    if (result.error) return;
    (result.data || []).forEach(function (item) {
      if (item && item.path && item.signedUrl) signedUrlCache.set(bucket + ':' + item.path, { url: item.signedUrl, expiresAt: Date.now() + 3500000 });
    });
  }

  function switchTab(tab) {
    if (!currentUser) return;
    activeTab = tab;
    $$('[data-member-tab]').forEach(function (button) {
      var active = button.dataset.memberTab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $$('[data-member-panel]').forEach(function (panel) { panel.hidden = panel.dataset.memberPanel !== tab; });
    if (tab === 'feed') loadFeed('feed');
    if (tab === 'pitch') loadPitch(currentPitchId || currentUser.id);
    if (tab === 'friends') loadFriends();
    if (tab === 'messages') loadConversations();
    if (tab === 'profile') populateProfileForm();
  }

  function goToPitch(profileId) {
    currentPitchId = profileId || currentUser.id;
    switchTab('pitch');
  }

  function displayName(profile) {
    return profile && (profile.display_name || profile.username) || 'Mitglied';
  }

  function avatarPaths(profiles) {
    return (profiles || []).map(function (profile) { return profile && profile.avatar_path; }).filter(Boolean);
  }

  function postMediaMime(file) {
    return String(file && file.type || '').split(';')[0].trim().toLowerCase();
  }

  function fileExtension(file, mime) {
    var known = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
      'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/opus': 'opus'
    };
    if (known[mime]) return known[mime];
    var candidate = (file && file.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
    return candidate || 'bin';
  }

  function allowedMedia(kind, file) {
    var mime = postMediaMime(file);
    if (!file || !mime) return { ok: false, message: 'Dieser Browser konnte den Dateityp nicht erkennen.' };
    var max = kind === 'image' ? 8 * 1024 * 1024 : kind === 'video' ? 50 * 1024 * 1024 : 12 * 1024 * 1024;
    var okay = kind === 'image' ? ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(mime) !== -1 :
      kind === 'video' ? ['video/mp4', 'video/webm'].indexOf(mime) !== -1 :
        ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/opus'].indexOf(mime) !== -1;
    if (!okay) return { ok: false, message: 'Dieser Dateityp wird nicht unterstützt.' };
    if (file.size > max) return { ok: false, message: 'Die Datei ist zu groß. Erlaubt sind maximal ' + Math.round(max / (1024 * 1024)) + ' MB.' };
    return { ok: true, mime: mime };
  }

  function setPostKind(kind) {
    if (postKind !== kind) clearPostFile();
    postKind = kind;
    $$('[data-post-kind]').forEach(function (button) {
      var selected = button.dataset.postKind === kind;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    var upload = $('#member-upload-area');
    var fileInput = $('#member-post-file');
    var label = $('#member-file-label-text');
    var recorder = $('#member-recorder');
    upload.hidden = kind === 'text';
    fileInput.hidden = kind === 'text';
    recorder.hidden = kind !== 'voice';
    if (kind === 'image') {
      label.textContent = 'Bild oder GIF auswählen (max. 8 MB)';
      fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
      fileInput.hidden = false;
    } else if (kind === 'video') {
      label.textContent = 'Video auswählen (MP4 oder WebM, max. 50 MB)';
      fileInput.accept = 'video/mp4,video/webm';
      fileInput.hidden = false;
    } else if (kind === 'voice') {
      label.textContent = 'Audiodatei auswählen (max. 12 MB)';
      fileInput.accept = 'audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/aac,audio/flac,audio/opus';
      fileInput.hidden = false;
    }
    setStatus($('#member-post-status'), '', '');
  }

  function clearPostFile() {
    if (postPreviewUrl) URL.revokeObjectURL(postPreviewUrl);
    postPreviewUrl = null;
    postFile = null;
    var input = $('#member-post-file');
    if (input) input.value = '';
    var preview = $('#member-upload-preview');
    preview.replaceChildren();
    preview.hidden = true;
    $('#member-clear-upload').hidden = true;
  }

  function setPostFile(file) {
    clearPostFile();
    if (!file) return;
    var check = allowedMedia(postKind, file);
    if (!check.ok) {
      setStatus($('#member-post-status'), check.message, 'error');
      return;
    }
    postFile = file;
    postPreviewUrl = URL.createObjectURL(file);
    var preview = $('#member-upload-preview');
    preview.replaceChildren();
    var element;
    if (postKind === 'image') {
      element = document.createElement('img');
      element.alt = 'Vorschau des ausgewählten Bildes';
      element.src = postPreviewUrl;
    } else if (postKind === 'video') {
      element = document.createElement('video');
      element.controls = true;
      element.playsInline = true;
      element.src = postPreviewUrl;
    } else {
      element = document.createElement('audio');
      element.controls = true;
      element.src = postPreviewUrl;
    }
    preview.appendChild(element);
    preview.hidden = false;
    $('#member-clear-upload').hidden = false;
    setStatus($('#member-post-status'), file.name, '');
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setStatus($('#member-post-status'), 'Sprachnotizen werden von diesem Browser nicht unterstützt. Du kannst stattdessen eine Audiodatei auswählen.', 'error');
      return;
    }
    try {
      recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var mimeChoices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
      var mime = mimeChoices.find(function (type) { return MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(type) : false; });
      mediaRecorder = mime ? new MediaRecorder(recorderStream, { mimeType: mime }) : new MediaRecorder(recorderStream);
      recorderParts = [];
      mediaRecorder.addEventListener('dataavailable', function (event) { if (event.data && event.data.size) recorderParts.push(event.data); });
      mediaRecorder.addEventListener('stop', function () {
        var blob = new Blob(recorderParts, { type: mediaRecorder && mediaRecorder.mimeType || 'audio/webm' });
        stopRecorderTracks();
        $('#member-record-start').disabled = false;
        $('#member-record-stop').disabled = true;
        if (blob.size) {
          var normalized = String(blob.type || 'audio/webm').split(';')[0];
          var ext = fileExtension({ name: 'voice-note' }, normalized);
          var file = new File([blob], 'voice-note.' + ext, { type: normalized });
          setPostFile(file);
        } else setStatus($('#member-post-status'), 'Die Aufnahme war leer. Bitte versuche es erneut.', 'error');
      }, { once: true });
      mediaRecorder.start();
      recorderStartedAt = Date.now();
      $('#member-record-start').disabled = true;
      $('#member-record-stop').disabled = false;
      setStatus($('#member-post-status'), 'Aufnahme läuft. Nach spätestens drei Minuten wird sie beendet.', '');
      updateRecorderClock();
      recorderTimer = window.setInterval(updateRecorderClock, 1000);
      recorderLimitTimer = window.setTimeout(function () { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 180000);
    } catch (error) {
      stopRecorderTracks();
      $('#member-record-start').disabled = false;
      $('#member-record-stop').disabled = true;
      setStatus($('#member-post-status'), error && error.name === 'NotAllowedError' ? 'Mikrofonzugriff wurde nicht erlaubt.' : 'Die Aufnahme konnte nicht gestartet werden.', 'error');
    }
  }

  function updateRecorderClock() {
    var elapsed = Math.max(0, Math.floor((Date.now() - recorderStartedAt) / 1000));
    var minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
    var seconds = String(elapsed % 60).padStart(2, '0');
    $('#member-record-timer').textContent = minutes + ':' + seconds;
  }

  function stopRecorderTracks() {
    if (recorderTimer) window.clearInterval(recorderTimer);
    if (recorderLimitTimer) window.clearTimeout(recorderLimitTimer);
    recorderTimer = null;
    recorderLimitTimer = null;
    if (recorderStream) recorderStream.getTracks().forEach(function (track) { track.stop(); });
    recorderStream = null;
  }

  async function publishPost(event) {
    event.preventDefault();
    if (!client || !currentUser) return;
    var body = $('#member-post-body').value.trim();
    if (!body && !postFile) {
      setStatus($('#member-post-status'), 'Schreibe eine Nachricht oder füge einen Anhang hinzu.', 'error');
      return;
    }
    if (postFile) {
      var mediaCheck = allowedMedia(postKind, postFile);
      if (!mediaCheck.ok) { setStatus($('#member-post-status'), mediaCheck.message, 'error'); return; }
    }
    var submit = $('#member-post-submit');
    submit.disabled = true;
    setStatus($('#member-post-status'), 'Beitrag wird veröffentlicht …', '');
    var postId = uuid();
    var mediaPath = null;
    var mime = null;
    try {
      if (postFile) {
        mime = postMediaMime(postFile);
        mediaPath = currentUser.id + '/' + postId + '/' + uuid() + '.' + fileExtension(postFile, mime);
        var uploadResult = await client.storage.from('member-media').upload(mediaPath, postFile, { contentType: mime, cacheControl: '3600', upsert: false });
        if (uploadResult.error) throw uploadResult.error;
      }
      var insertResult = await client.from('posts').insert({
        id: postId,
        author_id: currentUser.id,
        body: body,
        kind: postFile ? postKind : 'text',
        media_path: mediaPath,
        media_mime: mime,
        visibility: $('#member-post-visibility').value === 'friends' ? 'friends' : 'members'
      });
      if (insertResult.error) {
        if (mediaPath) await client.storage.from('member-media').remove([mediaPath]);
        throw insertResult.error;
      }
      clearPostFile();
      $('#member-post-body').value = '';
      $('#member-post-visibility').value = 'members';
      setPostKind('text');
      setStatus($('#member-post-status'), 'Dein Beitrag ist veröffentlicht.', 'success');
      await loadFeed('feed');
      if (currentPitchId === currentUser.id) await loadFeed('pitch', currentUser.id);
    } catch (error) {
      setStatus($('#member-post-status'), friendlyError(error), 'error');
    } finally {
      submit.disabled = false;
    }
  }

  function dateText(value) { return formatDate(value, true) || 'Gerade eben'; }

  function profileButton(profile, className) {
    var button = make('button', className || 'member-post__author');
    button.type = 'button';
    var avatar = make('span', 'member-avatar');
    fillAvatar(avatar, profile, 'avatars');
    var text = make('span');
    var name = make('strong', '', displayName(profile));
    var handle = make('small', '', '@' + (profile && profile.username || 'mitglied'));
    text.append(name, handle);
    button.append(avatar, text);
    button.addEventListener('click', function () { if (profile && profile.id) goToPitch(profile.id); });
    return button;
  }

  function renderPostMedia(post, parent) {
    if (!post || !post.media_path) return;
    var url = getSignedUrl('member-media', post.media_path);
    if (!url) return;
    var media;
    if (post.kind === 'image') {
      media = document.createElement('img');
      media.alt = 'Bildbeitrag';
      media.loading = 'lazy';
      media.className = 'member-post__media member-post__media--image';
    } else if (post.kind === 'video') {
      media = document.createElement('video');
      media.controls = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.className = 'member-post__media member-post__media--video';
    } else if (post.kind === 'voice') {
      media = document.createElement('audio');
      media.controls = true;
      media.preload = 'metadata';
      media.className = 'member-post__media member-post__media--audio';
    } else return;
    media.src = url;
    media.addEventListener('error', function () { media.remove(); }, { once: true });
    parent.appendChild(media);
  }

  function renderOriginalPost(post) {
    var box = make('div', 'member-post__original');
    var heading = make('div', 'member-post__original-head');
    heading.append(make('span', '', displayName(post.author)), make('span', '', '@' + (post.author && post.author.username || 'mitglied')));
    box.appendChild(heading);
    if (post.body) box.appendChild(make('p', 'member-post__body', post.body));
    renderPostMedia(post, box);
    return box;
  }

  function renderPostCard(item, stats) {
    var post = item.type === 'share' ? item.original : item.post;
    var actor = item.type === 'share' ? item.sharer : post.author;
    if (!post || !actor) return null;
    var card = make('article', 'member-post');
    var header = make('div', 'member-post__header');
    header.appendChild(profileButton(actor, 'member-post__author'));
    header.appendChild(make('time', 'member-post__date', dateText(item.created_at)));
    if (item.type === 'post') header.appendChild(make('span', 'member-post__visibility', post.visibility === 'friends' ? 'Freunde' : 'Mitglieder'));
    if (actor.id === currentUser.id) {
      var deleteButton = make('button', 'member-post__action member-post__action--danger', item.type === 'share' ? 'Teilen löschen' : 'Löschen');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', function () { deleteFeedItem(item); });
      header.appendChild(deleteButton);
    } else {
      var reportButton = make('button', 'member-post__action', 'Melden');
      reportButton.type = 'button';
      reportButton.addEventListener('click', function () { reportPost(post); });
      header.appendChild(reportButton);
    }
    card.appendChild(header);
    if (item.type === 'share') {
      card.appendChild(make('p', 'member-post__share-label', 'hat einen Beitrag geteilt'));
      if (item.caption) card.appendChild(make('p', 'member-post__body', item.caption));
      card.appendChild(renderOriginalPost(post));
    } else {
      if (post.body) card.appendChild(make('p', 'member-post__body', post.body));
      renderPostMedia(post, card);
    }

    var actionBar = make('div', 'member-post__actions');
    var postStats = stats[post.id] || { likes: 0, comments: 0, liked: false };
    var likeButton = make('button', postStats.liked ? 'is-liked' : '', (postStats.liked ? '♥' : '♡') + ' Gefällt mir · ' + postStats.likes);
    likeButton.type = 'button';
    likeButton.setAttribute('aria-pressed', postStats.liked ? 'true' : 'false');
    likeButton.addEventListener('click', function () { toggleLike(post.id, likeButton); });
    var commentButton = make('button', '', 'Kommentare · ' + postStats.comments);
    commentButton.type = 'button';
    var shareButton = make('button', '', 'Teilen');
    shareButton.type = 'button';
    actionBar.append(likeButton, commentButton, shareButton);
    card.appendChild(actionBar);

    var commentsPanel = make('div', 'member-comments');
    commentsPanel.hidden = true;
    commentButton.addEventListener('click', function () {
      commentsPanel.hidden = !commentsPanel.hidden;
      if (!commentsPanel.hidden && !commentsPanel.dataset.loaded) loadComments(post.id, commentsPanel, commentButton);
    });
    card.appendChild(commentsPanel);

    var shareForm = null;
    shareButton.addEventListener('click', function () {
      if (shareForm) { shareForm.remove(); shareForm = null; return; }
      shareForm = make('form', 'member-share-form');
      var caption = document.createElement('textarea');
      caption.maxLength = 1000;
      caption.placeholder = 'Kommentar zum Teilen (optional)';
      caption.setAttribute('aria-label', 'Kommentar zum Teilen');
      var actions = make('div', 'member-share-form__actions');
      var cancel = make('button', 'member-button member-button--ghost', 'Abbrechen');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { shareForm.remove(); shareForm = null; });
      var send = make('button', 'member-button member-button--gold', 'Teilen');
      send.type = 'submit';
      actions.append(cancel, send);
      shareForm.append(caption, actions);
      shareForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        send.disabled = true;
        var result = await client.from('post_shares').insert({ post_id: post.id, user_id: currentUser.id, caption: caption.value.trim() });
        if (result.error) showGlobal(friendlyError(result.error), 'error');
        else {
          showGlobal('Der Beitrag wurde geteilt.', 'success');
          shareForm.remove();
          shareForm = null;
          if (activeTab === 'feed') await loadFeed('feed');
          if (activeTab === 'pitch') await loadFeed('pitch', currentPitchId);
        }
        send.disabled = false;
      });
      card.insertBefore(shareForm, commentsPanel);
      caption.focus();
    });
    return card;
  }

  async function loadFeed(target, authorId) {
    if (!client || !currentUser) return;
    var request = ++feedRequestId;
    var list = target === 'pitch' ? $('#member-pitch-posts') : $('#member-feed-list');
    if (!list) return;
    list.replaceChildren(make('p', 'member-empty', 'Beiträge werden geladen …'));
    try {
      var postQuery = client.from('posts').select('id,author_id,body,kind,media_path,media_mime,visibility,created_at,author:profiles!posts_author_id_fkey(id,username,display_name,avatar_path)')
        .order('created_at', { ascending: false }).limit(35);
      var shareQuery = client.from('post_shares').select('id,post_id,user_id,caption,created_at,sharer:profiles!post_shares_user_id_fkey(id,username,display_name,avatar_path),original:posts!post_shares_post_id_fkey(id,author_id,body,kind,media_path,media_mime,visibility,created_at,author:profiles!posts_author_id_fkey(id,username,display_name,avatar_path))')
        .order('created_at', { ascending: false }).limit(25);
      if (target === 'pitch') {
        postQuery = postQuery.eq('author_id', authorId);
        shareQuery = shareQuery.eq('user_id', authorId);
      }
      var results = await Promise.all([postQuery, shareQuery]);
      if (request !== feedRequestId) return;
      if (results[0].error) throw results[0].error;
      var posts = results[0].data || [];
      var shares = results[1].error ? [] : (results[1].data || []).filter(function (share) { return share.original && share.sharer; });
      var items = posts.map(function (post) { return { type: 'post', post: post, created_at: post.created_at }; });
      shares.forEach(function (share) { items.push({ type: 'share', share: share, original: share.original, sharer: share.sharer, caption: share.caption, created_at: share.created_at }); });
      items.sort(function (a, b) { return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); });
      items = items.slice(0, 45);
      if (!items.length) {
        list.replaceChildren(make('p', 'member-empty', target === 'pitch' ? 'Auf dieser Pitch-Seite gibt es noch keine Beiträge.' : 'Im Feed ist noch nichts los. Teile den ersten Beitrag.'));
        return;
      }
      var basePosts = [];
      items.forEach(function (item) { basePosts.push(item.type === 'share' ? item.original : item.post); });
      var ids = Array.from(new Set(basePosts.map(function (post) { return post.id; })));
      var likesResult = await client.from('post_likes').select('post_id,user_id').in('post_id', ids).limit(3000);
      var commentsResult = await client.from('post_comments').select('post_id').in('post_id', ids).limit(3000);
      var stats = {};
      ids.forEach(function (id) { stats[id] = { likes: 0, comments: 0, liked: false }; });
      (likesResult.data || []).forEach(function (like) {
        if (!stats[like.post_id]) return;
        stats[like.post_id].likes += 1;
        if (like.user_id === currentUser.id) stats[like.post_id].liked = true;
      });
      (commentsResult.data || []).forEach(function (comment) { if (stats[comment.post_id]) stats[comment.post_id].comments += 1; });
      var profiles = [];
      basePosts.forEach(function (post) { if (post.author) profiles.push(post.author); });
      items.forEach(function (item) { if (item.type === 'share' && item.sharer) profiles.push(item.sharer); });
      await Promise.all([
        signPaths('member-media', basePosts.map(function (post) { return post.media_path; })),
        signPaths('avatars', avatarPaths(profiles))
      ]);
      if (request !== feedRequestId) return;
      list.replaceChildren();
      items.forEach(function (item) {
        var card = renderPostCard(item, stats);
        if (card) list.appendChild(card);
      });
    } catch (error) {
      if (request !== feedRequestId) return;
      list.replaceChildren(make('p', 'member-empty', friendlyError(error)));
    }
  }

  async function toggleLike(postId, button) {
    var liked = button.getAttribute('aria-pressed') === 'true';
    button.disabled = true;
    var result = liked ? await client.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id) : await client.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else {
      var text = button.textContent;
      var count = Number((text.match(/(\d+)$/) || [])[1] || 0);
      var nextCount = Math.max(0, count + (liked ? -1 : 1));
      button.textContent = (liked ? '♡' : '♥') + ' Gefällt mir · ' + nextCount;
      button.classList.toggle('is-liked', !liked);
      button.setAttribute('aria-pressed', liked ? 'false' : 'true');
    }
    button.disabled = false;
  }

  async function loadComments(postId, panel, counterButton) {
    panel.replaceChildren(make('p', 'member-empty', 'Kommentare werden geladen …'));
    var result = await client.from('post_comments').select('id,post_id,author_id,body,created_at,author:profiles!post_comments_author_id_fkey(id,username,display_name,avatar_path)')
      .eq('post_id', postId).order('created_at', { ascending: true }).limit(100);
    if (result.error) {
      panel.replaceChildren(make('p', 'member-empty', friendlyError(result.error)));
      return;
    }
    panel.replaceChildren();
    var comments = result.data || [];
    var profiles = comments.map(function (comment) { return comment.author; }).filter(Boolean);
    await signPaths('avatars', avatarPaths(profiles));
    if (!comments.length) panel.appendChild(make('p', 'member-empty', 'Noch keine Kommentare.'));
    comments.forEach(function (comment) {
      var row = make('div', 'member-comment');
      var avatar = make('span', 'member-avatar');
      fillAvatar(avatar, comment.author, 'avatars');
      var body = make('div', 'member-comment__body');
      body.appendChild(make('strong', '', displayName(comment.author) + ' · ' + dateText(comment.created_at)));
      body.appendChild(document.createTextNode(comment.body));
      row.append(avatar, body);
      panel.appendChild(row);
    });
    var form = make('form', 'member-comment-form');
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 1000;
    input.required = true;
    input.placeholder = 'Kommentar schreiben …';
    input.setAttribute('aria-label', 'Kommentar schreiben');
    var submit = make('button', '', 'Senden');
    submit.type = 'submit';
    form.append(input, submit);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!value) return;
      submit.disabled = true;
      var insert = await client.from('post_comments').insert({ post_id: postId, author_id: currentUser.id, body: value });
      if (insert.error) showGlobal(friendlyError(insert.error), 'error');
      else {
        var count = Number((counterButton.textContent.match(/(\d+)$/) || [])[1] || 0) + 1;
        counterButton.textContent = 'Kommentare · ' + count;
        await loadComments(postId, panel, counterButton);
      }
      submit.disabled = false;
    });
    panel.appendChild(form);
    panel.dataset.loaded = 'true';
  }

  async function deleteFeedItem(item) {
    if (!window.confirm(item.type === 'share' ? 'Dein Teilen wirklich entfernen?' : 'Diesen Beitrag wirklich löschen?')) return;
    var result;
    if (item.type === 'share') result = await client.from('post_shares').delete().eq('id', item.share.id).eq('user_id', currentUser.id);
    else result = await client.from('posts').delete().eq('id', item.post.id).eq('author_id', currentUser.id);
    if (result.error) { showGlobal(friendlyError(result.error), 'error'); return; }
    if (item.type === 'post' && item.post.media_path) await client.storage.from('member-media').remove([item.post.media_path]);
    showGlobal(item.type === 'share' ? 'Geteilter Beitrag entfernt.' : 'Beitrag gelöscht.', 'success');
    if (activeTab === 'feed') await loadFeed('feed');
    if (activeTab === 'pitch') await loadFeed('pitch', currentPitchId);
  }

  async function reportPost(post) {
    var details = window.prompt('Warum möchtest du diesen Beitrag melden? Bitte beschreibe kurz den Grund.');
    if (details === null || !details.trim()) return;
    var result = await client.from('reports').insert({ reporter_id: currentUser.id, target_post_id: post.id, category: 'other', details: details.trim().slice(0, 1000) });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else showGlobal('Danke. Deine Meldung wurde an die Moderation weitergegeben.', 'success');
  }

  async function loadPitch(profileId) {
    if (!client || !currentUser) return;
    var targetId = profileId || currentUser.id;
    currentPitchId = targetId;
    var result = await client.from('profiles').select('id,username,display_name,bio,city,pronouns,birth_date,favorite_genres,website,soundcloud_url,profile_visibility,avatar_path')
      .eq('id', targetId).maybeSingle();
    if (result.error || !result.data) {
      $('#member-pitch-title').textContent = 'Pitch-Seite nicht verfügbar';
      $('#member-pitch-posts').replaceChildren(make('p', 'member-empty', 'Dieses Profil ist nicht verfügbar oder nur für Freunde sichtbar.'));
      return;
    }
    var profile = result.data;
    if (profile.avatar_path) await signPaths('avatars', [profile.avatar_path]);
    fillAvatar($('#member-pitch-avatar'), profile, 'avatars');
    $('#member-pitch-title').textContent = targetId === currentUser.id ? (profile.display_name || 'Deine Pitch-Seite') : displayName(profile);
    $('#member-pitch-handle').textContent = '@' + profile.username + (targetId === currentUser.id ? ' · Deine Pitch-Seite' : ' · Pitch-Seite');
    $('#member-pitch-bio').textContent = profile.bio || (targetId === currentUser.id ? 'Ergänze deine Vorstellung in „Profil & Einstellungen“.' : 'Noch keine Kurzvorstellung.');
    var details = $('#member-pitch-details');
    details.replaceChildren();
    [profile.city, profile.pronouns, profile.favorite_genres].filter(Boolean).forEach(function (value) { details.appendChild(make('span', '', value)); });
    var website = safeUrl(profile.website);
    if (website) {
      var link = make('a', '', 'Website');
      link.href = website;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      details.appendChild(link);
    }
    var soundcloud = safeUrl(profile.soundcloud_url);
    if (soundcloud) {
      var sc = make('a', '', 'SoundCloud');
      sc.href = soundcloud;
      sc.target = '_blank';
      sc.rel = 'noopener noreferrer';
      details.appendChild(sc);
    }
    if (targetId !== currentUser.id) {
      var relationship = relationshipRows.find(function (row) { return row.requester_id === targetId && row.addressee_id === currentUser.id || row.requester_id === currentUser.id && row.addressee_id === targetId; });
      var friendButton = $('#member-pitch-friend');
      var messageButton = $('#member-pitch-message');
      friendButton.hidden = !!(relationship && relationship.status === 'accepted');
      friendButton.disabled = !!(relationship && relationship.status === 'pending');
      friendButton.textContent = relationship && relationship.status === 'pending' ? (relationship.requester_id === currentUser.id ? 'Anfrage gesendet' : 'Anfrage beantworten') : 'Freundschaft anfragen';
      messageButton.hidden = !(relationship && relationship.status === 'accepted');
      friendButton.onclick = function () { requestFriend(targetId); };
      messageButton.onclick = function () { openConversationWith(targetId); };
    } else {
      $('#member-pitch-friend').hidden = true;
      $('#member-pitch-message').hidden = true;
    }
    await loadFeed('pitch', targetId);
  }

  async function loadProfiles(ids) {
    var unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return [];
    var result = await client.from('profiles').select('id,username,display_name,bio,avatar_path,profile_visibility').in('id', unique);
    if (result.error) throw result.error;
    var profiles = result.data || [];
    await signPaths('avatars', avatarPaths(profiles));
    return profiles;
  }

  function relationshipFor(userId) {
    return relationshipRows.find(function (row) {
      return row.requester_id === currentUser.id && row.addressee_id === userId || row.requester_id === userId && row.addressee_id === currentUser.id;
    }) || null;
  }

  async function loadFriends() {
    if (!client || !currentUser) return;
    setStatus($('#member-friends-status'), '', '');
    var result = await client.from('friend_requests').select('id,requester_id,addressee_id,status,created_at')
      .or('requester_id.eq.' + currentUser.id + ',addressee_id.eq.' + currentUser.id).order('created_at', { ascending: false });
    if (result.error) { setStatus($('#member-friends-status'), friendlyError(result.error), 'error'); return; }
    relationshipRows = result.data || [];
    var userIds = [];
    relationshipRows.forEach(function (row) { userIds.push(row.requester_id, row.addressee_id); });
    var profiles = [];
    try { profiles = await loadProfiles(userIds.filter(function (id) { return id !== currentUser.id; })); }
    catch (error) { setStatus($('#member-friends-status'), friendlyError(error), 'error'); }
    var byId = {};
    profiles.forEach(function (profile) { byId[profile.id] = profile; });
    var accepted = relationshipRows.filter(function (row) { return row.status === 'accepted'; });
    var incoming = relationshipRows.filter(function (row) { return row.status === 'pending' && row.addressee_id === currentUser.id; });
    var outgoing = relationshipRows.filter(function (row) { return row.status === 'pending' && row.requester_id === currentUser.id; });
    $('#member-friend-total').textContent = String(accepted.length);
    var badge = $('#member-friends-count');
    badge.textContent = String(incoming.length);
    badge.hidden = incoming.length === 0;
    renderFriendRows($('#member-friend-list'), accepted, byId, 'friend');
    renderFriendRows($('#member-incoming-requests'), incoming, byId, 'incoming');
    renderFriendRows($('#member-outgoing-requests'), outgoing, byId, 'outgoing');
  }

  function renderFriendRows(container, rows, profiles, mode) {
    container.replaceChildren();
    if (!rows.length) {
      var emptyText = mode === 'friend' ? 'Noch keine Freunde. Finde Mitglieder über die Suche.' : mode === 'incoming' ? 'Keine neuen Anfragen.' : 'Keine offenen Anfragen.';
      container.appendChild(make('p', 'member-empty', emptyText));
      return;
    }
    rows.forEach(function (row) {
      var otherId = row.requester_id === currentUser.id ? row.addressee_id : row.requester_id;
      var profile = profiles[otherId] || { id: otherId, display_name: 'Mitglied', username: 'mitglied' };
      var person = make('div', 'member-person');
      var avatar = make('span', 'member-avatar');
      fillAvatar(avatar, profile, 'avatars');
      var info = make('div', 'member-person__info');
      info.append(make('strong', '', displayName(profile)), make('small', '', '@' + profile.username));
      var actions = make('div', 'member-person__actions');
      var pitch = make('button', '', 'Pitch');
      pitch.type = 'button';
      pitch.addEventListener('click', function () { goToPitch(otherId); });
      actions.appendChild(pitch);
      if (mode === 'friend') {
        var chat = make('button', '', 'Nachricht');
        chat.type = 'button';
        chat.addEventListener('click', function () { openConversationWith(otherId); });
        var remove = make('button', 'is-danger', 'Entfernen');
        remove.type = 'button';
        remove.addEventListener('click', function () { removeFriend(otherId); });
        actions.append(chat, remove);
      } else if (mode === 'incoming') {
        var accept = make('button', '', 'Annehmen');
        accept.type = 'button';
        accept.addEventListener('click', function () { respondFriendRequest(row.id, true); });
        var decline = make('button', 'is-danger', 'Ablehnen');
        decline.type = 'button';
        decline.addEventListener('click', function () { respondFriendRequest(row.id, false); });
        actions.append(accept, decline);
      } else {
        var cancel = make('button', 'is-danger', 'Zurückziehen');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { cancelFriendRequest(row.id); });
        actions.appendChild(cancel);
      }
      person.append(avatar, info, actions);
      container.appendChild(person);
    });
  }

  async function searchMembers(event) {
    event.preventDefault();
    var term = $('#member-search-input').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    var resultsContainer = $('#member-search-results');
    if (term.length < 2) {
      resultsContainer.replaceChildren(make('p', 'member-empty', 'Gib mindestens zwei Zeichen ein.'));
      return;
    }
    setStatus($('#member-friends-status'), 'Suche läuft …', '');
    await loadFriends();
    var result = await client.from('profiles').select('id,username,display_name,bio,avatar_path,profile_visibility')
      .ilike('username', '%' + term + '%').neq('id', currentUser.id).limit(12);
    if (result.error) {
      resultsContainer.replaceChildren(make('p', 'member-empty', friendlyError(result.error)));
      setStatus($('#member-friends-status'), '', '');
      return;
    }
    var profiles = result.data || [];
    await signPaths('avatars', avatarPaths(profiles));
    resultsContainer.replaceChildren();
    if (!profiles.length) resultsContainer.appendChild(make('p', 'member-empty', 'Keine passenden Mitglieder gefunden.'));
    profiles.forEach(function (profile) {
      var person = make('div', 'member-person');
      var avatar = make('span', 'member-avatar');
      fillAvatar(avatar, profile, 'avatars');
      var info = make('div', 'member-person__info');
      info.append(make('strong', '', displayName(profile)), make('small', '', '@' + profile.username));
      var actions = make('div', 'member-person__actions');
      var pitch = make('button', '', 'Pitch');
      pitch.type = 'button';
      pitch.addEventListener('click', function () { goToPitch(profile.id); });
      actions.appendChild(pitch);
      var relation = relationshipFor(profile.id);
      if (relation && relation.status === 'accepted') {
        var friend = make('button', '', 'Freund');
        friend.type = 'button';
        friend.disabled = true;
        actions.appendChild(friend);
      } else if (relation && relation.status === 'pending') {
        var pending = make('button', '', relation.requester_id === currentUser.id ? 'Anfrage offen' : 'Annehmen');
        pending.type = 'button';
        pending.disabled = relation.requester_id === currentUser.id;
        if (relation.addressee_id === currentUser.id) pending.addEventListener('click', function () { respondFriendRequest(relation.id, true); });
        actions.appendChild(pending);
      } else {
        var request = make('button', '', 'Anfragen');
        request.type = 'button';
        request.addEventListener('click', function () { requestFriend(profile.id); });
        actions.appendChild(request);
      }
      person.append(avatar, info, actions);
      resultsContainer.appendChild(person);
    });
    setStatus($('#member-friends-status'), profiles.length ? profiles.length + ' Mitglied' + (profiles.length === 1 ? '' : 'er') + ' gefunden.' : '', profiles.length ? 'success' : '');
  }

  async function requestFriend(targetId) {
    var result = await client.rpc('request_friend', { p_target_id: targetId });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else {
      showGlobal('Freundschaftsanfrage aktualisiert.', 'success');
      await loadFriends();
      if (activeTab === 'pitch' && currentPitchId === targetId) await loadPitch(targetId);
      if (activeTab === 'friends' && $('#member-search-input').value.trim().length >= 2) await searchMembers({ preventDefault: function () {} });
    }
  }

  async function respondFriendRequest(requestId, accept) {
    var result = await client.rpc('respond_friend_request', { p_request_id: requestId, p_accept: accept });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else { showGlobal(accept ? 'Freundschaft bestätigt.' : 'Anfrage abgelehnt.', 'success'); await loadFriends(); }
  }

  async function cancelFriendRequest(requestId) {
    var result = await client.from('friend_requests').delete().eq('id', requestId).eq('requester_id', currentUser.id).eq('status', 'pending');
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else { showGlobal('Anfrage zurückgezogen.', 'success'); await loadFriends(); }
  }

  async function removeFriend(friendId) {
    if (!window.confirm('Diese Person aus deiner Freundesliste entfernen?')) return;
    var result = await client.rpc('remove_friend', { p_friend_id: friendId });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else { showGlobal('Freund entfernt.', 'success'); await loadFriends(); }
  }

  async function loadConversations() {
    if (!client || !currentUser) return;
    var list = $('#member-conversation-list');
    var result = await client.from('conversations').select('id,user_one,user_two,updated_at')
      .or('user_one.eq.' + currentUser.id + ',user_two.eq.' + currentUser.id).order('updated_at', { ascending: false });
    if (result.error) { list.replaceChildren(make('p', 'member-empty', friendlyError(result.error))); return; }
    var conversations = result.data || [];
    if (!conversations.length) {
      list.replaceChildren(make('p', 'member-empty', 'Starte einen Chat über deine Freundesliste.'));
      $('#member-chat-empty').hidden = false;
      $('#member-chat-active').hidden = true;
      return;
    }
    var otherIds = conversations.map(function (conversation) { return conversation.user_one === currentUser.id ? conversation.user_two : conversation.user_one; });
    var profiles = await loadProfiles(otherIds);
    var byId = {};
    profiles.forEach(function (profile) { byId[profile.id] = profile; });
    list.replaceChildren();
    conversations.forEach(function (conversation) {
      var otherId = conversation.user_one === currentUser.id ? conversation.user_two : conversation.user_one;
      var profile = byId[otherId] || { id: otherId, username: 'mitglied', display_name: 'Mitglied' };
      var button = make('button', 'member-person' + (conversation.id === selectedConversationId ? ' is-active' : ''));
      button.type = 'button';
      button.setAttribute('aria-label', 'Chat mit ' + displayName(profile));
      var avatar = make('span', 'member-avatar');
      fillAvatar(avatar, profile, 'avatars');
      var info = make('span', 'member-person__info');
      info.append(make('strong', '', displayName(profile)), make('small', '', '@' + profile.username));
      button.append(avatar, info);
      button.addEventListener('click', function () { openConversation(conversation.id, profile); });
      list.appendChild(button);
    });
    if (selectedConversationId) {
      var selected = conversations.find(function (conversation) { return conversation.id === selectedConversationId; });
      if (!selected) { selectedConversationId = null; selectedPeer = null; }
    }
    if (!selectedConversationId) {
      $('#member-chat-empty').hidden = false;
      $('#member-chat-active').hidden = true;
    } else {
      var selectedId = selected.user_one === currentUser.id ? selected.user_two : selected.user_one;
      openConversation(selected.id, byId[selectedId] || { id: selectedId, username: 'mitglied', display_name: 'Mitglied' }, false);
    }
  }

  async function startConversation(friendId) {
    var result = await client.rpc('get_or_create_conversation', { p_friend_id: friendId });
    if (result.error) { showGlobal(friendlyError(result.error), 'error'); return null; }
    return result.data;
  }

  async function openConversationWith(friendId) {
    var conversationId = await startConversation(friendId);
    if (!conversationId) return;
    activeTab = 'messages';
    $$('[data-member-tab]').forEach(function (button) {
      var active = button.dataset.memberTab === 'messages';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $$('[data-member-panel]').forEach(function (panel) { panel.hidden = panel.dataset.memberPanel !== 'messages'; });
    var profiles = await loadProfiles([friendId]);
    openConversation(conversationId, profiles[0] || { id: friendId, display_name: 'Mitglied', username: 'mitglied' });
    await loadConversations();
  }

  function openConversation(conversationId, peer, refreshList) {
    var changedConversation = selectedConversationId !== conversationId;
    selectedConversationId = conversationId;
    selectedPeer = peer;
    $('#member-chat-empty').hidden = true;
    $('#member-chat-active').hidden = false;
    $('#member-chat-peer-name').textContent = displayName(peer);
    $('#member-chat-peer-handle').textContent = '@' + (peer.username || 'mitglied');
    fillAvatar($('#member-chat-peer-avatar'), peer, 'avatars');
    if (changedConversation) {
      if (messageChannel && client) client.removeChannel(messageChannel);
      messageChannel = client.channel('member-dm-' + conversationId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conversationId }, function (payload) {
          if (payload.new && payload.new.sender_id !== currentUser.id && selectedConversationId === conversationId) loadMessages(conversationId);
          loadConversations();
        })
        .subscribe();
    }
    loadMessages(conversationId);
    if (refreshList !== false) loadConversations();
  }

  async function loadMessages(conversationId) {
    if (!client || !conversationId || selectedConversationId !== conversationId) return;
    var container = $('#member-chat-messages');
    var result = await client.from('messages').select('id,conversation_id,sender_id,body,created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(250);
    if (result.error) { container.replaceChildren(make('p', 'member-empty', friendlyError(result.error))); return; }
    container.replaceChildren();
    var messages = result.data || [];
    if (!messages.length) container.appendChild(make('p', 'member-empty', 'Das ist der Anfang eures Chats.'));
    messages.forEach(function (message) {
      var bubble = make('div', 'member-message' + (message.sender_id === currentUser.id ? ' is-mine' : ''), message.body);
      bubble.appendChild(make('time', '', formatTime(message.created_at)));
      container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!selectedConversationId || !currentUser) return;
    var input = $('#member-message-input');
    var body = input.value.trim();
    if (!body) return;
    var send = $('#member-message-form button[type="submit"]');
    send.disabled = true;
    var result = await client.from('messages').insert({ conversation_id: selectedConversationId, sender_id: currentUser.id, body: body });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else {
      input.value = '';
      await loadMessages(selectedConversationId);
      await loadConversations();
    }
    send.disabled = false;
  }

  function populateProfileForm() {
    if (!currentProfile) return;
    $('#member-profile-name').value = currentProfile.display_name || '';
    $('#member-profile-username').value = currentProfile.username || '';
    $('#member-profile-city').value = currentProfile.city || '';
    $('#member-profile-pronouns').value = currentProfile.pronouns || '';
    $('#member-profile-birthday').value = currentProfile.birth_date || '';
    $('#member-profile-genres').value = currentProfile.favorite_genres || '';
    $('#member-profile-website').value = currentProfile.website || '';
    $('#member-profile-soundcloud').value = currentProfile.soundcloud_url || '';
    $('#member-profile-bio').value = currentProfile.bio || '';
    $('#member-profile-visibility').value = currentProfile.profile_visibility || 'members';
    $('#member-profile-email').textContent = currentUser.email || '–';
    fillAvatar($('#member-profile-avatar-preview'), currentProfile, 'avatars');
    $('#member-avatar-file').value = '';
  }

  function previewAvatarFile(file) {
    var node = $('#member-profile-avatar-preview');
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = null;
    if (!file) { fillAvatar(node, currentProfile, 'avatars'); return; }
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(postMediaMime(file)) === -1 || file.size > 5 * 1024 * 1024) {
      $('#member-avatar-file').value = '';
      setStatus($('#member-profile-status'), 'Bitte wähle ein GIF, JPG, PNG oder WebP bis maximal 5 MB.', 'error');
      fillAvatar(node, currentProfile, 'avatars');
      return;
    }
    avatarPreviewUrl = URL.createObjectURL(file);
    node.replaceChildren();
    var image = document.createElement('img');
    image.src = avatarPreviewUrl;
    image.alt = 'Vorschau des Profilbildes';
    node.appendChild(image);
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!currentUser || !client) return;
    if (!$('#member-profile-form').reportValidity()) return;
    var username = $('#member-profile-username').value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      setStatus($('#member-profile-status'), 'Der Benutzername muss 3–24 Zeichen lang sein und darf nur Buchstaben, Zahlen und Unterstriche enthalten.', 'error');
      return;
    }
    var birthday = $('#member-profile-birthday').value || null;
    if (birthday && birthday > new Date().toISOString().slice(0, 10)) {
      setStatus($('#member-profile-status'), 'Der Geburtstag darf nicht in der Zukunft liegen.', 'error');
      return;
    }
    var saveButton = $('#member-profile-form button[type="submit"]');
    saveButton.disabled = true;
    setStatus($('#member-profile-status'), 'Profil wird gespeichert …', '');
    var avatarFile = $('#member-avatar-file').files[0] || null;
    var newAvatarPath = null;
    var oldAvatarPath = currentProfile.avatar_path;
    try {
      if (avatarFile) {
        var avatarMime = postMediaMime(avatarFile);
        newAvatarPath = currentUser.id + '/' + uuid() + '.' + fileExtension(avatarFile, avatarMime);
        var upload = await client.storage.from('avatars').upload(newAvatarPath, avatarFile, { contentType: avatarMime, cacheControl: '3600', upsert: false });
        if (upload.error) throw upload.error;
      }
      var updates = {
        display_name: $('#member-profile-name').value.trim(),
        username: username,
        city: $('#member-profile-city').value.trim(),
        pronouns: $('#member-profile-pronouns').value.trim(),
        birth_date: birthday,
        favorite_genres: $('#member-profile-genres').value.trim(),
        website: $('#member-profile-website').value.trim(),
        soundcloud_url: $('#member-profile-soundcloud').value.trim(),
        bio: $('#member-profile-bio').value.trim(),
        profile_visibility: $('#member-profile-visibility').value === 'friends' ? 'friends' : 'members'
      };
      if (newAvatarPath) updates.avatar_path = newAvatarPath;
      var result = await client.from('profiles').update(updates).eq('id', currentUser.id);
      if (result.error) {
        if (newAvatarPath) await client.storage.from('avatars').remove([newAvatarPath]);
        throw result.error;
      }
      signedUrlCache.delete('avatars:' + oldAvatarPath);
      currentProfile = Object.assign({}, currentProfile, updates);
      if (newAvatarPath && oldAvatarPath) await client.storage.from('avatars').remove([oldAvatarPath]);
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      avatarPreviewUrl = null;
      await loadCurrentProfile();
      $('#member-sidebar-name').textContent = currentProfile.display_name;
      $('#member-sidebar-handle').textContent = '@' + currentProfile.username;
      $('#member-welcome').textContent = 'Willkommen, ' + currentProfile.display_name;
      fillAvatar($('#member-sidebar-avatar'), currentProfile, 'avatars');
      fillAvatar($('#member-composer-avatar'), currentProfile, 'avatars');
      updateHeader();
      populateProfileForm();
      setStatus($('#member-profile-status'), 'Dein Profil wurde gespeichert.', 'success');
    } catch (error) {
      setStatus($('#member-profile-status'), friendlyError(error), 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  async function requestAccountDeletion() {
    if (!window.confirm('Möchtest du eine Löschung deines Kontos beantragen? Das Konto wird nicht sofort gelöscht; der Betreiber muss den Antrag bearbeiten.')) return;
    var result = await client.from('account_deletion_requests').insert({ user_id: currentUser.id });
    if (result.error && !String(result.error.message || '').toLowerCase().includes('duplicate')) showGlobal(friendlyError(result.error), 'error');
    else showGlobal('Dein Löschantrag ist eingegangen. Der Betreiber muss ihn noch bearbeiten.', 'success');
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (!client || !currentUser) return;
    var form = $('#member-password-update-form');
    if (!form.reportValidity()) return;
    var password = $('#member-new-password').value;
    if (password !== $('#member-new-password-confirm').value) {
      showGlobal('Die beiden Passwörter stimmen nicht überein.', 'error');
      return;
    }
    var submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    var result = await client.auth.updateUser({ password: password });
    if (result.error) showGlobal(friendlyError(result.error), 'error');
    else {
      form.reset();
      form.hidden = true;
      authPanel.classList.remove('is-recovering');
      authPanel.hidden = true;
      dashboard.hidden = false;
      showGlobal('Dein Passwort wurde geändert.', 'success');
      switchTab('feed');
    }
    submit.disabled = false;
  }

  function bindEvents() {
    if (staticEventsBound) return;
    staticEventsBound = true;

    $$('[data-auth-mode]').forEach(function (button) { button.addEventListener('click', function () { setAuthMode(button.dataset.authMode); }); });
    $$('[data-member-tab]').forEach(function (button) { button.addEventListener('click', function () {
      if (button.dataset.memberTab === 'pitch' && currentUser) currentPitchId = currentUser.id;
      switchTab(button.dataset.memberTab);
    }); });
    $$('[data-post-kind]').forEach(function (button) { button.addEventListener('click', function () { setPostKind(button.dataset.postKind); }); });

    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!client) { showGlobal('Der Mitgliederbereich ist noch nicht mit Supabase verbunden.', 'error'); return; }
      if (!loginForm.reportValidity()) return;
      var submit = loginForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      showGlobal('Du wirst angemeldet …', '');
      var result = await client.auth.signInWithPassword({ email: $('#member-login-email').value.trim(), password: $('#member-login-password').value });
      if (result.error) showGlobal(friendlyError(result.error), 'error');
      else showGlobal('Willkommen zurück.', 'success');
      submit.disabled = false;
    });

    registerForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!client) { showGlobal('Der Mitgliederbereich ist noch nicht mit Supabase verbunden.', 'error'); return; }
      if (!registerForm.reportValidity()) return;
      if (!$('#member-register-consent').checked) { showGlobal('Bitte bestätige die Community-Regeln und Datenschutzhinweise.', 'error'); return; }
      var username = $('#member-register-username').value.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) { showGlobal('Der Benutzername muss 3–24 Zeichen lang sein und darf nur Buchstaben, Zahlen und Unterstriche enthalten.', 'error'); return; }
      var submit = registerForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      showGlobal('Dein Konto wird erstellt …', '');
      var result = await client.auth.signUp({
        email: $('#member-register-email').value.trim(),
        password: $('#member-register-password').value,
        options: {
          emailRedirectTo: callbackUrl(),
          data: { display_name: $('#member-register-name').value.trim(), username: username }
        }
      });
      if (result.error) showGlobal(friendlyError(result.error), 'error');
      else if (result.data.session) showGlobal('Konto erstellt. Willkommen in der Community!', 'success');
      else {
        setAuthMode('login');
        showGlobal('Fast geschafft: Bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben.', 'success');
      }
      submit.disabled = false;
    });

    $('#member-forgot-password').addEventListener('click', async function () {
      if (!client) return;
      var email = $('#member-login-email').value.trim();
      if (!email) { showGlobal('Trage zuerst deine E-Mail-Adresse ein.', 'error'); $('#member-login-email').focus(); return; }
      var result = await client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() });
      if (result.error) showGlobal(friendlyError(result.error), 'error');
      else showGlobal('Falls ein Konto zu dieser E-Mail-Adresse existiert, erhältst du einen Link zum Zurücksetzen des Passworts.', 'success');
    });

    $('#member-password-update-form').addEventListener('submit', updatePassword);
    $('#member-cancel-password-update').addEventListener('click', async function () {
      if (client) await client.auth.signOut();
    });

    $$('[data-oauth-provider]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (!client) { showGlobal('Der Mitgliederbereich ist noch nicht mit Supabase verbunden.', 'error'); return; }
        if (!$('#member-social-consent').checked) { showGlobal('Bitte bestätige zuerst die Community-Regeln und Datenschutzhinweise.', 'error'); $('#member-social-consent').focus(); return; }
        var result = await client.auth.signInWithOAuth({ provider: button.dataset.oauthProvider, options: { redirectTo: callbackUrl() } });
        if (result.error) showGlobal(friendlyError(result.error), 'error');
      });
    });

    $('#member-sign-out').addEventListener('click', async function () {
      if (!client) return;
      if (messageChannel) client.removeChannel(messageChannel);
      messageChannel = null;
      var result = await client.auth.signOut();
      if (result.error) showGlobal(friendlyError(result.error), 'error');
    });

    $('#member-post-form').addEventListener('submit', publishPost);
    $('#member-post-file').addEventListener('change', function () { setPostFile(this.files && this.files[0]); });
    $('#member-clear-upload').addEventListener('click', clearPostFile);
    $('#member-record-start').addEventListener('click', startVoiceRecording);
    $('#member-record-stop').addEventListener('click', function () {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    });
    $('#member-feed-refresh').addEventListener('click', function () { loadFeed('feed'); });
    $('#member-pitch-refresh').addEventListener('click', function () { loadPitch(currentPitchId || currentUser.id); });

    $('#member-search-form').addEventListener('submit', searchMembers);
    $('#member-profile-form').addEventListener('submit', saveProfile);
    $('#member-avatar-file').addEventListener('change', function () { previewAvatarFile(this.files && this.files[0]); });
    $('#member-delete-request').addEventListener('click', requestAccountDeletion);
    $('#member-message-form').addEventListener('submit', sendMessage);
    $('#member-message-input').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#member-message-form').requestSubmit(); }
    });
  }

  bindEvents();
  setAuthMode('login');
  setPostKind('text');
  updateHeader();
  window.addEventListener('hashchange', function () { if (window.location.hash.slice(1) === 'club') boot(); });
  if (window.location.hash.slice(1) === 'club') boot();
})();
