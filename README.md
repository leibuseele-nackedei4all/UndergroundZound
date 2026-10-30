# UndergroundZound – Leib & Seele

Website of **Leib & Seele Records** / **zZinuZz** from Koblenz – *Dj'ing & Producing, UndergroundSound, LiveStream*.

The public music site is a static HTML/CSS/JavaScript website and can be hosted on **GitHub Pages**. The new login-based community area is a static browser client backed by **Supabase** for accounts, database, private media storage and real-time direct messages. It will stay safely disabled until a Supabase project is configured; there are no project credentials in this repository.

**Live site:** https://leibuseele-nackedei4all.github.io/UndergroundZound/ *(GitHub Pages must be enabled in repository Settings → Pages.)*

---

## What's on the site

| Section | Link | Contents |
|---|---|---|
| **Leib & Seele** | `#home` | Animated logo, newest set and highlights |
| **Underground Zound** | `#sets` | Live sets and mixes |
| **Selfmade-Production** | `#selfmade` | Own tracks and the "AWO" video |
| **FruityLoop´s für FruityNoob´s** | `#workshop` | FL Studio 21 workshop, booking calendar and studio packages |
| **About Us** | `#about` | zZinuZz and biography |
| **Contact** | `#kontakt` | Contact details and form |
| **Disclaimer** | `#disclaimer` | Existing site disclaimer and hosting notes |
| **Mitgliederbereich** | `#club` | Login / registration, community feed, personal pitch pages, profiles, friends and direct messages |
| **Admin-Bereich** | `admin.html` | Anmeldung nur für Administratoren, danach die komplette Verwaltung (Mitglieder, Beiträge, Meldungen, Nachrichten, Medien, Einstellungen, Protokoll) |

The community includes text, image/GIF, video and voice-note posts; comments, likes and shares; optional friends-only profile/post visibility; friend requests; straightforward 1:1 text chat; Google/Facebook OAuth; profile editing; and account-deletion requests. Member uploads live in private Supabase buckets and are served with short-lived signed URLs. Row Level Security (RLS) is part of the database migration — **do not remove or weaken it**.

Public pages do not load the Supabase client. It is loaded locally and only when someone opens the member area. Choosing Google or Facebook sends the visitor to that provider; otherwise the public music pages keep their existing click-to-load embeds and do not use analytics or advertising trackers.

## Publish the public site with GitHub Pages

1. Open repository **Settings → Pages**.
2. Under *Build and deployment*, choose **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then click **Save**.
3. After deployment, the public site is available at https://leibuseele-nackedei4all.github.io/UndergroundZound/.

## Set up the member backend (required before accepting sign-ups)

The public website can stay on GitHub Pages, but logins, posts, uploads and chat need a real backend. This repo uses Supabase. The frontend configuration below is public by design; database access is protected by RLS. **Never place a Supabase `service_role` key or any secret key in this repository.**

1. **Create a Supabase project.** Choose an EU region (for example Frankfurt) if that suits your data-protection requirements. The project is managed by you; review Supabase's current plan limits, data-processing terms and backup options.
2. **Create the database and private storage rules.** In Supabase → **SQL Editor**, run `supabase/migrations/202610150001_community.sql` as the project owner. It creates the community tables, RLS policies, private `avatars` and `member-media` buckets, friend/chat RPCs and the real-time message publication entry.
3. **Configure the public browser key.** In Supabase project settings, copy the **Project URL** and **Publishable key** (or legacy `anon` key) into `assets/js/member-config.js`:
   - `supabaseUrl`: the project URL;
   - `supabasePublicKey`: the publishable/anon key.

   These values are visible to every site visitor. That is expected. RLS is the security boundary. Do not substitute a secret or `service_role` key.
4. **Set Auth URLs.** In Supabase → **Authentication → URL Configuration**, set the Site URL to `https://leibuseele-nackedei4all.github.io/UndergroundZound/` and add the deployed site and local preview URL to the allowed redirect URLs, for example:
   - `https://leibuseele-nackedei4all.github.io/UndergroundZound/**`
   - `http://localhost:8080/**`

   For a custom domain, add that exact domain and its member-area path as well.
5. **Enable email sign-up.** Configure email/password sign-in and email confirmation in Supabase Auth. Use an SMTP provider you control for reliable production delivery; the default test mail service is not suitable for a public launch.
6. **Enable Google and Facebook sign-in.** In Supabase Auth → **Providers**, add the OAuth client ID/secret for Google and Facebook. Create/configure the corresponding Google Cloud OAuth client and Meta/Facebook app, and add the callback URL shown by Supabase to each provider's allowed redirect/return URLs. Also allow the website URL in Supabase Auth. Provider credentials belong in Supabase settings — never in this repo. Social sign-in can create a new member account. Existing accounts from different providers may need account linking by the user; do not assume identical emails are automatically linked.
7. **Make the site owner an admin.** Create and confirm your own account, find its user UUID in Supabase → **Authentication → Users**, then run this in SQL Editor:

   ```sql
   insert into public.app_admins (user_id)
   values ('YOUR_AUTH_USER_UUID');
   ```

   For the full in-site console (members, posts, reports, messages, media, settings, audit log) additionally run `supabase/migrations/202610300001_admin_console.sql` — see **Der Admin-Bereich** below. It also promotes `leibuseele@gmail.com` automatically.
