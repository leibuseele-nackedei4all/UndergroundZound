/*
 * Lokaler Smoke-Test der Admin-Konsole mit jsdom + gefälschtem Supabase-Backend.
 * Nicht Teil der Website – nur zum Prüfen der UI-Verdrahtung:
 *   npm install jsdom --no-save
 *   node tools/admin-smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const email = 'leibuseele@gmail.com';
const uuid = '11111111-2222-3333-4444-555555555555';

function jwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const accessToken = jwt({
  sub: uuid, role: 'authenticated', email,
  exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated'
});

const now = new Date().toISOString();

const member = {
  id: uuid, username: 'zzinuzz', display_name: 'zZinuZz', bio: 'Leib & Seele', city: 'Koblenz',
  pronouns: '', birth_date: null, favorite_genres: 'Techno', website: '', soundcloud_url: '',
  profile_visibility: 'members', avatar_path: null, created_at: now, updated_at: now,
  email, last_sign_in_at: now, email_confirmed_at: now, auth_created_at: now,
  is_admin: true, is_banned: false, ban_reason: null, ban_until: null,
  post_count: 3, comment_count: 2, like_count: 5, message_count: 4,
  friend_count: 1, media_count: 2, reports_against: 0, recent_posts: []
};

const rpcData = {
  is_admin: true,
  is_member_banned: false,
  get_public_settings: { registration_enabled: true },
  admin_dashboard: {
    members: 7, admins: 1, banned: 1, posts: 12, comments: 4, likes: 9, shares: 2,
    messages: 21, conversations: 3, friends_accepted: 4, friends_pending: 1,
    reports_total: 2, reports_new: 1, reports_open: 1, deletions_total: 1, deletions_open: 1,
    media_objects: 5, media_bytes: 204800, signups_7d: 2, signups_30d: 6,
    posts_7d: 5, messages_7d: 11, comments_7d: 3,
    latest_members: [member], latest_posts: [{ id: 'p1', body: 'Erster Beitrag', kind: 'text', visibility: 'members', created_at: now, author_username: 'zzinuzz', author_name: 'zZinuZz' }],
    latest_reports: [{ id: 'r1', category: 'spam', status: 'new', created_at: now, details: '', reporter_username: 'test' }],
    latest_audit: [{ id: 1, action: 'setting.update', target: 'registration_enabled', admin_email: email, created_at: now }],
    generated_at: now
  },
  admin_list_members: { total: 1, limit: 20, offset: 0, rows: [member] },
  admin_get_member: member,
  admin_list_admins: { rows: [{ user_id: uuid, created_at: now, email, username: 'zzinuzz', display_name: 'zZinuZz' }] },
  admin_list_posts: { total: 1, limit: 20, offset: 0, rows: [{ id: 'p1', author_id: uuid, body: 'Erster Beitrag', kind: 'text', visibility: 'members', media_path: null, media_mime: null, created_at: now, author_username: 'zzinuzz', author_name: 'zZinuZz', author_avatar: null, like_count: 2, comment_count: 1, share_count: 0, report_count: 1 }] },
  admin_list_comments: { total: 1, limit: 30, offset: 0, rows: [{ id: 'c1', post_id: 'p1', author_id: uuid, body: 'Nice!', created_at: now, author_username: 'zzinuzz', author_name: 'zZinuZz', post_excerpt: 'Erster Beitrag' }] },
  admin_list_reports: { total: 1, limit: 20, offset: 0, rows: [{ id: 'r1', category: 'spam', details: 'Werbung', status: 'new', created_at: now, admin_note: '', resolved_at: null, target_post_id: 'p1', target_profile_id: null, reporter_username: 'test', reporter_name: 'Test', target_username: 'zzinuzz', target_name: 'zZinuZz', post_excerpt: 'Erster Beitrag', post_media_path: null, post_created_at: now }] },
  admin_list_deletion_requests: { total: 1, limit: 20, offset: 0, rows: [{ user_id: uuid, status: 'requested', created_at: now, processed_at: null, note: '', username: 'zzinuzz', display_name: 'zZinuZz', avatar_path: null, email, post_count: 3 }] },
  admin_list_friendships: { total: 1, limit: 30, offset: 0, rows: [{ id: 'f1', status: 'accepted', created_at: now, requester_id: uuid, addressee_id: uuid, requester_username: 'a', requester_name: 'A', addressee_username: 'b', addressee_name: 'B' }] },
  admin_list_conversations: { total: 1, limit: 20, offset: 0, rows: [{ id: 'k1', created_at: now, updated_at: now, user_one: uuid, user_two: uuid, one_username: 'a', one_name: 'A', two_username: 'b', two_name: 'B', message_count: 2, last_body: 'Hallo', last_at: now }] },
  admin_read_conversation: { rows: [{ id: 'm1', sender_id: uuid, body: 'Hallo', created_at: now, sender_username: 'a', sender_name: 'A' }] },
  admin_list_media: { total: 1, limit: 24, offset: 0, bucket: 'member-media', rows: [{ name: `${uuid}/p1/cover.png`, bucket_id: 'member-media', size_bytes: 20480, mime: 'image/png', created_at: now, updated_at: now, owner_id: uuid, owner_username: 'zzinuzz', owner_name: 'zZinuZz' }] },
  admin_list_audit: { total: 1, limit: 40, offset: 0, rows: [{ id: 1, admin_id: uuid, admin_email: email, action: 'post.delete', target: 'p1', details: { author_id: uuid }, created_at: now }] },
  admin_get_settings: { values: { registration_enabled: true, member_area_open: true, chat_enabled: true, friends_enabled: true, uploads_enabled: true, max_upload_mb: 50, announcement_active: false, announcement_title: '', announcement_text: '', announcement_kind: 'info', maintenance_mode: false, maintenance_message: '', support_email: email, community_rules_url: '#club-rules' } },
  admin_set_setting: { ok: true }
};

const calls = [];

function mockFetch(url, options = {}) {
  const target = String(url);
  const method = (options.method || 'GET').toUpperCase();
  calls.push(`${method} ${target}`);
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  if (target.includes('/auth/v1/token')) {
    const body = JSON.parse(options.body || '{}');
    if (body.password !== '862019') return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    return json({
      access_token: accessToken, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token',
      user: { id: uuid, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: now, created_at: now, user_metadata: {}, app_metadata: {} }
    });
  }
  if (target.includes('/auth/v1/user')) {
    return json({ id: uuid, aud: 'authenticated', role: 'authenticated', email, created_at: now, user_metadata: {}, app_metadata: {} });
  }
  if (target.includes('/auth/v1/logout')) return new Response('', { status: 204 });
  if (target.includes('/auth/v1/recover')) return json({});

  if (target.includes('/rpc/')) {
    const name = target.split('/rpc/')[1].split('?')[0];
    if (!(name in rpcData)) return json({ code: 'PGRST202', message: `Could not find the function public.${name}` }, 404);
    return json(rpcData[name]);
  }
  if (target.includes('/rest/v1/profiles')) {
    return new Response(JSON.stringify([{ id: uuid, username: 'zzinuzz', display_name: 'zZinuZz', avatar_path: null }]), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' }
    });
  }
  if (target.includes('/storage/v1/object/sign/')) {
    return json({ signedURL: '/storage/v1/object/sign/x?token=abc' });
  }
  return json({ message: 'not mocked: ' + target }, 404);
}

async function main() {
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  const virtualConsole = new VirtualConsole();
  const logs = [];
  virtualConsole.on('jsdomError', (e) => logs.push('jsdomError: ' + e.message));
  virtualConsole.on('error', (...a) => logs.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/admin.html',
    runScripts: 'dangerously',
    resources: undefined,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = mockFetch;
      window.Response = Response;
      window.Headers = Headers;
      window.Request = Request;
    }
  });

  const { window } = dom;
  window.document.querySelectorAll('script[src]').forEach((script) => {
    const rel = script.getAttribute('src');
    // Vendor-SDK und Admin-Skript manuell injizieren (jsdom lädt keine Dateien ohne resource loader)
    if (rel.includes('admin.js') || rel.includes('supabase.min.js')) return;
  });

  // Konfiguration setzen (member-config.js wird nicht automatisch geladen)
  window.MEMBER_CONFIG = Object.freeze({
    supabaseUrl: 'https://demo.supabase.co/rest/v1/',
    supabasePublicKey: 'sb_publishable_demo_key_1234567890'
  });
  window.eval(fs.readFileSync(path.join(root, 'assets/js/vendor/supabase.min.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'assets/js/admin.js'), 'utf8'));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const doc = window.document;
  const problems = [];
  const check = (label, condition) => {
    if (!condition) problems.push(label);
    console.log(`${condition ? '✓' : '✗'} ${label}`);
  };

  await wait(300);
  check('Anmeldeformular ist aktiv', doc.querySelector('#admin-login-email').disabled === false);
  check('Konsole ist anfangs verborgen', doc.querySelector('#admin-console').hidden === true);

  // Falsches Passwort
  doc.querySelector('#admin-login-email').value = email;
  doc.querySelector('#admin-login-password').value = 'falsch';
  doc.querySelector('#admin-login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(400);
  check('Falsches Passwort zeigt Fehlermeldung', /falsch/i.test(doc.querySelector('#admin-flash').textContent));
  check('Konsole bleibt verborgen', doc.querySelector('#admin-console').hidden === true);

  // Richtiges Passwort
  doc.querySelector('#admin-login-email').value = email;
  doc.querySelector('#admin-login-password').value = '862019';
  doc.querySelector('#admin-login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  check('Nach Login ist die Konsole sichtbar', doc.querySelector('#admin-console').hidden === false);
  check('Anmeldeformular ist ausgeblendet', doc.querySelector('#admin-gate').hidden === true);
  check('Dashboard-Kennzahlen gerendert', doc.querySelectorAll('#admin-stats .admin-stat').length === 10);
  check('Sitzungskopf zeigt Admin', /zZinuZz|Admin/.test(doc.querySelector('#admin-session-name').textContent));
  check('Zähler für Meldungen gesetzt', doc.querySelector('#admin-count-reports').textContent === '1');

  const tabs = ['members', 'admins', 'posts', 'comments', 'reports', 'deletions', 'friends', 'messages', 'media', 'settings', 'audit'];
  for (const tab of tabs) {
    doc.querySelector(`[data-admin-tab="${tab}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(350);
    const panel = doc.querySelector(`[data-admin-panel="${tab}"]`);
    const visible = panel && !panel.hidden;
    const error = panel && panel.querySelector('[data-error-slot]:not([hidden])');
    check(`Tab „${tab}“ lädt ohne Fehler`, visible && !error);
  }

  // Mitglieder-Detail öffnen
  doc.querySelector('[data-admin-tab="members"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
  const detailButton = Array.from(doc.querySelectorAll('#admin-members-list button')).find((b) => /Details/.test(b.textContent));
  check('Mitgliederzeile hat Details-Button', !!detailButton);
  detailButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
  check('Detaildialog enthält Profildaten', /@zzinuzz/.test(doc.querySelector('#admin-dialog-body').textContent));
  doc.querySelector('#admin-dialog-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  check('Einstellungen geladen (Registrierung an)', doc.querySelector('[data-setting="registration_enabled"]').checked === true);

  // Abmelden
  doc.querySelector('#admin-sign-out').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(500);
  check('Abmelden zeigt die Anmeldung wieder', doc.querySelector('#admin-gate').hidden === false && doc.querySelector('#admin-console').hidden === true);

  // Nicht-Admin-Konto wird abgewiesen
  rpcData.is_admin = false;
  doc.querySelector('#admin-login-email').value = 'nicht.admin@example.com';
  doc.querySelector('#admin-login-password').value = '862019';
  doc.querySelector('#admin-login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  check('Nicht-Admin erhält keinen Zugriff', doc.querySelector('#admin-console').hidden === true);
  check('Nicht-Admin sieht eine Erklärung', /kein Administrator|kein Administratorzugriff/i.test(doc.querySelector('#admin-flash').textContent));

  // Wieder als Admin anmelden und Einstellung speichern
  rpcData.is_admin = true;
  doc.querySelector('#admin-login-email').value = email;
  doc.querySelector('#admin-login-password').value = '862019';
  doc.querySelector('#admin-login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  check('Erneute Admin-Anmeldung funktioniert', doc.querySelector('#admin-console').hidden === false);
  doc.querySelector('[data-admin-tab="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
  const toggle = doc.querySelector('[data-setting="registration_enabled"]');
  toggle.checked = false;
  doc.querySelector('#admin-settings-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(600);
  check('Einstellung wird gespeichert (admin_set_setting)', calls.some((c) => c.includes('/rpc/admin_set_setting')));
  check('Speicherbestätigung erscheint', /gespeichert/i.test(doc.querySelector('#admin-settings-status').textContent));

  // Sperren-Ablauf über die Mitgliederliste
  doc.querySelector('[data-admin-tab="members"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
  const banButton = Array.from(doc.querySelectorAll('#admin-members-list button')).find((b) => /Sperren/.test(b.textContent));
  check('Sperren-Button vorhanden', !!banButton);
  banButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  check('Sperr-Dialog fragt nach Grund und Dauer', doc.querySelectorAll('#admin-dialog-body input, #admin-dialog-body select').length >= 2);

  const rpcCalls = calls.filter((c) => c.includes('/rpc/'));
  check('Alle RPC-Aufrufe sind POST', rpcCalls.every((c) => c.startsWith('POST')));
  check('Kein service_role-Aufruf', !JSON.stringify(calls).includes('service_role'));

  if (logs.length) console.log('\nKonsole:\n' + logs.join('\n'));
  console.log(`\n${rpcCalls.length} RPC-Aufrufe, ${problems.length} Problem(e)`);
  if (problems.length) {
    console.log('Probleme:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
