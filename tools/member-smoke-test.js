/*
 * Lokaler Smoke-Test des Mitgliederbereichs (index.html) mit jsdom und
 * gefälschtem Supabase-Backend. Prüft die vom Admin-Bereich gesteuerten
 * Zustände: Hinweis-Banner, Wartung, Registrierung, Sperre, Admin-Link.
 *   npm install jsdom --no-save
 *   node tools/member-smoke-test.js
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
const token = jwt({ sub: uuid, role: 'authenticated', email: 'leibuseele@gmail.com', exp: Math.floor(Date.now() / 1000) + 3600 });

const settings = {
  registration_enabled: true, member_area_open: true, chat_enabled: true,
  friends_enabled: true, uploads_enabled: true, max_upload_mb: 50,
  announcement_active: true, announcement_title: 'Session am Samstag',
  announcement_text: '20 Uhr im Studio', announcement_kind: 'info',
  maintenance_mode: false, maintenance_message: '', support_email: 'leibuseele@gmail.com',
  community_rules_url: '#club-rules'
};

const state = { isAdmin: true, banned: false, settings };
const calls = [];

function mockFetch(url, options = {}) {
  const target = String(url);
  calls.push(`${(options.method || 'GET').toUpperCase()} ${target}`);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (target.includes('/auth/v1/token')) {
    return json({
      access_token: token, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
      user: { id: uuid, aud: 'authenticated', role: 'authenticated', email: 'leibuseele@gmail.com', created_at: now, user_metadata: {}, app_metadata: {} }
    });
  }
  if (target.includes('/auth/v1/user')) return json({ id: uuid, email: 'leibuseele@gmail.com', aud: 'authenticated', role: 'authenticated', created_at: now, user_metadata: {}, app_metadata: {} });
  if (target.includes('/rpc/get_public_settings')) return json(state.settings);
  if (target.includes('/rpc/is_admin')) return json(state.isAdmin);
  if (target.includes('/rpc/is_member_banned')) return json(state.banned);
  if (target.includes('/rest/v1/profiles')) {
    return new Response(JSON.stringify([{ id: uuid, username: 'zzinuzz', display_name: 'zZinuZz', avatar_path: null, bio: '', city: '', pronouns: '', birth_date: null, favorite_genres: '', website: '', soundcloud_url: '', profile_visibility: 'members', created_at: now }]), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' }
    });
  }
  if (target.includes('/rest/v1/posts')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (target.includes('/rest/v1/')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return json(null);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = 0;
function check(label, condition) {
  if (!condition) problems += 1;
  console.log(`${condition ? '✓' : '✗'} ${label}`);
}

async function boot() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/index.html#club',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) { window.fetch = mockFetch; window.Response = Response; window.Headers = Headers; window.Request = Request; }
  });
  const { window } = dom;
  window.MEMBER_CONFIG = Object.freeze({ supabaseUrl: 'https://demo.supabase.co/rest/v1/', supabasePublicKey: 'sb_publishable_demo_1234567890123' });
  window.eval(fs.readFileSync(path.join(root, 'assets/js/vendor/supabase.min.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'assets/js/community.js'), 'utf8'));
  const doc = window.document;

  await wait(300);
  doc.querySelector('#member-login-email').value = 'leibuseele@gmail.com';
  doc.querySelector('#member-login-password').value = 'geheim1234';
  doc.querySelector('#member-login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  return { doc, window };
}

(async () => {
  let { doc, window } = await boot();
  check('Mitgliederbereich meldet an', doc.querySelector('#member-dashboard').hidden === false);
  check('Admin-Link ist für Admins sichtbar', doc.querySelector('#member-admin-link').hidden === false);
  check('Admin-Link zeigt auf admin.html', doc.querySelector('#member-admin-link').getAttribute('href') === 'admin.html');
  check('Hinweis-Banner aus den Admin-Einstellungen erscheint', /Session am Samstag/.test(doc.querySelector('#member-announcement').textContent));
  check('Kein Sperr-Hinweis bei aktivem Konto', !doc.querySelector('#member-banned'));
  check('Chat-Tab sichtbar', doc.querySelector('[data-member-tab="messages"]').hidden === false);
  check('Footer verlinkt den Admin-Bereich', !!doc.querySelector('.site-footer a[href="admin.html"]'));

  // Zweiter Durchlauf: gesperrt, Registrierung aus, Chat aus, Nicht-Admin
  state.isAdmin = false;
  state.banned = true;
  state.settings = Object.assign({}, settings, { registration_enabled: false, chat_enabled: false, uploads_enabled: false, announcement_active: false, maintenance_mode: true, maintenance_message: 'Wir sind gleich zurück.' });
  ({ doc, window } = await boot());
  check('Sperr-Hinweis erscheint', /Konto ist gesperrt/.test(doc.querySelector('#member-banned').textContent));
  check('Wartungs-Hinweis erscheint', /gleich zurück/.test(doc.querySelector('#member-maintenance').textContent));
  check('Registrierungs-Tab ist ausgeblendet', doc.querySelector('[data-auth-mode="register"]').hidden === true);
  check('Chat-Tab ist ausgeblendet', doc.querySelector('[data-member-tab="messages"]').hidden === true);
  check('Upload-Arten sind ausgeblendet', doc.querySelector('[data-post-kind="image"]').hidden === true);
  check('Admin-Link bleibt für Nicht-Admins verborgen', doc.querySelector('#member-admin-link').hidden === true);
  check('Hinweis-Banner ist entfernt', !doc.querySelector('#member-announcement'));
  check('Komponist ist als gesperrt markiert', doc.querySelector('#club').classList.contains('is-banned'));

  console.log(`\n${calls.length} Anfragen, ${problems} Problem(e)`);
  process.exit(problems ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
