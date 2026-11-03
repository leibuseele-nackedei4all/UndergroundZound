/*
 * Leib & Seele – Admin-Konsole (admin.html)
 * ---------------------------------------------------------------------------
 * Statischer Browser-Client. Alle Rechteprüfungen passieren serverseitig in
 * Supabase: jede admin_*-Funktion beginnt mit app_admins-Prüfung und ist nur
 * für "authenticated" freigegeben. Diese Datei ist reine Bedienoberfläche.
 *
 * Benötigt: assets/js/member-config.js und
 *           supabase/migrations/202610300001_admin_console.sql
 */
(function () {
  'use strict';

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var config = window.MEMBER_CONFIG || {};
  var supabaseUrl = normalizeSupabaseUrl(config.supabaseUrl);
  var publicKey = String(config.supabasePublicKey || config.anonKey || '').trim();

  var client = null;
  var session = null;
  var adminUser = null;
  var adminProfile = null;
  var booted = false;
  var handlingAuth = false;
  var gateMessageOverride = null;

  var PAGE_SIZE = {
    members: 20, posts: 20, comments: 30, reports: 20,
    deletions: 20, friends: 30, messages: 20, media: 24, audit: 40
  };

  var state = {
    tab: 'dashboard',
    members: { page: 0, query: '', sort: 'newest' },
    posts: { page: 0, query: '', kind: '', visibility: '' },
    comments: { page: 0, query: '' },
    reports: { page: 0, status: 'new' },
    deletions: { page: 0 },
    friends: { page: 0, status: '', query: '' },
    messages: { page: 0, query: '', openId: null },
    media: { page: 0, bucket: 'member-media', query: '' },
    audit: { page: 0 }
  };

  var settingsValues = {};
  var signedCache = new Map();
  var toastTimer = null;

  var gate = $('#admin-gate');
  var consoleRoot = $('#admin-console');
  var loginForm = $('#admin-login-form');
  var setupNote = $('#admin-setup-note');
  var flashNode = $('#admin-flash');
  var dialog = $('#admin-dialog');
  var dialogTitle = $('#admin-dialog-title');
  var dialogBody = $('#admin-dialog-body');
  var dialogFoot = $('#admin-dialog-foot');
  var toastNode = $('#admin-toast');

  /* ----------------------------------------------------------- Grundlagen */

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(id) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function button(label, options) {
    var opts = options || {};
    var node = h('button', 'admin-button admin-button--small ' + (opts.className || 'admin-button--ghost'));
    node.type = 'button';
    if (opts.icon) node.appendChild(icon(opts.icon));
    node.appendChild(document.createTextNode(label));
    if (opts.onClick) node.addEventListener('click', opts.onClick);
    if (opts.disabled) node.disabled = true;
    return node;
  }

  function flash(text, kind) {
    if (!flashNode) return;
    flashNode.textContent = text || '';
    if (kind) flashNode.dataset.kind = kind; else delete flashNode.dataset.kind;
    flashNode.hidden = !text;
  }

  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    if (kind) node.dataset.kind = kind; else delete node.dataset.kind;
  }

  function toast(text, kind) {
    if (!toastNode) return;
    toastNode.textContent = text || '';
    if (kind) toastNode.dataset.kind = kind; else delete toastNode.dataset.kind;
    toastNode.hidden = !text;
    window.clearTimeout(toastTimer);
    if (text) toastTimer = window.setTimeout(function () { toastNode.hidden = true; }, 4200);
  }

  function fmtDate(value, withTime) {
    if (!value) return '–';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    try {
      return new Intl.DateTimeFormat('de-DE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
    } catch (error) { return date.toLocaleString('de-DE'); }
  }

  function fmtBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + ' MB';
    return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function initials(profile) {
    var value = (profile && (profile.display_name || profile.username)) || 'Mitglied';
    var parts = String(value).trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : String(value).slice(0, 2)).toUpperCase();
  }

  function truncated(text, max) {
    var value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  }

  function friendly(error) {
    var message = (error && error.message) ? String(error.message) : 'Unbekannter Fehler.';
    if (error && (error.code === 'PGRST202' || /could not find the function|schema cache/i.test(message))) {
      return 'Die Admin-Funktionen fehlen in der Datenbank. Führe supabase/migrations/202610300001_admin_console.sql im Supabase-SQL-Editor aus.';
    }
    if (/Kein Administratorzugriff/i.test(message)) return 'Dieses Konto hat keinen Administratorzugriff.';
    if (/Anmeldung erforderlich/i.test(message)) return 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.';
    if (/Invalid login credentials/i.test(message)) return 'E-Mail-Adresse oder Passwort ist falsch.';
    if (/Email not confirmed/i.test(message)) return 'Die E-Mail-Adresse ist noch nicht bestätigt. Prüfe dein Postfach.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return 'Keine Verbindung zu Supabase. Prüfe die Internetverbindung und die Projekt-URL.';
    return message;
  }


  function normalizeSupabaseUrl(value) {
    var url = String(value || '').trim().replace(/\/+$/, '');
    return url.replace(/\/(rest|auth|storage|realtime)\/v1$/i, '');
  }

  function configReady() {
    return /^https?:\/\//i.test(supabaseUrl) && publicKey.length > 20;
  }

  /* ---------------------------------------------------------------- Client */

  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === 'function') return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var existing = $('script[data-admin-supabase-sdk]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.supabase); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Die Supabase-Bibliothek konnte nicht geladen werden.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = new URL('assets/js/vendor/supabase.min.js', document.baseURI).href;
      script.async = true;
      script.dataset.adminSupabaseSdk = 'true';
      script.onload = function () {
        if (window.supabase && typeof window.supabase.createClient === 'function') resolve(window.supabase);
        else reject(new Error('Die Supabase-Bibliothek ist nicht verfügbar.'));
      };
      script.onerror = function () { reject(new Error('Die Supabase-Bibliothek konnte nicht geladen werden.')); };
      document.head.appendChild(script);
    });
  }

  async function rpc(name, args) {
    if (!client) throw new Error('Der Admin-Bereich ist noch nicht mit Supabase verbunden.');
    var result = await client.rpc(name, args || {});
    if (result.error) throw new Error(friendly(result.error));
    return result.data;
  }

  function cleanAuthParams() {
    try {
      var url = new URL(window.location.href);
      ['code', 'error', 'error_code', 'error_description', 'state', 'sb_flow_id'].forEach(function (key) {
        url.searchParams.delete(key);
      });
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (error) { /* egal */ }
  }

  function setGateEnabled(enabled) {
    $$('#admin-login-form input, #admin-login-form button').forEach(function (node) { node.disabled = !enabled; });
  }

  function loadSdkAndClient() {
    return loadSdk().then(function (library) {
      client = library.createClient(supabaseUrl, publicKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
      });
      client.auth.onAuthStateChange(function (event, nextSession) {
        window.setTimeout(function () { handleAuth(event, nextSession); }, 0);
      });
      setGateEnabled(true);
      return client.auth.getSession();
    }).then(function (result) {
      if (result.error) throw result.error;
      return handleAuth('INITIAL_SESSION', result.data.session);
    });
  }

  function boot() {
    if (booted) return;
    booted = true;
    if (!configReady()) {
      if (setupNote) setupNote.hidden = false;
      flash('Ohne Supabase-Projekt-URL und Publishable-Key ist keine Anmeldung möglich.', 'error');
      setGateEnabled(false);
      return;
    }
    if (setupNote) setupNote.hidden = true;
    loadSdkAndClient().catch(function (error) {
      booted = false;
      setGateEnabled(false);
      flash(friendly(error), 'error');
    });
  }

  /* ----------------------------------------------------------------- Login */

  function showGate(message, kind) {
    session = null;
    adminUser = null;
    adminProfile = null;
    if (gate) gate.hidden = false;
    if (consoleRoot) consoleRoot.hidden = true;
    $('#admin-session').hidden = true;
    $('#admin-sign-out').hidden = true;
    if (message) flash(message, kind || 'error');
  }

  function oauthErrorMessage(params) {
    var code = String(params.get('error') || params.get('error_code') || '').toLowerCase();
    var description = params.get('error_description') || '';
    if (code === 'access_denied' || /denied|abgebrochen|cancell?ed/i.test(description)) {
      return 'Die Anmeldung wurde abgebrochen. Du kannst es jederzeit erneut versuchen.';
    }
    if (/code verifier|code_verifier/i.test(description)) {
      return 'Der Anmelde-Link ist abgelaufen oder wurde in einem anderen Browser geöffnet. Bitte melde dich erneut an.';
    }
    if (description) return 'Anmeldung nicht abgeschlossen: ' + description;
    return 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.';
  }

  async function handleAuth(event, nextSession) {
    if (event === 'PASSWORD_RECOVERY') {
      cleanAuthParams();
      showRecoveryDialog();
      return;
    }
    if (handlingAuth) return;
    if (!nextSession || !nextSession.user) {
      if (gateMessageOverride) {
        showGate(gateMessageOverride.text, gateMessageOverride.kind);
        gateMessageOverride = null;
        return;
      }
      showGate(event === 'SIGNED_OUT' ? 'Du wurdest abgemeldet.' : 'Bitte melde dich mit deinem Admin-Konto an.', event === 'SIGNED_OUT' ? 'success' : '');
      return;
    }
    if (session && adminUser && session.user.id === adminUser.id && event !== 'USER_UPDATED') return;

    handlingAuth = true;
    try {
      session = nextSession;
      var isAdmin = await rpc('is_admin');
      if (!isAdmin) {
        gateMessageOverride = {
          text: 'Dieses Konto ist kein Administrator. Zugriff verweigert – die Sitzung wurde beendet. Trage das Konto in Supabase in public.app_admins ein (oder führe supabase/migrations/202610300001_admin_console.sql aus).',
          kind: 'error'
        };
        showGate(gateMessageOverride.text, 'error');
        await client.auth.signOut();
        return;
      }
      adminUser = nextSession.user;
      var profileResult = await client.from('profiles')
        .select('id,username,display_name,avatar_path')
        .eq('id', adminUser.id).maybeSingle();
      adminProfile = profileResult.data || { id: adminUser.id, display_name: adminUser.email, username: '' };
      flash('');
      renderSessionHeader();
      openConsole();
    } catch (error) {
      showGate(friendly(error), 'error');
    } finally {
      handlingAuth = false;
    }
  }

  async function renderSessionHeader() {
    var name = (adminProfile && (adminProfile.display_name || adminProfile.username)) || 'Admin';
    var node = $('#admin-session');
    var avatar = $('#admin-session-avatar');
    node.hidden = false;
    $('#admin-session-name').textContent = name;
    $('#admin-session-email').textContent = (adminUser && adminUser.email) || '';
    $('#admin-sign-out').hidden = false;
    avatar.replaceChildren();
    if (adminProfile && adminProfile.avatar_path) {
      var url = await signedUrl('avatars', adminProfile.avatar_path);
      if (url) {
        var img = h('img');
        img.src = url;
        img.alt = '';
        avatar.appendChild(img);
        return;
      }
    }
    avatar.textContent = initials(adminProfile);
  }

  async function openConsole() {
    if (gate) gate.hidden = true;
    if (consoleRoot) consoleRoot.hidden = false;
    switchTab(state.tab || 'dashboard', true);
    refreshStats();
  }

  function showRecoveryDialog() {
    showGate('Passwort zurücksetzen: Bitte neues Passwort festlegen.', 'success');
    var first = { name: 'password', label: 'Neues Passwort', type: 'password', placeholder: 'Mindestens 10 Zeichen', required: true };
    var second = { name: 'confirm', label: 'Passwort wiederholen', type: 'password', placeholder: 'Passwort erneut eingeben', required: true };
    openFormDialog({
      title: 'Neues Passwort',
      message: 'Der Link aus der E-Mail wurde bestätigt. Lege jetzt ein neues Passwort für dein Konto fest.',
      fields: [first, second],
      confirmLabel: 'Passwort speichern'
    }).then(async function (values) {
      if (!values) return;
      if (values.password.length < 10) { toast('Das Passwort braucht mindestens 10 Zeichen.', 'error'); return; }
      if (values.password !== values.confirm) { toast('Die Passwörter stimmen nicht überein.', 'error'); return; }
      var result = await client.auth.updateUser({ password: values.password });
      if (result.error) { toast(friendly(result.error), 'error'); return; }
      toast('Passwort geändert. Du kannst dich jetzt anmelden.', 'success');
      await client.auth.signOut();
    });
  }

  /* --------------------------------------------------------- Dialog-Helfer */

  function closeDialog() {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function openDialog(options) {
    dialogTitle.textContent = options.title || 'Details';
    dialogBody.replaceChildren();
    dialogFoot.replaceChildren();
    (options.body || []).forEach(function (node) { if (node) dialogBody.appendChild(node); });
    (options.foot || []).forEach(function (node) { if (node) dialogFoot.appendChild(node); });
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return dialog;
  }

  function askConfirm(options) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('close', onClose);
        closeDialog();
        resolve(value);
      }
      function onClose() { done(false); }
      dialog.addEventListener('close', onClose);
      var body = [];
      if (options.message) body.push(h('p', 'admin-row__text', options.message));
      if (options.note) body.push(h('p', 'admin-note', options.note));
      openDialog({
        title: options.title || 'Bestätigen',
        body: body,
        foot: [
          button(options.cancelLabel || 'Abbrechen', { onClick: function () { done(false); } }),
          button(options.confirmLabel || 'Bestätigen', {
            className: options.danger ? 'admin-button--danger' : 'admin-button--gold',
            onClick: function () { done(true); }
          })
        ]
      });
    });
  }

  function openFormDialog(options) {
    return new Promise(function (resolve) {
      var settled = false;
      var inputs = {};
      function done(value) {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('close', onClose);
        closeDialog();
        resolve(value);
      }
      function onClose() { done(null); }
      dialog.addEventListener('close', onClose);

      var fieldNodes = [];
      if (options.message) fieldNodes.push(h('p', 'admin-row__text', options.message));
      (options.fields || []).forEach(function (field) {
        var label = h('label', 'admin-field');
        label.appendChild(h('span', null, field.label));
        var input;
        if (field.type === 'textarea') {
          input = h('textarea');
          input.rows = field.rows || 3;
        } else if (field.type === 'select') {
          input = h('select');
          (field.options || []).forEach(function (option) {
            var opt = h('option', null, option.label);
            opt.value = option.value;
            if (String(option.value) === String(field.value)) opt.selected = true;
            input.appendChild(opt);
          });
        } else {
          input = h('input');
          input.type = field.type || 'text';
        }
        if (field.placeholder && field.type !== 'select') input.placeholder = field.placeholder;
        if (field.maxlength) input.maxLength = field.maxlength;
        if (field.value != null && field.type !== 'select') input.value = field.value;
        if (field.required) input.required = true;
        inputs[field.name] = input;
        label.appendChild(input);
        fieldNodes.push(label);
      });

      var status = h('span', 'admin-form-status');
      status.setAttribute('role', 'status');
      var foot = [
        status,
        button('Abbrechen', { onClick: function () { done(null); } }),
        button(options.confirmLabel || 'Speichern', {
          className: options.danger ? 'admin-button--danger' : 'admin-button--gold',
          onClick: function () {
            var values = {};
            var missing = null;
            Object.keys(inputs).forEach(function (name) {
              values[name] = inputs[name].value.trim();
              var field = (options.fields || []).filter(function (f) { return f.name === name; })[0];
              if (field && field.required && !values[name]) missing = field.label;
            });
            if (missing) { setStatus(status, missing + ' fehlt.', 'error'); return; }
            if (options.validate) {
              var problem = options.validate(values);
              if (problem) { setStatus(status, problem, 'error'); return; }
            }
            done(values);
          }
        })
      ];
      openDialog({ title: options.title || 'Eingabe', body: fieldNodes, foot: foot });
      var firstInput = Object.keys(inputs)[0];
      if (firstInput) window.setTimeout(function () { inputs[firstInput].focus(); }, 30);
    });
  }

  /* ------------------------------------------------------------- Storage */

  async function signedUrl(bucket, path, expires) {
    if (!path || !client) return '';
    var key = bucket + ':' + path;
    var cached = signedCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    var result = await client.storage.from(bucket).createSignedUrl(path, expires || 1800);
    if (result.error || !result.data) return '';
    signedCache.set(key, { url: result.data.signedUrl, expiresAt: Date.now() + 25 * 60 * 1000 });
    return result.data.signedUrl;
  }

  function avatarNode(profile, className) {
    var node = h('span', className || 'admin-row__avatar');
    node.textContent = initials(profile);
    if (profile && profile.avatar_path) {
      signedUrl('avatars', profile.avatar_path).then(function (url) {
        if (!url) return;
        var img = h('img');
        img.src = url;
        img.alt = '';
        node.replaceChildren(img);
      });
    }
    return node;
  }

  /* --------------------------------------------------------------- Tabs */

  function switchTab(tab, force) {
    if (!tab) return;
    if (!force && tab === state.tab && document.querySelector('[data-admin-panel="' + tab + '"]:not([hidden])')) return;
    state.tab = tab;
    $$('[data-admin-tab]').forEach(function (node) {
      var active = node.dataset.adminTab === tab;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-current', active ? 'true' : 'false');
    });
    $$('[data-admin-panel]').forEach(function (panel) { panel.hidden = panel.dataset.adminPanel !== tab; });
    loadTab(tab);
  }

  function loadTab(tab) {
    var loaders = {
      dashboard: loadDashboard,
      members: loadMembers,
      admins: loadAdmins,
      posts: loadPosts,
      comments: loadComments,
      reports: loadReports,
      deletions: loadDeletions,
      friends: loadFriends,
      messages: loadConversations,
      media: loadMedia,
      settings: loadSettings,
      audit: loadAudit
    };
    var loader = loaders[tab];
    if (!loader) return;
    loader().catch(function (error) { showTabError(tab, error); });
  }

  function showTabError(tab, error) {
    var panel = $('[data-admin-panel="' + tab + '"]');
    if (!panel) return;
    var target = panel.querySelector('[data-error-slot]');
    if (!target) {
      target = h('div', 'admin-flash');
      target.dataset.errorSlot = 'true';
      target.dataset.kind = 'error';
      panel.appendChild(target);
    }
    target.textContent = friendly(error);
    target.hidden = false;
  }

  function clearTabError(tab) {
    var panel = $('[data-admin-panel="' + tab + '"]');
    if (!panel) return;
    var node = panel.querySelector('[data-error-slot]');
    if (node) node.hidden = true;
  }

  function renderPager(name, total, page, size, reload) {
    var holder = $('[data-pager="' + name + '"]');
    if (!holder) return;
    holder.replaceChildren();
    var pages = Math.max(1, Math.ceil(total / size));
    if (pages <= 1) { holder.hidden = true; return; }
    holder.hidden = false;
    var prev = button('‹ Zurück', { disabled: page <= 0, onClick: function () { reload(page - 1); } });
    var next = button('Weiter ›', { disabled: page >= pages - 1, onClick: function () { reload(page + 1); } });
    holder.appendChild(prev);
    holder.appendChild(h('span', null, 'Seite ' + (page + 1) + ' von ' + pages + ' · ' + total + ' Einträge'));
    holder.appendChild(next);
  }

  function emptyRow(text) { return h('p', 'admin-empty', text); }

  function tag(text, kind) {
    return h('span', 'admin-tag' + (kind ? ' admin-tag--' + kind : ''), text);
  }

  function setCount(id, value) {
    var node = document.getElementById(id);
    if (!node) return;
    if (!value) { node.hidden = true; return; }
    node.hidden = false;
    node.textContent = value;
  }

  /* ------------------------------------------------------------ Dashboard */

  async function refreshStats() {
    try {
      var data = await rpc('admin_dashboard');
      setCount('admin-count-members', data.members);
      setCount('admin-count-reports', data.reports_open);
      setCount('admin-count-deletions', data.deletions_open);
      return data;
    } catch (error) {
      return null;
    }
  }

  async function loadDashboard() {
    clearTabError('dashboard');
    var data = await rpc('admin_dashboard');
    setCount('admin-count-members', data.members);
    setCount('admin-count-reports', data.reports_open);
    setCount('admin-count-deletions', data.deletions_open);

    var stamp = $('#admin-dashboard-stamp');
    if (stamp) stamp.textContent = 'Stand ' + fmtDate(data.generated_at, true);

    var stats = [
      { label: 'Mitglieder', value: data.members, hint: '+' + data.signups_7d + ' in 7 Tagen', tab: 'members' },
      { label: 'Gesperrt', value: data.banned, hint: 'aktive Sperren', tab: 'members', alert: data.banned > 0 },
      { label: 'Beiträge', value: data.posts, hint: data.posts_7d + ' neue in 7 Tagen', tab: 'posts' },
      { label: 'Kommentare', value: data.comments, hint: data.comments_7d + ' neue in 7 Tagen', tab: 'comments' },
      { label: 'Meldungen offen', value: data.reports_open, hint: data.reports_new + ' neu', tab: 'reports', alert: data.reports_open > 0 },
      { label: 'Löschanträge', value: data.deletions_open, hint: data.deletions_total + ' insgesamt', tab: 'deletions', alert: data.deletions_open > 0 },
      { label: 'Nachrichten', value: data.messages, hint: data.conversations + ' Unterhaltungen', tab: 'messages' },
      { label: 'Freundschaften', value: data.friends_accepted, hint: data.friends_pending + ' offen', tab: 'friends' },
      { label: 'Medien', value: data.media_objects, hint: fmtBytes(data.media_bytes), tab: 'media' },
      { label: 'Administratoren', value: data.admins, hint: 'mit Vollzugriff', tab: 'admins' }
    ];

    var statsRoot = $('#admin-stats');
    statsRoot.replaceChildren();
    stats.forEach(function (item) {
      var card = h('button', 'admin-stat' + (item.alert ? ' admin-stat--alert' : ''));
      card.type = 'button';
      card.appendChild(h('span', 'admin-stat__label', item.label));
      card.appendChild(h('strong', 'admin-stat__value', String(item.value)));
      card.appendChild(h('span', 'admin-stat__hint', item.hint));
      card.addEventListener('click', function () { switchTab(item.tab); });
      statsRoot.appendChild(card);
    });

    renderMiniMembers(data.latest_members || []);
    renderMiniPosts(data.latest_posts || []);
    renderMiniReports(data.latest_reports || []);
    renderMiniAudit(data.latest_audit || []);
  }

  function miniRow(avatarNodeEl, title, subtitle, side) {
    var row = h('div', 'admin-mini');
    if (avatarNodeEl) row.appendChild(avatarNodeEl);
    var body = h('div', 'admin-mini__body');
    body.appendChild(h('strong', null, title || '–'));
    if (subtitle) body.appendChild(h('span', null, subtitle));
    row.appendChild(body);
    if (side) row.appendChild(h('span', 'admin-mini__side', side));
    return row;
  }

  function renderMiniMembers(rows) {
    var root = $('#admin-latest-members');
    root.replaceChildren();
    if (!rows.length) { root.appendChild(emptyRow('Noch keine Mitglieder.')); return; }
    rows.forEach(function (member) {
      root.appendChild(miniRow(avatarNode(member, 'admin-mini__avatar'), member.display_name || member.username, '@' + member.username + (member.email ? ' · ' + member.email : ''), fmtDate(member.created_at)));
    });
  }

  function renderMiniPosts(rows) {
    var root = $('#admin-latest-posts');
    root.replaceChildren();
    if (!rows.length) { root.appendChild(emptyRow('Noch keine Beiträge.')); return; }
    rows.forEach(function (post) {
      root.appendChild(miniRow(null, truncated(post.body || '[' + post.kind + ']', 60), '@' + post.author_username, fmtDate(post.created_at)));
    });
  }

  function renderMiniReports(rows) {
    var root = $('#admin-latest-reports');
    root.replaceChildren();
    if (!rows.length) { root.appendChild(emptyRow('Keine Meldungen – alles ruhig.')); return; }
    rows.forEach(function (report) {
      root.appendChild(miniRow(null, reportCategory(report.category), '@' + (report.reporter_username || 'unbekannt') + ' · ' + report.status, fmtDate(report.created_at)));
    });
  }

  function renderMiniAudit(rows) {
    var root = $('#admin-latest-audit');
    root.replaceChildren();
    if (!rows.length) { root.appendChild(emptyRow('Noch keine Aktionen.')); return; }
    rows.forEach(function (entry) {
      root.appendChild(miniRow(null, actionLabel(entry.action), entry.admin_email || 'Admin', fmtDate(entry.created_at, true)));
    });
  }

  /* ------------------------------------------------------------- Mitglieder */

  async function loadMembers(page) {
    clearTabError('members');
    var filter = state.members;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-members-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_members', {
      p_search: filter.query || null,
      p_limit: PAGE_SIZE.members,
      p_offset: filter.page * PAGE_SIZE.members,
      p_sort: filter.sort
    });
    var count = $('#admin-members-count');
    if (count) count.textContent = data.total + ' Konten' + (filter.query ? ' für „' + filter.query + '“' : '');
    list.replaceChildren();
    if (!data.rows.length) { list.appendChild(emptyRow('Keine Mitglieder gefunden.')); }
    data.rows.forEach(function (member) { list.appendChild(memberRow(member)); });
    renderPager('members', data.total, filter.page, PAGE_SIZE.members, function (next) { loadMembers(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  function memberRow(member) {
    var row = h('div', 'admin-row');
    row.appendChild(avatarNode(member));
    var body = h('div', 'admin-row__body');
    var title = h('div', 'admin-row__title');
    title.appendChild(document.createTextNode(member.display_name || member.username));
    title.appendChild(h('em', null, '@' + member.username));
    if (member.is_admin) title.appendChild(tag('Admin', 'admin'));
    if (member.is_banned) title.appendChild(tag(member.ban_until ? 'Gesperrt bis ' + fmtDate(member.ban_until) : 'Gesperrt', 'ban'));
    body.appendChild(title);
    var meta = h('div', 'admin-row__meta');
    meta.appendChild(h('span', null, member.email || 'keine E-Mail'));
    if (member.city) meta.appendChild(h('span', null, member.city));
    meta.appendChild(h('span', null, member.post_count + ' Beiträge'));
    meta.appendChild(h('span', null, member.friend_count + ' Freunde'));
    meta.appendChild(h('span', null, 'registriert ' + fmtDate(member.created_at)));
    if (member.last_sign_in_at) meta.appendChild(h('span', null, 'zuletzt aktiv ' + fmtDate(member.last_sign_in_at, true)));
    body.appendChild(meta);
    row.appendChild(body);

    var actions = h('div', 'admin-row__actions');
    actions.appendChild(button('Details', { icon: 'a-user', onClick: function () { openMemberDetail(member.id); } }));
    actions.appendChild(button(member.is_admin ? 'Admin entziehen' : 'Zum Admin', {
      icon: 'a-shield',
      onClick: function () { toggleAdmin(member); }
    }));
    actions.appendChild(button(member.is_banned ? 'Entsperren' : 'Sperren', {
      icon: 'a-lock',
      className: member.is_banned ? 'admin-button--ghost' : 'admin-button--danger-ghost',
      onClick: function () { toggleBan(member); }
    }));
    row.appendChild(actions);
    return row;
  }

  async function openMemberDetail(memberId) {
    var loading = h('p', 'admin-muted', 'Profil wird geladen …');
    openDialog({ title: 'Mitglied', body: [loading] });
    try {
      var member = await rpc('admin_get_member', { p_user_id: memberId });
      renderMemberDetail(member);
    } catch (error) {
      openDialog({ title: 'Mitglied', body: [h('p', 'admin-flash', friendly(error))] });
    }
  }

  function renderMemberDetail(member) {
    var body = [];

    var head = h('div', 'admin-row');
    head.appendChild(avatarNode(member, 'admin-row__avatar'));
    var headBody = h('div', 'admin-row__body');
    var headTitle = h('div', 'admin-row__title');
    headTitle.appendChild(document.createTextNode(member.display_name || member.username));
    headTitle.appendChild(h('em', null, '@' + member.username));
    if (member.is_admin) headTitle.appendChild(tag('Admin', 'admin'));
    if (member.is_banned) headTitle.appendChild(tag('Gesperrt', 'ban'));
    if (member.email_confirmed_at) headTitle.appendChild(tag('E-Mail bestätigt', 'ok'));
    else headTitle.appendChild(tag('E-Mail offen', 'warn'));
    headBody.appendChild(headTitle);
    headBody.appendChild(h('div', 'admin-row__meta', member.email || 'keine E-Mail'));
    head.appendChild(headBody);
    body.push(head);

    var dl = h('dl', 'admin-dl');
    [
      ['Benutzername', '@' + member.username],
      ['Stadt', member.city || '–'],
      ['Pronomen', member.pronouns || '–'],
      ['Geburtstag', member.birth_date ? fmtDate(member.birth_date) : '–'],
      ['Genres', member.favorite_genres || '–'],
      ['Website', member.website || '–'],
      ['SoundCloud', member.soundcloud_url || '–'],
      ['Sichtbarkeit', member.profile_visibility === 'friends' ? 'Nur Freunde' : 'Mitglieder'],
      ['Registriert', fmtDate(member.created_at, true)],
      ['Letzte Anmeldung', member.last_sign_in_at ? fmtDate(member.last_sign_in_at, true) : '–'],
      ['Beiträge / Kommentare', member.post_count + ' / ' + member.comment_count],
      ['Likes / Nachrichten', member.like_count + ' / ' + member.message_count],
      ['Freunde', String(member.friend_count)],
      ['Medien-Dateien', String(member.media_count)],
      ['Meldungen gegen Konto', String(member.reports_against)],
      ['Sperre', member.is_banned ? ((member.ban_reason || 'ohne Grund') + (member.ban_until ? ' · bis ' + fmtDate(member.ban_until, true) : ' · unbefristet')) : 'nicht gesperrt'],
      ['ID', member.id]
    ].forEach(function (pair) {
      dl.appendChild(h('dt', null, pair[0]));
      dl.appendChild(h('dd', null, pair[1]));
    });
    if (member.bio) {
      dl.appendChild(h('dt', null, 'Bio'));
      dl.appendChild(h('dd', null, member.bio));
    }
    body.push(dl);

    var postsHead = h('h3', null, 'Letzte Beiträge');
    body.push(postsHead);
    if (!member.recent_posts.length) body.push(h('p', 'admin-muted', 'Keine Beiträge vorhanden.'));
    member.recent_posts.forEach(function (post) {
      var item = h('div', 'admin-message');
      item.appendChild(h('div', 'admin-message__meta', '#' + post.kind + ' · ' + post.visibility + ' · ' + fmtDate(post.created_at, true)));
      item.appendChild(h('p', null, truncated(post.body || '[Medien-Beitrag]', 220)));
      body.push(item);
    });

    var foot = [
      button('Bearbeiten', { icon: 'a-sliders', onClick: function () { editMember(member); } }),
      button('Beiträge ansehen', { icon: 'a-feed', onClick: function () {
        state.posts = { page: 0, query: '', kind: '', visibility: '', author: member.id };
        switchTab('posts');
      } }),
      button(member.is_admin ? 'Admin entziehen' : 'Zum Admin', { icon: 'a-shield', onClick: function () { closeDialog(); toggleAdmin(member); } }),
      button(member.is_banned ? 'Entsperren' : 'Sperren', {
        icon: 'a-lock',
        className: member.is_banned ? 'admin-button--ghost' : 'admin-button--danger-ghost',
        onClick: function () { closeDialog(); toggleBan(member); }
      }),
      button('Konto löschen', { className: 'admin-button--danger', onClick: function () { closeDialog(); deleteUser(member); } })
    ];
    openDialog({ title: member.display_name || member.username, body: body, foot: foot });
  }

  function editMember(member) {
    openFormDialog({
      title: 'Mitglied bearbeiten',
      message: 'Änderungen werden sofort gespeichert und protokolliert.',
      fields: [
        { name: 'display_name', label: 'Anzeigename', value: member.display_name, required: true, maxlength: 60 },
        { name: 'username', label: 'Benutzername (@)', value: member.username, required: true, maxlength: 24 },
        { name: 'city', label: 'Stadt', value: member.city || '' },
        { name: 'pronouns', label: 'Pronomen', value: member.pronouns || '' },
        { name: 'favorite_genres', label: 'Genres', value: member.favorite_genres || '' },
        { name: 'website', label: 'Website', value: member.website || '' },
        { name: 'soundcloud_url', label: 'SoundCloud', value: member.soundcloud_url || '' },
        { name: 'bio', label: 'Bio', type: 'textarea', value: member.bio || '', maxlength: 600 },
        {
          name: 'profile_visibility',
          label: 'Profil-Sichtbarkeit',
          type: 'select',
          value: member.profile_visibility,
          options: [
            { value: 'members', label: 'Für angemeldete Mitglieder' },
            { value: 'friends', label: 'Nur für Freunde' }
          ]
        }
      ],
      validate: function (values) {
        if (!/^[a-z0-9_]{3,24}$/.test(values.username.toLowerCase())) {
          return 'Benutzername: 3–24 Zeichen, nur a–z, 0–9 und Unterstrich.';
        }
        return null;
      },
      confirmLabel: 'Speichern'
    }).then(async function (values) {
      if (!values) return;
      try {
        await rpc('admin_update_member', {
          p_user_id: member.id,
          p_display_name: values.display_name,
          p_username: values.username.toLowerCase(),
          p_bio: values.bio,
          p_city: values.city,
          p_pronouns: values.pronouns,
          p_visibility: values.profile_visibility,
          p_favorite_genres: values.favorite_genres,
          p_website: values.website,
          p_soundcloud_url: values.soundcloud_url
        });
        toast('Mitglied aktualisiert.', 'success');
        loadMembers();
      } catch (error) {
        toast(friendly(error), 'error');
      }
    });
  }

  async function toggleAdmin(member) {
    var grant = !member.is_admin;
    var ok = await askConfirm({
      title: grant ? 'Adminrechte geben' : 'Adminrechte entziehen',
      message: grant
        ? (member.display_name || member.username) + ' erhält vollen Zugriff auf diesen Admin-Bereich.'
        : (member.display_name || member.username) + ' verliert den Zugriff auf den Admin-Bereich.',
      confirmLabel: grant ? 'Zum Admin machen' : 'Rechte entziehen',
      danger: !grant
    });
    if (!ok) return;
    try {
      await rpc('admin_set_admin', { p_user_id: member.id, p_is_admin: grant });
      toast(grant ? 'Adminrechte vergeben.' : 'Adminrechte entzogen.', 'success');
      loadMembers();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  async function toggleBan(member) {
    if (member.is_banned) {
      var lift = await askConfirm({
        title: 'Sperre aufheben',
        message: (member.display_name || member.username) + ' kann wieder schreiben, kommentieren und hochladen.',
        confirmLabel: 'Entsperren'
      });
      if (!lift) return;
      try {
        await rpc('admin_set_ban', { p_user_id: member.id, p_banned: false });
        toast('Sperre aufgehoben.', 'success');
        loadMembers();
        refreshStats();
      } catch (error) { toast(friendly(error), 'error'); }
      return;
    }

    var values = await openFormDialog({
      title: 'Mitglied sperren',
      message: 'Gesperrte Mitglieder bleiben sichtbar, können aber nichts mehr veröffentlichen oder hochladen.',
      fields: [
        { name: 'reason', label: 'Grund (intern)', placeholder: 'z. B. wiederholter Spam', required: true, maxlength: 300 },
        {
          name: 'duration',
          label: 'Dauer',
          type: 'select',
          value: '7',
          options: [
            { value: '1', label: '1 Tag' },
            { value: '7', label: '7 Tage' },
            { value: '30', label: '30 Tage' },
            { value: '90', label: '90 Tage' },
            { value: '0', label: 'Unbefristet' }
          ]
        }
      ],
      confirmLabel: 'Sperren',
      danger: true
    });
    if (!values) return;
    var until = null;
    if (values.duration !== '0') {
      until = new Date(Date.now() + Number(values.duration) * 24 * 60 * 60 * 1000).toISOString();
    }
    try {
      await rpc('admin_set_ban', { p_user_id: member.id, p_banned: true, p_reason: values.reason, p_until: until });
      toast('Mitglied gesperrt.', 'success');
      loadMembers();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  async function deleteUser(member) {
    var ok = await askConfirm({
      title: 'Konto endgültig löschen',
      message: 'Profil, Beiträge, Kommentare, Freundschaften, Nachrichten und Medien von ' + (member.display_name || member.username) + ' werden unwiderruflich gelöscht.',
      note: 'Diese Aktion kann nicht rückgängig gemacht werden. Sie wird im Protokoll festgehalten.',
      confirmLabel: 'Endgültig löschen',
      danger: true
    });
    if (!ok) return;
    try {
      await rpc('admin_delete_user', { p_user_id: member.id });
      toast('Konto gelöscht.', 'success');
      loadMembers();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  /* ---------------------------------------------------------- Administratoren */

  async function loadAdmins() {
    clearTabError('admins');
    var list = $('#admin-admins-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_admins');
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Administratoren eingetragen.'));
    data.rows.forEach(function (entry) {
      var row = h('div', 'admin-row');
      row.appendChild(avatarNode({ display_name: entry.display_name || entry.username, avatar_path: null }));
      var body = h('div', 'admin-row__body');
      var title = h('div', 'admin-row__title');
      title.appendChild(document.createTextNode(entry.display_name || entry.username || 'Admin'));
      title.appendChild(h('em', null, entry.username ? '@' + entry.username : ''));
      title.appendChild(tag('Admin', 'admin'));
      body.appendChild(title);
      body.appendChild(h('div', 'admin-row__meta', (entry.email || 'keine E-Mail') + ' · seit ' + fmtDate(entry.created_at)));
      row.appendChild(body);
      var actions = h('div', 'admin-row__actions');
      actions.appendChild(button('Mitglied öffnen', { icon: 'a-user', onClick: function () { openMemberDetail(entry.user_id); } }));
      if (entry.user_id !== (adminUser && adminUser.id)) {
        actions.appendChild(button('Rechte entziehen', {
          className: 'admin-button--danger-ghost',
          onClick: function () { toggleAdmin({ id: entry.user_id, username: entry.username, display_name: entry.display_name, is_admin: true }); }
        }));
      }
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- Beiträge */

  async function loadPosts(page) {
    clearTabError('posts');
    var filter = state.posts;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-posts-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_posts', {
      p_search: filter.query || null,
      p_kind: filter.kind || null,
      p_visibility: filter.visibility || null,
      p_author: filter.author || null,
      p_limit: PAGE_SIZE.posts,
      p_offset: filter.page * PAGE_SIZE.posts
    });
    var count = $('#admin-posts-count');
    if (count) count.textContent = data.total + ' Beiträge';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Beiträge gefunden.'));
    data.rows.forEach(function (post) { list.appendChild(postRow(post)); });
    renderPager('posts', data.total, filter.page, PAGE_SIZE.posts, function (next) { loadPosts(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  function postRow(post) {
    var row = h('div', 'admin-row admin-row--block');
    var top = h('div', 'admin-row__title');
    top.appendChild(avatarNode(post, 'admin-row__avatar'));
    top.appendChild(document.createTextNode(post.author_name || post.author_username));
    top.appendChild(h('em', null, '@' + post.author_username));
    top.appendChild(tag(post.kind, 'muted'));
    top.appendChild(tag(post.visibility === 'friends' ? 'nur Freunde' : 'Mitglieder', 'muted'));
    if (post.report_count) top.appendChild(tag(post.report_count + ' Meldung(en)', 'warn'));
    row.appendChild(top);

    if (post.body) row.appendChild(h('p', 'admin-row__text', truncated(post.body, 400)));

    if (post.media_path) {
      var mediaLine = h('div', 'admin-row__meta');
      mediaLine.appendChild(h('span', null, 'Anhang: ' + post.media_mime + ' · ' + post.media_path));
      row.appendChild(mediaLine);
      if (post.kind === 'image') {
        var thumb = h('div', 'admin-media__thumb');
        thumb.style.maxWidth = '220px';
        thumb.textContent = 'Bild wird geladen …';
        row.appendChild(thumb);
        signedUrl('member-media', post.media_path).then(function (url) {
          if (!url) { thumb.textContent = 'Vorschau nicht verfügbar'; return; }
          var img = h('img');
          img.src = url;
          img.alt = 'Anhang';
          img.loading = 'lazy';
          thumb.replaceChildren(img);
        });
      }
    }

    var meta = h('div', 'admin-row__meta');
    meta.appendChild(h('span', null, fmtDate(post.created_at, true)));
    meta.appendChild(h('span', null, '♥ ' + post.like_count));
    meta.appendChild(h('span', null, '💬 ' + post.comment_count));
    meta.appendChild(h('span', null, '↗ ' + post.share_count));
    row.appendChild(meta);

    var actions = h('div', 'admin-row__actions');
    actions.appendChild(button('Autor', { icon: 'a-user', onClick: function () { openMemberDetail(post.author_id); } }));
    actions.appendChild(button('Kommentare', { icon: 'a-comment', onClick: function () {
      state.comments = { page: 0, query: '', postId: post.id };
      switchTab('comments');
    } }));
    actions.appendChild(button('Löschen', {
      icon: 'a-trash-user',
      className: 'admin-button--danger-ghost',
      onClick: function () { deletePost(post); }
    }));
    row.appendChild(actions);
    return row;
  }

  async function deletePost(post) {
    var ok = await askConfirm({
      title: 'Beitrag löschen',
      message: 'Der Beitrag von @' + post.author_username + ' wird samt Anhang, Kommentaren, Likes und Shares gelöscht.',
      confirmLabel: 'Beitrag löschen',
      danger: true
    });
    if (!ok) return;
    try {
      var result = await rpc('admin_delete_post', { p_post_id: post.id });
      if (result.media_path) await client.storage.from(result.bucket || 'member-media').remove([result.media_path]);
      toast('Beitrag gelöscht.', 'success');
      loadPosts();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  /* -------------------------------------------------------------- Kommentare */

  async function loadComments(page) {
    clearTabError('comments');
    var filter = state.comments;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-comments-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_comments', {
      p_search: filter.query || null,
      p_post_id: filter.postId || null,
      p_limit: PAGE_SIZE.comments,
      p_offset: filter.page * PAGE_SIZE.comments
    });
    var count = $('#admin-comments-count');
    if (count) count.textContent = data.total + ' Kommentare';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Kommentare gefunden.'));
    data.rows.forEach(function (comment) {
      var row = h('div', 'admin-row');
      row.appendChild(avatarNode(comment));
      var body = h('div', 'admin-row__body');
      var title = h('div', 'admin-row__title');
      title.appendChild(document.createTextNode(comment.author_name || comment.author_username));
      title.appendChild(h('em', null, '@' + comment.author_username));
      body.appendChild(title);
      body.appendChild(h('p', 'admin-row__text', comment.body));
      var meta = h('div', 'admin-row__meta');
      meta.appendChild(h('span', null, fmtDate(comment.created_at, true)));
      if (comment.post_excerpt) meta.appendChild(h('span', null, 'zu: ' + truncated(comment.post_excerpt, 80)));
      body.appendChild(meta);
      row.appendChild(body);
      var actions = h('div', 'admin-row__actions');
      actions.appendChild(button('Autor', { icon: 'a-user', onClick: function () { openMemberDetail(comment.author_id); } }));
      actions.appendChild(button('Löschen', {
        icon: 'a-trash-user',
        className: 'admin-button--danger-ghost',
        onClick: function () { deleteComment(comment); }
      }));
      row.appendChild(actions);
      list.appendChild(row);
    });
    renderPager('comments', data.total, filter.page, PAGE_SIZE.comments, function (next) { loadComments(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  async function deleteComment(comment) {
    var ok = await askConfirm({
      title: 'Kommentar löschen',
      message: 'Der Kommentar von @' + comment.author_username + ' wird entfernt.',
      confirmLabel: 'Löschen',
      danger: true
    });
    if (!ok) return;
    try {
      await rpc('admin_delete_comment', { p_comment_id: comment.id });
      toast('Kommentar gelöscht.', 'success');
      loadComments();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  /* --------------------------------------------------------------- Meldungen */

  function reportCategory(category) {
    return ({
      spam: 'Spam', harassment: 'Belästigung', illegal: 'Rechtswidrig',
      copyright: 'Urheberrecht', other: 'Sonstiges'
    })[category] || category;
  }

  function reportStatusKind(status) {
    return ({ new: 'ban', reviewing: 'warn', resolved: 'ok', dismissed: 'muted' })[status] || 'muted';
  }

  async function loadReports(page) {
    clearTabError('reports');
    var filter = state.reports;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-reports-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_reports', {
      p_status: filter.status || null,
      p_limit: PAGE_SIZE.reports,
      p_offset: filter.page * PAGE_SIZE.reports
    });
    var count = $('#admin-reports-count');
    if (count) count.textContent = data.total + ' Meldungen';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Meldungen in dieser Ansicht.'));
    data.rows.forEach(function (report) { list.appendChild(reportRow(report)); });
    renderPager('reports', data.total, filter.page, PAGE_SIZE.reports, function (next) { loadReports(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  function reportRow(report) {
    var row = h('div', 'admin-row admin-row--block');
    var title = h('div', 'admin-row__title');
    title.appendChild(tag(reportCategory(report.category), 'warn'));
    title.appendChild(tag(report.status, reportStatusKind(report.status)));
    title.appendChild(document.createTextNode('gemeldet von @' + (report.reporter_username || 'unbekannt')));
    title.appendChild(h('em', null, fmtDate(report.created_at, true)));
    row.appendChild(title);

    if (report.details) row.appendChild(h('p', 'admin-row__text', report.details));

    if (report.target_post_id) {
      var post = h('div', 'admin-message');
      post.appendChild(h('div', 'admin-message__meta', 'gemeldeter Beitrag von @' + (report.target_username || '?') + ' · ' + fmtDate(report.post_created_at, true)));
      post.appendChild(h('p', null, report.post_excerpt || '[Medien-Beitrag]'));
      row.appendChild(post);
    } else {
      var profileLine = h('div', 'admin-row__meta');
      profileLine.appendChild(h('span', null, 'gemeldetes Profil: ' + (report.target_name || report.target_username || '–')));
      row.appendChild(profileLine);
    }

    if (report.admin_note) {
      var note = h('div', 'admin-row__meta');
      note.appendChild(h('span', null, 'Notiz: ' + report.admin_note));
      row.appendChild(note);
    }

    var actions = h('div', 'admin-row__actions');
    if (report.target_post_id) {
      actions.appendChild(button('Beitrag löschen', {
        icon: 'a-trash-user',
        className: 'admin-button--danger-ghost',
        onClick: async function () {
          var ok = await askConfirm({
            title: 'Gemeldeten Beitrag löschen',
            message: 'Der gemeldete Beitrag wird dauerhaft entfernt und die Meldung auf „erledigt“ gesetzt.',
            confirmLabel: 'Beitrag löschen',
            danger: true
          });
          if (!ok) return;
          try {
            var result = await rpc('admin_delete_post', { p_post_id: report.target_post_id });
            if (result.media_path) await client.storage.from(result.bucket || 'member-media').remove([result.media_path]);
            await rpc('admin_update_report', { p_report_id: report.id, p_status: 'resolved', p_note: 'Gemeldeter Beitrag gelöscht.' });
            toast('Beitrag gelöscht und Meldung erledigt.', 'success');
            loadReports();
            refreshStats();
          } catch (error) { toast(friendly(error), 'error'); }
        }
      }));
    }
    if (report.target_profile_id) {
      actions.appendChild(button('Profil öffnen', { icon: 'a-user', onClick: function () { openMemberDetail(report.target_profile_id); } }));
      actions.appendChild(button('Konto sperren', {
        icon: 'a-lock',
        className: 'admin-button--danger-ghost',
        onClick: function () { closeDialog(); toggleBan({ id: report.target_profile_id, username: report.target_username, display_name: report.target_name, is_banned: false }); }
      }));
    }
    actions.appendChild(button(report.status === 'reviewing' ? 'In Prüfung' : 'Prüfen', {
      icon: 'a-flag',
      disabled: report.status === 'reviewing',
      onClick: function () { setReportStatus(report, 'reviewing'); }
    }));
    actions.appendChild(button('Erledigt', { icon: 'a-check', onClick: function () { setReportStatus(report, 'resolved'); } }));
    actions.appendChild(button('Verwerfen', { onClick: function () { setReportStatus(report, 'dismissed'); } }));
    actions.appendChild(button('Löschen', {
      className: 'admin-button--danger-ghost',
      onClick: async function () {
        var ok = await askConfirm({ title: 'Meldung löschen', message: 'Der Eintrag wird aus der Moderationsliste entfernt.', confirmLabel: 'Löschen', danger: true });
        if (!ok) return;
        try {
          await rpc('admin_delete_report', { p_report_id: report.id });
          toast('Meldung gelöscht.', 'success');
          loadReports();
          refreshStats();
        } catch (error) { toast(friendly(error), 'error'); }
      }
    }));
    row.appendChild(actions);
    return row;
  }

  async function setReportStatus(report, status) {
    var values = await openFormDialog({
      title: 'Meldung bearbeiten',
      message: 'Neuer Status: ' + status,
      fields: [{ name: 'note', label: 'Interne Notiz (optional)', type: 'textarea', value: report.admin_note || '', maxlength: 500 }],
      confirmLabel: 'Speichern'
    });
    if (!values) return;
    try {
      await rpc('admin_update_report', { p_report_id: report.id, p_status: status, p_note: values.note });
      toast('Meldung aktualisiert.', 'success');
      loadReports();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  /* ----------------------------------------------------------- Löschanträge */

  async function loadDeletions(page) {
    clearTabError('deletions');
    var filter = state.deletions;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-deletions-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_deletion_requests', {
      p_limit: PAGE_SIZE.deletions,
      p_offset: filter.page * PAGE_SIZE.deletions
    });
    var count = $('#admin-deletions-count');
    if (count) count.textContent = data.total + ' Anträge';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Löschanträge vorhanden.'));
    data.rows.forEach(function (item) {
      var row = h('div', 'admin-row');
      row.appendChild(avatarNode(item));
      var body = h('div', 'admin-row__body');
      var title = h('div', 'admin-row__title');
      title.appendChild(document.createTextNode(item.display_name || item.username || 'Unbekannt'));
      title.appendChild(h('em', null, '@' + (item.username || '–')));
      title.appendChild(tag(item.status, item.status === 'completed' ? 'ok' : 'warn'));
      body.appendChild(title);
      var meta = h('div', 'admin-row__meta');
      meta.appendChild(h('span', null, item.email || 'keine E-Mail'));
      meta.appendChild(h('span', null, 'angefragt ' + fmtDate(item.created_at, true)));
      if (item.post_count) meta.appendChild(h('span', null, item.post_count + ' Beiträge'));
      if (item.processed_at) meta.appendChild(h('span', null, 'abgeschlossen ' + fmtDate(item.processed_at, true)));
      if (item.note) meta.appendChild(h('span', null, 'Notiz: ' + item.note));
      body.appendChild(meta);
      row.appendChild(body);
      var actions = h('div', 'admin-row__actions');
      actions.appendChild(button('Profil', { icon: 'a-user', onClick: function () { openMemberDetail(item.user_id); } }));
      actions.appendChild(button('In Bearbeitung', {
        disabled: item.status === 'processing',
        onClick: function () { updateDeletion(item, 'processing'); }
      }));
      actions.appendChild(button('Konto endgültig löschen', {
        className: 'admin-button--danger',
        onClick: function () { deleteUser({ id: item.user_id, username: item.username, display_name: item.display_name }); }
      }));
      row.appendChild(actions);
      list.appendChild(row);
    });
    renderPager('deletions', data.total, filter.page, PAGE_SIZE.deletions, function (next) { loadDeletions(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  async function updateDeletion(item, status) {
    var values = await openFormDialog({
      title: 'Löschantrag aktualisieren',
      message: 'Status: ' + status,
      fields: [{ name: 'note', label: 'Notiz (optional)', type: 'textarea', value: item.note || '', maxlength: 500 }],
      confirmLabel: 'Speichern'
    });
    if (!values) return;
    try {
      await rpc('admin_update_deletion_request', { p_user_id: item.user_id, p_status: status, p_note: values.note });
      toast('Löschantrag aktualisiert.', 'success');
      loadDeletions();
      refreshStats();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  /* ---------------------------------------------------------- Freundschaften */

  async function loadFriends(page) {
    clearTabError('friends');
    var filter = state.friends;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-friends-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_friendships', {
      p_status: filter.status || null,
      p_search: filter.query || null,
      p_limit: PAGE_SIZE.friends,
      p_offset: filter.page * PAGE_SIZE.friends
    });
    var count = $('#admin-friends-count');
    if (count) count.textContent = data.total + ' Beziehungen';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Freundschaften gefunden.'));
    data.rows.forEach(function (item) {
      var row = h('div', 'admin-row');
      var body = h('div', 'admin-row__body');
      var title = h('div', 'admin-row__title');
      title.appendChild(document.createTextNode(item.requester_name || item.requester_username));
      title.appendChild(h('em', null, '@' + item.requester_username));
      title.appendChild(document.createTextNode('→'));
      title.appendChild(document.createTextNode(item.addressee_name || item.addressee_username));
      title.appendChild(h('em', null, '@' + item.addressee_username));
      title.appendChild(tag(item.status, item.status === 'accepted' ? 'ok' : item.status === 'pending' ? 'warn' : 'muted'));
      body.appendChild(title);
      body.appendChild(h('div', 'admin-row__meta', fmtDate(item.created_at, true)));
      row.appendChild(body);
      var actions = h('div', 'admin-row__actions');
      actions.appendChild(button('Anfragender', { icon: 'a-user', onClick: function () { openMemberDetail(item.requester_id); } }));
      actions.appendChild(button('Empfänger', { icon: 'a-user', onClick: function () { openMemberDetail(item.addressee_id); } }));
      actions.appendChild(button('Beziehung löschen', {
        className: 'admin-button--danger-ghost',
        onClick: async function () {
          var ok = await askConfirm({
            title: 'Freundschaft löschen',
            message: 'Die Beziehung zwischen den beiden Konten wird entfernt. Beide können danach nicht mehr direkt schreiben.',
            confirmLabel: 'Entfernen',
            danger: true
          });
          if (!ok) return;
          try {
            await rpc('admin_delete_friendship', { p_request_id: item.id });
            toast('Freundschaft entfernt.', 'success');
            loadFriends();
          } catch (error) { toast(friendly(error), 'error'); }
        }
      }));
      row.appendChild(actions);
      list.appendChild(row);
    });
    renderPager('friends', data.total, filter.page, PAGE_SIZE.friends, function (next) { loadFriends(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  /* ------------------------------------------------------------- Nachrichten */

  async function loadConversations(page) {
    clearTabError('messages');
    var filter = state.messages;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-conversations-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_conversations', {
      p_search: filter.query || null,
      p_limit: PAGE_SIZE.messages,
      p_offset: filter.page * PAGE_SIZE.messages
    });
    var count = $('#admin-messages-count');
    if (count) count.textContent = data.total + ' Unterhaltungen';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Unterhaltungen gefunden.'));
    data.rows.forEach(function (item) {
      var row = h('div', 'admin-row');
      var body = h('div', 'admin-row__body');
      var title = h('div', 'admin-row__title');
      title.appendChild(document.createTextNode(item.one_name || item.one_username));
      title.appendChild(document.createTextNode('↔'));
      title.appendChild(document.createTextNode(item.two_name || item.two_username));
      body.appendChild(title);
      var meta = h('div', 'admin-row__meta');
      meta.appendChild(h('span', null, item.message_count + ' Nachrichten'));
      if (item.last_at) meta.appendChild(h('span', null, 'zuletzt ' + fmtDate(item.last_at, true)));
      body.appendChild(meta);
      if (item.last_body) body.appendChild(h('p', 'admin-row__text', truncated(item.last_body, 90)));
      row.appendChild(body);
      var actions = h('div', 'admin-row__actions');
      actions.appendChild(button('Ansehen', { icon: 'a-message', onClick: function () { openConversation(item); } }));
      row.appendChild(actions);
      list.appendChild(row);
    });
    renderPager('messages', data.total, filter.page, PAGE_SIZE.messages, function (next) { loadConversations(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  async function openConversation(item) {
    state.messages.openId = item.id;
    var view = $('#admin-conversation-view');
    view.replaceChildren(h('h3', null, 'Unterhaltung'), emptyRow('Wird geladen …'));
    try {
      var data = await rpc('admin_read_conversation', { p_conversation_id: item.id, p_limit: 200 });
      view.replaceChildren();
      view.appendChild(h('h3', null, (item.one_name || item.one_username) + ' ↔ ' + (item.two_name || item.two_username)));
      view.appendChild(h('p', 'admin-muted', data.rows.length + ' Nachrichten · Zugriff wurde protokolliert'));

      var listNode = h('div', 'admin-message-list');
      if (!data.rows.length) listNode.appendChild(emptyRow('Keine Nachrichten.'));
      data.rows.forEach(function (message) {
        var bubble = h('div', 'admin-message' + (message.sender_id === (adminUser && adminUser.id) ? ' admin-message--own' : ''));
        var meta = h('div', 'admin-message__meta');
        meta.appendChild(h('span', null, '@' + (message.sender_username || 'unbekannt')));
        meta.appendChild(h('span', null, fmtDate(message.created_at, true)));
        bubble.appendChild(meta);
        bubble.appendChild(h('p', null, message.body));
        var remove = button('Nachricht löschen', {
          className: 'admin-button--danger-ghost admin-button--tiny',
          onClick: async function () {
            var ok = await askConfirm({ title: 'Nachricht löschen', message: 'Die Nachricht wird für beide Seiten entfernt.', confirmLabel: 'Löschen', danger: true });
            if (!ok) return;
            try {
              await rpc('admin_delete_message', { p_message_id: message.id });
              toast('Nachricht gelöscht.', 'success');
              openConversation(item);
            } catch (error) { toast(friendly(error), 'error'); }
          }
        });
        bubble.appendChild(remove);
        listNode.appendChild(bubble);
      });
      view.appendChild(listNode);
      view.appendChild(button('Unterhaltung löschen', {
        className: 'admin-button--danger',
        onClick: async function () {
          var ok = await askConfirm({
            title: 'Unterhaltung löschen',
            message: 'Alle Nachrichten dieser Unterhaltung werden dauerhaft entfernt.',
            confirmLabel: 'Unterhaltung löschen',
            danger: true
          });
          if (!ok) return;
          try {
            await rpc('admin_delete_conversation', { p_conversation_id: item.id });
            toast('Unterhaltung gelöscht.', 'success');
            view.replaceChildren(h('h3', null, 'Unterhaltung'), h('p', 'admin-muted', 'Wähle links eine Unterhaltung aus.'));
            loadConversations();
            refreshStats();
          } catch (error) { toast(friendly(error), 'error'); }
        }
      }));
    } catch (error) {
      view.replaceChildren(h('h3', null, 'Unterhaltung'), h('p', 'admin-flash', friendly(error)));
    }
  }

  /* ------------------------------------------------------------------ Medien */

  async function loadMedia(page) {
    clearTabError('media');
    var filter = state.media;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-media-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_media', {
      p_bucket: filter.bucket,
      p_search: filter.query || null,
      p_limit: PAGE_SIZE.media,
      p_offset: filter.page * PAGE_SIZE.media
    });
    var count = $('#admin-media-count');
    if (count) count.textContent = data.total + ' Dateien';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Keine Dateien gefunden.'));
    data.rows.forEach(function (file) {
      var card = h('div', 'admin-media');
      var thumb = h('div', 'admin-media__thumb', file.mime && file.mime.indexOf('image/') === 0 ? 'Lädt …' : (file.mime || 'Datei'));
      card.appendChild(thumb);
      if (file.mime && file.mime.indexOf('image/') === 0) {
        signedUrl(file.bucket_id, file.name).then(function (url) {
          if (!url) { thumb.textContent = 'Keine Vorschau'; return; }
          var img = h('img');
          img.src = url;
          img.alt = '';
          img.loading = 'lazy';
          thumb.replaceChildren(img);
        });
      }
      card.appendChild(h('div', 'admin-media__name', file.name));
      var meta = h('div', 'admin-media__meta');
      meta.appendChild(h('span', null, fmtBytes(file.size_bytes)));
      meta.appendChild(h('span', null, file.owner_username ? '@' + file.owner_username : 'unbekannt'));
      card.appendChild(meta);
      var actions = h('div', 'admin-row__actions');
      actions.appendChild(button('Öffnen', {
        onClick: async function () {
          var url = await signedUrl(file.bucket_id, file.name, 600);
          if (!url) { toast('Datei konnte nicht geöffnet werden.', 'error'); return; }
          window.open(url, '_blank', 'noopener');
        }
      }));
      actions.appendChild(button('Löschen', {
        className: 'admin-button--danger-ghost',
        onClick: async function () {
          var ok = await askConfirm({
            title: 'Datei löschen',
            message: 'Die Datei wird endgültig aus dem Speicher entfernt. Beiträge, die sie verwenden, zeigen danach kein Medium mehr.',
            confirmLabel: 'Löschen',
            danger: true
          });
          if (!ok) return;
          try {
            var result = await client.storage.from(file.bucket_id).remove([file.name]);
            if (result.error) throw new Error(friendly(result.error));
            toast('Datei gelöscht.', 'success');
            loadMedia();
            refreshStats();
          } catch (error) { toast(friendly(error), 'error'); }
        }
      }));
      card.appendChild(actions);
      list.appendChild(card);
    });
    renderPager('media', data.total, filter.page, PAGE_SIZE.media, function (next) { loadMedia(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  /* ------------------------------------------------------------ Einstellungen */

  async function loadSettings() {
    clearTabError('settings');
    var data = await rpc('admin_get_settings');
    settingsValues = data.values || {};
    var form = $('#admin-settings-form');
    $$('[data-setting]', form).forEach(function (input) {
      var key = input.dataset.setting;
      var value = settingsValues[key];
      if (input.type === 'checkbox') input.checked = value === true;
      else input.value = value == null ? '' : String(value);
    });
  }

  function settingValue(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'number') return Number(input.value) || 0;
    return input.value;
  }

  async function saveSettings(event) {
    event.preventDefault();
    var form = $('#admin-settings-form');
    var status = $('#admin-settings-status');
    var submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus(status, 'Wird gespeichert …');
    try {
      var changed = 0;
      var inputs = $$('[data-setting]', form);
      for (var i = 0; i < inputs.length; i += 1) {
        var input = inputs[i];
        var key = input.dataset.setting;
        var next = settingValue(input);
        var before = settingsValues[key];
        var same = input.type === 'checkbox' ? before === next : String(before == null ? '' : before) === String(next);
        if (same) continue;
        await rpc('admin_set_setting', { p_key: key, p_value: next });
        settingsValues[key] = next;
        changed += 1;
      }
      setStatus(status, changed ? changed + ' Einstellung(en) gespeichert.' : 'Keine Änderungen.', 'success');
      toast(changed ? 'Einstellungen gespeichert.' : 'Keine Änderungen.', 'success');
    } catch (error) {
      setStatus(status, friendly(error), 'error');
      toast(friendly(error), 'error');
    }
    submit.disabled = false;
  }

  async function quickSetting(key, value, message) {
    try {
      await rpc('admin_set_setting', { p_key: key, p_value: value });
      toast(message, 'success');
      loadSettings();
    } catch (error) { toast(friendly(error), 'error'); }
  }

  /* ---------------------------------------------------------------- Protokoll */

  function actionLabel(action) {
    var labels = {
      'member.update': 'Mitglied bearbeitet',
      'member.ban': 'Mitglied gesperrt',
      'member.unban': 'Sperre aufgehoben',
      'member.delete': 'Konto gelöscht',
      'admin.grant': 'Adminrechte vergeben',
      'admin.revoke': 'Adminrechte entzogen',
      'post.delete': 'Beitrag gelöscht',
      'comment.delete': 'Kommentar gelöscht',
      'report.update': 'Meldung bearbeitet',
      'report.delete': 'Meldung gelöscht',
      'deletion.update': 'Löschantrag bearbeitet',
      'friendship.delete': 'Freundschaft gelöscht',
      'conversation.read': 'Unterhaltung gelesen',
      'conversation.delete': 'Unterhaltung gelöscht',
      'message.delete': 'Nachricht gelöscht',
      'media.delete': 'Datei gelöscht',
      'setting.update': 'Einstellung geändert'
    };
    return labels[action] || action;
  }

  async function loadAudit(page) {
    clearTabError('audit');
    var filter = state.audit;
    if (typeof page === 'number') filter.page = page;
    var list = $('#admin-audit-list');
    list.replaceChildren(emptyRow('Wird geladen …'));
    var data = await rpc('admin_list_audit', { p_limit: PAGE_SIZE.audit, p_offset: filter.page * PAGE_SIZE.audit });
    var count = $('#admin-audit-count');
    if (count) count.textContent = data.total + ' Einträge';
    list.replaceChildren();
    if (!data.rows.length) list.appendChild(emptyRow('Noch keine Aktionen protokolliert.'));
    data.rows.forEach(function (entry) {
      var row = h('div', 'admin-row');
      var body = h('div', 'admin-row__body');
      var title = h('div', 'admin-row__title');
      title.appendChild(tag(actionLabel(entry.action), 'muted'));
      title.appendChild(h('em', null, entry.admin_email || 'Admin'));
      title.appendChild(h('em', null, fmtDate(entry.created_at, true)));
      body.appendChild(title);
      var details = entry.details && Object.keys(entry.details).length ? JSON.stringify(entry.details) : '';
      var meta = h('div', 'admin-row__meta');
      if (entry.target) meta.appendChild(h('span', null, 'Ziel: ' + entry.target));
      if (details) meta.appendChild(h('span', null, details));
      body.appendChild(meta);
      row.appendChild(body);
      list.appendChild(row);
    });
    renderPager('audit', data.total, filter.page, PAGE_SIZE.audit, function (next) { loadAudit(next).catch(function (error) { toast(friendly(error), 'error'); }); });
  }

  /* ---------------------------------------------------------------- Events */

  function bindEvents() {
    $$('[data-admin-tab]').forEach(function (node) {
      node.addEventListener('click', function () { switchTab(node.dataset.adminTab); });
    });
    $$('[data-admin-jump]').forEach(function (node) {
      node.addEventListener('click', function () { switchTab(node.dataset.adminJump); });
    });

    $('#admin-refresh').addEventListener('click', function () {
      loadTab(state.tab);
      refreshStats();
      toast('Aktualisiert.', 'success');
    });

    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!client) { flash('Der Admin-Bereich ist noch nicht mit Supabase verbunden.', 'error'); return; }
      if (!loginForm.reportValidity()) return;
      var submit = $('#admin-login-submit');
      submit.disabled = true;
      flash('Anmeldung läuft …');
      var email = $('#admin-login-email').value.trim();
      var password = $('#admin-login-password').value;
      try {
        var result = await client.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        $('#admin-login-password').value = '';
        flash('Angemeldet. Zugriff wird geprüft …', 'success');
      } catch (error) {
        flash(friendly(error), 'error');
      }
      submit.disabled = false;
    });

    $('#admin-login-show').addEventListener('change', function () {
      $('#admin-login-password').type = this.checked ? 'text' : 'password';
    });

    $('#admin-forgot-password').addEventListener('click', async function () {
      var email = $('#admin-login-email').value.trim();
      if (!email) { flash('Trage zuerst deine E-Mail-Adresse ein.', 'error'); $('#admin-login-email').focus(); return; }
      try {
        var result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: new URL('admin.html', document.baseURI).href
        });
        if (result.error) throw result.error;
        flash('Wenn ein Konto zu dieser Adresse existiert, ist eine E-Mail mit dem Link unterwegs.', 'success');
      } catch (error) { flash(friendly(error), 'error'); }
    });

    $('#admin-sign-out').addEventListener('click', async function () {
      if (!client) return;
      try { await client.auth.signOut(); } catch (error) { /* ignore */ }
      state.tab = 'dashboard';
      showGate('Du wurdest abgemeldet.', 'success');
    });

    $('#admin-dialog-close').addEventListener('click', closeDialog);

    /* Mitglieder */
    $('#admin-members-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.members.query = $('#admin-members-query').value.trim();
      state.members.page = 0;
      loadMembers().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-members-sort').addEventListener('change', function () {
      state.members.sort = this.value;
      state.members.page = 0;
      loadMembers().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-members-apply').addEventListener('click', function () {
      state.members.query = $('#admin-members-query').value.trim();
      state.members.page = 0;
      loadMembers().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Beiträge */
    $('#admin-posts-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.posts.query = $('#admin-posts-query').value.trim();
      state.posts.page = 0;
      loadPosts().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-posts-kind').addEventListener('change', function () {
      state.posts.kind = this.value;
      state.posts.page = 0;
      loadPosts().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-posts-visibility').addEventListener('change', function () {
      state.posts.visibility = this.value;
      state.posts.page = 0;
      loadPosts().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-posts-apply').addEventListener('click', function () {
      state.posts.query = $('#admin-posts-query').value.trim();
      state.posts.page = 0;
      loadPosts().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Kommentare */
    $('#admin-comments-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.comments.query = $('#admin-comments-query').value.trim();
      state.comments.postId = null;
      state.comments.page = 0;
      loadComments().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-comments-apply').addEventListener('click', function () {
      state.comments.query = $('#admin-comments-query').value.trim();
      state.comments.page = 0;
      loadComments().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Meldungen */
    $('#admin-reports-status').addEventListener('change', function () {
      state.reports.status = this.value;
      state.reports.page = 0;
      loadReports().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Freundschaften */
    $('#admin-friends-status').addEventListener('change', function () {
      state.friends.status = this.value;
      state.friends.page = 0;
      loadFriends().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-friends-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.friends.query = $('#admin-friends-query').value.trim();
      state.friends.page = 0;
      loadFriends().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-friends-apply').addEventListener('click', function () {
      state.friends.query = $('#admin-friends-query').value.trim();
      state.friends.page = 0;
      loadFriends().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Nachrichten */
    $('#admin-messages-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.messages.query = $('#admin-messages-query').value.trim();
      state.messages.page = 0;
      loadConversations().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Medien */
    $('#admin-media-bucket').addEventListener('change', function () {
      state.media.bucket = this.value;
      state.media.page = 0;
      loadMedia().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-media-search').addEventListener('submit', function (event) {
      event.preventDefault();
      state.media.query = $('#admin-media-query').value.trim();
      state.media.page = 0;
      loadMedia().catch(function (error) { toast(friendly(error), 'error'); });
    });
    $('#admin-media-apply').addEventListener('click', function () {
      state.media.query = $('#admin-media-query').value.trim();
      state.media.page = 0;
      loadMedia().catch(function (error) { toast(friendly(error), 'error'); });
    });

    /* Einstellungen */
    $('#admin-settings-form').addEventListener('submit', saveSettings);
    $('#admin-clear-announcement').addEventListener('click', function () {
      quickSetting('announcement_active', false, 'Hinweis entfernt.');
    });
    $('#admin-disable-maintenance').addEventListener('click', function () {
      quickSetting('maintenance_mode', false, 'Wartungsmodus beendet.');
    });
  }

  bindEvents();
  if (window.location.hash === '#club') window.location.hash = '';
  (function announceCallbackProblem() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (error) { return; }
    if (params.has('error') || params.has('error_description')) {
      flash(oauthErrorMessage(params), 'error');
      cleanAuthParams();
    } else if (params.has('code')) {
      flash('Anmeldung wird abgeschlossen …');
    }
  })();
  boot();
})();