8. **Finish legal and operational setup before opening registration.** The existing Disclaimer is not a complete privacy notice for a social community. Add accurate German-language privacy information, terms/community rules, a complete Impressum and your retention/contact details before inviting members. State the actual Supabase region, OAuth providers, data collected, retention and account-deletion process. The site owner is responsible for those policies and for moderation.
9. **Deploy and test.** Publish the updated `member-config.js`, then test email confirmation, password reset, Google/Facebook redirects, profile editing (including animated GIF), friends, friend-only visibility, media uploads, comments/shares, 1:1 messages and deletion requests using two test accounts.

Without steps 1–4 the member forms remain disabled. The Supabase browser SDK is vendored at `assets/js/vendor/supabase.min.js` (MIT licence alongside it) and loaded only when the member page is opened.

## Der Admin-Bereich (`admin.html`)

Die Anmeldeseite liegt unter **`admin.html`** (verlinkt im Footer der Website und – nur für
Administratoren sichtbar – in der Seitenleiste des Mitgliederbereichs). Nach der Anmeldung
steht eine vollständige Verwaltungskonsole zur Verfügung:

| Bereich | Funktionen |
|---|---|
| **Übersicht** | Kennzahlen (Mitglieder, Sperren, Beiträge, Kommentare, Meldungen, Löschanträge, Nachrichten, Freundschaften, Medien, Administratoren), letzte Aktivitäten |
| **Mitglieder** | Suche (Name, Benutzername, E-Mail, Stadt), Sortierung, Detailansicht mit allen Profil- und Aktivitätsdaten, Profil bearbeiten, Adminrechte vergeben/entziehen, Sperren (1/7/30/90 Tage oder unbefristet, mit Grund), Konto endgültig löschen |
| **Administratoren** | Liste aller Konten mit Adminrechten, Rechte entziehen (der letzte Admin und das eigene Konto sind geschützt) |
| **Beiträge** | Filter nach Text/Autor, Art und Sichtbarkeit, Bildvorschau, Zahlen zu Likes/Kommentaren/Shares, Beitrag samt Anhang löschen |
| **Kommentare** | Suche, Beitragszuordnung, löschen |
| **Meldungen** | Status-Workflow (neu → in Prüfung → erledigt/verworfen) mit interner Notiz, gemeldeten Beitrag oder Profil öffnen, Inhalt löschen, Konto sperren |
| **Löschanträge** | Status pflegen, Notiz hinterlegen, Konto endgültig löschen |
| **Freundschaften** | alle Beziehungen einsehen, löschen |
| **Nachrichten** | Unterhaltungen einsehen, einzelne Nachrichten oder die ganze Unterhaltung löschen (Zugriff wird protokolliert) |
| **Medien** | Beiträge-Medien und Profilbilder, Vorschau, Größe, Besitzer, Datei öffnen/löschen |
| **Einstellungen** | Mitgliederbereich öffnen/schließen, Registrierung, Nachrichten, Freundschaften, Uploads, maximale Upload-Größe, Hinweis-Banner (Titel/Text/Art), Wartungsmodus mit Text, Support-E-Mail, Link zu den Community-Regeln |
| **Protokoll** | jede Admin-Aktion mit Konto, Ziel und Zeitstempel |

### Einrichtung (einmalig)

1. **Konto anlegen:** In Supabase unter *Authentication → Users* den Benutzer
   **`leibuseele@gmail.com`** anlegen und bestätigen. Das Passwort wird nur in Supabase
   gespeichert – niemals im Repository.
2. **Datenbank erweitern:** `supabase/migrations/202610300001_admin_console.sql` im
   *SQL Editor* ausführen. Die Datei legt `member_bans`, `site_settings` und
   `admin_audit_log` an, ergänzt die RLS-Regeln und trägt das Konto oben automatisch in
   `public.app_admins` ein.
3. **Konfiguration prüfen:** `assets/js/member-config.js` enthält die Projekt-URL
   (`https://PROJEKT.supabase.co`, **ohne** `/rest/v1/`) und den Publishable Key.
4. **Anmelden:** `https://leibuseele-nackedei4all.github.io/UndergroundZound/admin.html`
   öffnen und mit dieser E-Mail-Adresse und dem in Supabase gesetzten Passwort einloggen.

Ohne Eintrag in `public.app_admins` verweigert die Anmeldeseite den Zugriff und meldet die
Sitzung sofort wieder ab. Ein zusätzliches Admin-Konto lässt sich später direkt in der
Konsole unter *Mitglieder → „Zum Admin“* vergeben.

