# UndergroundZound – Leib & Seele

Website of **Leib & Seele Records** / **zZinuZz** from Koblenz – *Dj'ing & Producing, UndergroundSound, LiveStream*.

This used to be a Wix site (`https://pwendelmuth.wixsite.com/leibundseele`). It is now a plain static website (HTML + CSS + a little JavaScript) that runs **for free on GitHub Pages**, without the Wix banner and without any build tools.

**Live:** https://leibuseele-nackedei4all.github.io/UndergroundZound/ *(as soon as GitHub Pages is switched on – see below)*

---

## What's on the site

| Section | Link | Came from (Wix page) |
|---|---|---|
| **Leib & Seele** – animated logo, newest set, highlights | `#home` | Home |
| **Underground Zound** – live sets & mixes | `#sets` | Underground Zound (`/tour`) |
| **Selfmade-Production** – own tracks & the "AWO" video | `#selfmade` | Selfmade-Production (`/media`) |
| **FruityLoop´s für FruityNoob´s** – FL Studio 21 workshop, booking calendar, studio packages | `#workshop` | `/kopie-von-livestream` + Plans & Pricing |
| **About Us** – zZinuZz, bio | `#about` | About Us (`/epk`) |
| **Contact** | `#kontakt` | CONTACT + File Share |
| **Disclaimer** | `#disclaimer` | Disclaimer |

Highlights:

- **Player that keeps playing while you browse** (docked at the bottom), for SoundCloud tracks and for the self-hosted tracks.
- **Self-hosted tracks** that were only on Wix before (Wix Music + POWR player): *HereIAm (Demo)*, *Ready-Player-One*, *HohenZollern*, *++1++ (Stormy)*.
- **Privacy friendly:** no cookies, no trackers, fonts are hosted on the site itself. SoundCloud, YouTube and the Google booking calendar are only loaded after a click.
- Works on phones, and also works without JavaScript (all sections are then shown one below the other).
- Old Wix links like `/tour`, `/media`, `/epk`, `/contact` are redirected to the matching section by `404.html`.

## Publish it with GitHub Pages (one time)

1. Merge this branch into `main`.
2. On GitHub open **Settings → Pages**.
3. Under *Build and deployment* choose **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`** and click **Save**.
4. After about a minute the site is online at https://leibuseele-nackedei4all.github.io/UndergroundZound/

Own domain (optional): enter it under *Settings → Pages → Custom domain*, then also replace the `https://leibuseele-nackedei4all.github.io/UndergroundZound/` addresses in the `<head>` of `index.html` (social media preview).

## Edit the site

Everything can be edited directly on GitHub (open a file → pencil icon) or with any text editor.

- **Texts:** all in `index.html`. Every section starts with a comment like `<!-- UNDERGROUND ZOUND (Sets) -->`.
- **Add a SoundCloud track:** copy one `<article class="track" …> … </article>` block and change
  - `data-src` – the SoundCloud address of the track (e.g. `https://soundcloud.com/zzinuzzz/zzinuzz-livemischkonsum`) or the `https://api.soundcloud.com/tracks/…` address from SoundCloud's embed code,
  - `data-title`, `data-artist`, `data-cover` and the visible title/artist texts,
  - the cover image: put a square picture (about 400×400) into `assets/img/covers/`.
- **Add your own MP3:** put the file into `assets/audio/` and use `data-type="audio"` with `data-src="assets/audio/your-file.mp3"` (see the *Exklusiv hier* tracks).
- **Colours / fonts:** `assets/css/style.css` – the colours are at the very top (`:root`).
- **Preview on your computer:** run `python3 -m http.server` in the project folder and open http://localhost:8000

## Folder structure

```
index.html             the whole website (all sections)
404.html               "page not found" + redirects for old Wix links
assets/css/style.css   design
assets/js/main.js      navigation, player, click-to-load embeds, contact form
assets/img/            logo, emblem, covers, workshop screenshots, background
assets/audio/          self-hosted tracks (MP3, 128 kbps)
assets/fonts/          Lobster + Raleway (SIL Open Font License)
site.webmanifest       name + icon when the site is added to a phone's home screen
.nojekyll              tells GitHub Pages to publish the files exactly as they are
```

## Notes on the move from Wix

- **Taken over:** texts, links, contact details, the disclaimer, your own pictures (logo animation, medallion, emblem, workshop screenshots, covers) and all tracks – including the ones that were only stored on Wix.
- **Not taken over (on purpose):**
  - *Members area / login* and the two members-only pages ("More SelfmadeStuff", "Updated Set's"). A static site cannot have logins, so these buttons now open *Selfmade* and *Underground Zound*.
  - *Shop, Treueprogramm, Reservierungen, Erlebnisse:* unused Wix template pages with demo products.
  - *Blog:* four test posts with placeholder text and pictures that weren't made by Leib & Seele. The only real content, the *HereIAm* track, is on the Selfmade page.
  - *Podcast pages:* they only showed the zZinuZz SoundCloud feed, which is linked under *Alle Kanäle*.
  - *File upload:* replaced by "send us a download link by e-mail".
- **Contact form:** opens the visitor's e-mail program with the message filled in (GitHub Pages has no server to send mails). The phone numbers on Wix were incomplete (`0261/…`) and were left out.
- **Graphics:** the Wix background, icons and decorative graphics come from Wix's own media library, which may only be used on Wix sites. They were replaced with look-alikes. The fonts (Lobster and Raleway) are the same as before.
- **Dead link fixed:** the old YouTube link in the footer (`youtu.be/eO0nkPGsaBM`) no longer exists. It now points to the YouTube channel.
- **Legal:** the disclaimer was copied word for word, plus a short note about hosting and embedded content. It still mentions the *TMG*, which the *DDG* replaced in 2024. Because the site offers paid workshops and studio packages, German law also requires a full **Impressum** (with a postal address). Please add one.

## Licence

Content © Leib & Seele Records, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (as on the Wix site).
Fonts: Lobster and Raleway, SIL Open Font License 1.1 (see `assets/fonts/`).
