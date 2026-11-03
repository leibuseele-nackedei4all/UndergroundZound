/*
 * Diagnose des Google-/Facebook-Rücksprungs (OAuth-Callback) mit jsdom.
 * Simuliert: Supabase schickt den Besucher auf `/?code=...` bzw. auf
 * `/?code=...#club` zurück. Geprüft wird, ob der Code getauscht, die Ansicht
 * geöffnet und die URL bereinigt wird, und ob der Google-Start die richtige
 * PKCE-URL erzeugt.
 *   npm install jsdom --no-save
 *   node tools/oauth-redirect-test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const uuid = '11111111-2222-3333-4444-555555555555';
const now = new Date().toISOString();

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const accessToken = jwt({ sub: uuid, role: 'authenticated', email: 'leibuseele@gmail.com', exp: Math.floor(Date.now() / 1000) + 3600 });
const session = {
  access_token: accessToken, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh',
  user: { id: uuid, aud: 'authenticated', role: 'authenticated', email: 'leibuseele@gmail.com', created_at: now, user_metadata: {}, app_metadata: {} }
};

function makeBackend(log) {
  return function mockFetch(url, options = {}) {
    const target = String(url);
    log.push(`${(options.method || 'GET').toUpperCase()} ${target}`);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (target.includes('/auth/v1/token?grant_type=pkce')) return json(session);
    if (target.includes('/auth/v1/token')) return json(session);
    if (target.includes('/auth/v1/user')) return json(session.user);
    if (target.includes('/rpc/get_public_settings')) return json({ registration_enabled: true, member_area_open: true });
    if (target.includes('/rpc/is_admin')) return json(true);
    if (target.includes('/rpc/is_member_banned')) return json(false);
    if (target.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify([{ id: uuid, username: 'zzinuzz', display_name: 'zZinuZz', avatar_path: null, bio: '', city: '', pronouns: '', birth_date: null, favorite_genres: '', website: '', soundcloud_url: '', profile_visibility: 'members', created_at: now }]), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' }
      });
    }
    if (target.includes('/rest/v1/')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    return json(null);
  };
}

// Schlüssel wie in supabase-js: sb-<projectRef>-auth-token[-code-verifier]
const STORAGE_KEY = 'sb-demo-auth-token';
// supabase-js speichert Werte JSON-kodiert
const verifierStorage = { [STORAGE_KEY + '-code-verifier']: JSON.stringify('test-code-verifier-1234567890') };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = 0;
function check(label, condition, detail) {
  if (!condition) problems += 1;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail && !condition ? ' → ' + detail : ''}`);
}

async function openPage(url, storage, page = 'index.html') {
  const log = [];
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = makeBackend(log);
      window.Response = Response;
      window.Headers = Headers;
      window.Request = Request;
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.__assign = [];
      if (storage) {
        Object.keys(storage).forEach((k) => window.localStorage.setItem(k, storage[k]));
      }
    }
  });
  const { window } = dom;
  window.MEMBER_CONFIG = Object.freeze({ supabaseUrl: 'https://demo.supabase.co', supabasePublicKey: 'sb_publishable_demo_1234567890123' });
  window.eval(fs.readFileSync(path.join(root, 'assets/js/vendor/supabase.min.js'), 'utf8'));
  window.__oauthCalls = [];
  window.__origCreateClient = window.supabase.createClient;
  window.supabase.createClient = function (...args) {
    const instance = window.__origCreateClient.apply(this, args);
    window.__client = instance;
    const realSignIn = instance.auth.signInWithOAuth.bind(instance.auth);
    instance.auth.signInWithOAuth = (options) => {
      window.__oauthCalls.push(options || {});
      return Promise.resolve({ data: { provider: options.provider, url: 'stub://authorize' }, error: null });
    };
    return instance;
  };
  if (page === 'index.html') {
    window.eval(fs.readFileSync(path.join(root, 'assets/js/main.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(root, 'assets/js/community.js'), 'utf8'));
  } else {
    window.eval(fs.readFileSync(path.join(root, 'assets/js/admin.js'), 'utf8'));
  }
  // echte Navigation abfangen (jsdom navigiert sonst nicht) – nach dem Setup,
  // damit window.location beim Laden unverändert bleibt.
  await wait(1400);
  return { window, doc: window.document, log, errors };
}

function activeView(doc) {
  const view = doc.querySelector('.view.is-active');
  return view ? view.id : '(keine)';
}

(async () => {
  // ---------- 1) Rücksprung OHNE #club (Supabase-Standard) ----------
  {
    const { window, doc, log, errors } = await openPage('https://site.test/UndergroundZound/?code=pkce-code-123', verifierStorage);
    const exchanged = log.some((c) => c.includes('/auth/v1/token') && c.includes('grant_type=pkce'));
    check('Code wird gegen eine Sitzung getauscht', exchanged, log.join(' | '));
    check('Mitgliederbereich wird geöffnet (Dashboard sichtbar)', doc.querySelector('#member-dashboard').hidden === false,
      'aktive Ansicht: ' + activeView(doc) + ' | authPanel verborgen: ' + doc.querySelector('#member-auth-panel').hidden + ' | log: ' + log.join(' | '));
    check('Erfolgsmeldung für den Rücksprung', /Anmeldung über Google|Willkommen/i.test(doc.querySelector('#member-global-status').textContent),
      doc.querySelector('#member-global-status').textContent);
    check('Code-Parameter wird aus der URL entfernt', !window.location.href.includes('code='), window.location.href);
    check('Besucher bleibt auf der Mitglieder-Seite', activeView(doc) === 'club', activeView(doc));
    check('Keine JS-Fehler', errors.length === 0, errors.join(' | '));
  }

  // ---------- 2) Rücksprung MIT #club ----------
  {
    const { window, doc, log } = await openPage('https://site.test/UndergroundZound/?code=pkce-code-999#club', verifierStorage);
    check('Mit #club: Code wird getauscht', log.some((c) => c.includes('/auth/v1/token') && c.includes('grant_type=pkce')), log.join(' | '));
    check('Mit #club: Sitzung wird geladen', doc.querySelector('#member-dashboard').hidden === false || !doc.querySelector('#member-auth-panel').hidden);
    check('Mit #club: Code entfernt', !window.location.href.includes('code='), window.location.href);
    check('Mit #club: Ansicht bleibt club', activeView(doc) === 'club', activeView(doc));
    check('Mit #club: Fragment bleibt erhalten', window.location.hash === '#club', window.location.hash);
  }

  // ---------- 3) Fehler-/Abbruch-Rücksprung von Google ----------
  {
    const { window, doc } = await openPage('https://site.test/UndergroundZound/?error=access_denied&error_description=The+user+denied+the+request#club');
    check('Abgelehnter Google-Login zeigt eine verständliche Meldung',
      /abgebrochen|verweigert|Google|Anmeldung/i.test(doc.querySelector('#member-global-status').textContent),
      doc.querySelector('#member-global-status').textContent);
    check('Fehler-Parameter werden aus der URL entfernt', !window.location.href.includes('error='), window.location.href);
  }

  // ---------- 4) Google-Start: wohin wird geleitet? ----------
  {
    const { window, doc } = await openPage('https://site.test/UndergroundZound/#club');
    const google = doc.querySelector('[data-oauth-provider="google"]');
    const consent = doc.querySelector('#member-social-consent');

    google.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(200);
    check('Ohne Zustimmung startet keine Weiterleitung', window.__oauthCalls.length === 0);
    check('Ohne Zustimmung erscheint ein Hinweis', /Regeln|Einwilligung|bestätige/i.test(doc.querySelector('#member-global-status').textContent),
      doc.querySelector('#member-global-status').textContent);

    consent.checked = true;
    google.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(400);
    const call = window.__oauthCalls[0];
    check('Google-Klick startet die Anmeldung', !!call);
    check('Anbieter ist google', !!call && call.provider === 'google', call && call.provider);
    check('redirect_to ist die aktuelle Seite', !!call && call.options.redirectTo === 'https://site.test/UndergroundZound/#club',
      call && call.options.redirectTo);
    check('Während der Weiterleitung erscheint ein Status', /Weiterleitung zu Google/i.test(doc.querySelector('#member-global-status').textContent),
      doc.querySelector('#member-global-status').textContent);

    // Echte URL-Bildung der Bibliothek prüfen (ohne Navigation)
    const probe = window.__origCreateClient('https://demo.supabase.co', 'sb_publishable_demo_1234567890123', {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    const built = await probe.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://site.test/UndergroundZound/#club', skipBrowserRedirect: true }
    });
    const url = built.data.url || '';
    check('Weiterleitung geht an Supabase /auth/v1/authorize mit provider=google',
      /^https:\/\/demo\.supabase\.co\/auth\/v1\/authorize\?provider=google/.test(url), url);
    // jsdom besitzt kein crypto.subtle, deshalb fällt das SDK dort auf `plain` zurück.
    // In echten Browsern (https/localhost) ist es S256 – beides wird akzeptiert.
    const method = (url.match(/code_challenge_method=(\w+)/i) || [])[1];
    check('PKCE-Challenge wird mitgeschickt', /code_challenge=[^&]+/.test(url) && /^(S256|plain)$/i.test(method || ''), url);
    console.log('  (Challenge-Methode in dieser Testumgebung: ' + method + ')');
    check('redirect_to zeigt auf die eigene Website', new URL(url).searchParams.get('redirect_to') === 'https://site.test/UndergroundZound/#club',
      new URL(url).searchParams.get('redirect_to'));
    check('Code-Verifier liegt danach im Speicher', Object.keys(window.localStorage).some((k) => k.includes('code-verifier')),
      Object.keys(window.localStorage).join(', '));
  }

  // ---------- 5) Abgelaufener/fehlender Verifier (anderer Browser, alter Link) ----------
  {
    const { doc, log } = await openPage('https://site.test/UndergroundZound/?code=stale#club');
    const text = doc.querySelector('#member-global-status').textContent;
    check('Fehlender Verifier wird erklärt (kein stiller Fehlschlag)', /anderem Browser|abgelaufen|erneut/i.test(text), text || '(leer)');
    check('Kein sinnloser Token-Aufruf ohne Verifier', !log.some((c) => c.includes('grant_type=pkce')), log.join(' | '));
  }

  // ---------- 6) Passwort-Reset-Rücksprung auf admin.html ----------
  {
    const { window, doc, log } = await openPage('https://site.test/admin.html?code=reset-code', {
      [STORAGE_KEY + '-code-verifier']: JSON.stringify('verifier-1234567890/recovery')
    }, 'admin.html');
    check('Reset-Link: Code wird getauscht', log.some((c) => c.includes('/auth/v1/token') && c.includes('grant_type=pkce')), log.join(' | '));
    check('Reset-Link: Dialog „Neues Passwort“ erscheint', doc.querySelector('#admin-dialog').hasAttribute('open') &&
      /Neues Passwort/i.test(doc.querySelector('#admin-dialog-title').textContent), doc.querySelector('#admin-dialog-title').textContent);
    check('Reset-Link: zwei Passwortfelder vorhanden', doc.querySelectorAll('#admin-dialog-body input[type=password]').length === 2);
    check('Reset-Link: URL wird bereinigt', !window.location.href.includes('code='), window.location.href);
  }

  console.log(`\n${problems} Problem(e)`);
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