### Sicherheit

- Jede Admin-Funktion (`admin_*`) ist `SECURITY DEFINER`, prüft **serverseitig** die
  Mitgliedschaft in `public.app_admins` und ist nur für `authenticated` freigegeben.
  `anon` hat keinerlei Zugriff; die Konsole ist reine Oberfläche.
- Der Browser nutzt ausschließlich den Publishable/anon-Key. **Kein `service_role`-Key im
  Repository oder im Browser.**
- Ein gesperrtes Mitglied (`member_bans`) verliert über `is_active_member()` alle
  Schreibrechte: Beiträge, Kommentare, Likes, Shares, Nachrichten und Uploads.
- Die öffentliche Website liest nur die wenigen Freigaben über `get_public_settings()`.
- Alle Admin-Aktionen landen in `public.admin_audit_log`, inklusive Lesezugriff auf
  Unterhaltungen.
- Passwörter werden nie im Klartext gespeichert; „Passwort vergessen?“ auf der
  Anmeldeseite verschickt einen Supabase-Reset-Link zurück auf `admin.html`.

## Edit the site

Everything can be edited directly on GitHub (open a file → pencil icon) or with any text editor.

- **Public-page texts:** `index.html`. Each section starts with a comment such as `<!-- UNDERGROUND ZOUND (Sets) -->`.
- **Community interface and client:** `index.html`, `assets/css/style.css`, `assets/js/community.js`.
- **Supabase settings:** `assets/js/member-config.js` (public project URL + public key only).
- **Database/security rules:** `supabase/migrations/202610150001_community.sql`.
- **Add a SoundCloud track:** copy an `<article class="track" …>` block and change `data-src`, `data-title`, `data-artist`, `data-cover` and its visible texts. Put square cover art (about 400×400) in `assets/img/covers/`.
- **Add an MP3:** put it in `assets/audio/` and use `data-type="audio"` with `data-src="assets/audio/your-file.mp3"`.
- **Colours / fonts:** `assets/css/style.css` — design tokens are at the top.
- **Admin-Bereich:** `admin.html` (Konsole) – alle Optionen oben beschrieben.
- **Preview:** run `python3 -m http.server 8080` in the project folder and open `http://localhost:8080`. The member interface can be previewed without Supabase, but login controls stay disabled.

## Folder structure

```
index.html                         public site + member area markup
admin.html                         admin login + console markup
assets/css/admin.css               layout for the admin console
404.html                           old Wix links + not-found page
assets/css/style.css               design, responsive layout and member area
assets/js/main.js                  public navigation, player and embeds
assets/js/community.js             auth, feed, profiles, friends and chat
assets/js/admin.js                 admin console (calls the admin_* RPCs)
assets/js/member-config.js          empty public Supabase config template
assets/js/vendor/                  locally hosted Supabase JS + MIT licence
assets/img/                         logo, emblem, covers, background and icons
assets/audio/                       self-hosted music (MP3, 128 kbps)
assets/fonts/                       Lobster + Raleway (SIL Open Font License)
supabase/migrations/                community schema, RLS, storage, chat and admin console setup
tools/admin-smoke-test.js          local jsdom smoke test of the admin console
site.webmanifest                    name + icon for mobile home-screen install
.nojekyll                           publishes files directly through GitHub Pages
```

## Notes on the move from Wix

- **Taken over:** public-page texts and links, disclaimer, contact details, your own pictures (logo animation, medallion, emblem, workshop screenshots, covers) and the tracks, including the ones previously stored on Wix.
- **Not taken over (on purpose):**
  - Wix's private members-only pages had no accessible content; they are replaced by the new Supabase-backed community area described above.
  - *Shop, Treueprogramm, Reservierungen, Erlebnisse:* unused Wix template pages with demo products.
  - *Blog:* four test posts with placeholder text and pictures that weren't made by Leib & Seele. The only real content, the *HereIAm* track, is on the Selfmade page.
  - *Podcast pages:* they only showed the zZinuZz SoundCloud feed, which is linked under *Alle Kanäle*.
  - *File upload:* replaced on the public contact page by "send us a download link by e-mail". Member uploads are handled separately by the private Supabase storage buckets after setup.
- **Contact form:** opens the visitor's e-mail program with the message filled in (GitHub Pages has no mail server). The phone numbers on Wix were incomplete and were left out.
- **Graphics:** Wix's background, icons and decorative graphics came from Wix's own media library and were replaced with look-alikes. Lobster and Raleway are self-hosted.
- **Legal:** the disclaimer still needs review and an update from TMG to DDG. Because the site offers paid workshops and studio packages, add a complete Impressum. The member area also needs a complete privacy notice and terms before public sign-ups.

## Licence

Content © Leib & Seele Records, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (as on the Wix site).

Fonts: Lobster and Raleway, SIL Open Font License 1.1 (see `assets/fonts/`).
