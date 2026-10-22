# Grab All (formerly "Bulk Downloader"): Firefox extension (handoff notes)

## Goal
Firefox extension (desktop + **Firefox for Android**) that adds a floating "Download all" button on file-host pages and downloads every file, either as **one zip** or as an **automatic one-by-one queue**. The user is a student who lost time downloading 80+ files one at a time.

## Sites
- In scope now: **gofile**, **filester**, **koofr**
- **bunkr: deferred.** The user explicitly said not to do it yet. Later it must match any `bunkr.*` domain.
- Sample links (harmless test content from the user):
  - Gofile: https://gofile.io/d/PSpVfkGo
  - Filester: https://filester.me/f/f116cf63edb512d7
  - Koofr: https://k00.fr/spjaog3b → redirects to https://app.koofr.net/links/24098626-378a-46cc-abf3-6e8755f35175

## Agreed tech stack
- WebExtension **Manifest V3**, Firefox flavor (`browser_specific_settings.gecko`, Android-compatible)
- **TypeScript** + **esbuild**, **fflate** for the zip (store-only, no compression), **web-ext** CLI for dev and testing
- UI: plain HTML/CSS in a **Shadow DOM**. No React or other framework (keep it light for mobile).
- Architecture: content script detects the site → **per-site adapter** (`matches(url)`, `listFiles()` → name, size, url) → download manager running on an extension page (zip mode or queue mode)

## Plan (phases)
0. **Phone capability check first:** does `browser.downloads` work on Firefox Android (else fall back to a blob/anchor download)? How big a zip can the phone build in memory?
1. Core: manifest, site detection, floating button, file list with checkboxes, progress, cancel/retry
2. Adapters: gofile → filester → koofr (bunkr later)
3. Reliability: rate limiting, retries with backoff, warn about large folders in zip mode (suggest queue mode)
4. Sign on AMO as **unlisted**, then install the signed .xpi on the phone

## Environment
- Windows 11; Node v24.15.0 and npm 11.12.1 installed; `adb` is NOT installed (needed later for phone testing via web-ext)
- Project is scaffolded (see Build status).
- Probe files from the last session were in the session scratchpad (temporary, may be gone; re-fetch with curl if needed)

## Research results (all three sites verified 2026-10-22)
- **filester** (easy, all verified with curl):
  - Folder page `/f/<id>` is server-rendered. Each file is a `.file-item` in `#filesGrid` with `data-name`, `data-size`, and `onclick` → `/d/<slug>`. **24 files per page**, more pages at `?page=N`; the page count is in a `data-total` attribute (the sample has 2 pages, 48 files).
  - Per file: `POST /v2/api/public/download` with JSON `{"file_slug":"<slug>"}` returns `{server, file, token, name, expires_in:1800}`. Download from `${server}/v2/${file}?token=${token}&download=true`. The token contains the requester's IP, so it must be requested from the user's own browser. The CDN sends `Access-Control-Allow-Origin: *`, so zip mode works.
  - The site's own folder zip (`POST /api/folder/download`) requires login, so we don't use it.
- **koofr** (easy, verified):
  - The link id is the UUID in `app.koofr.net/links/<uuid>` (k00.fr short links redirect there).
  - Listing: `GET /api/v2/public/links/<uuid>/bundle?path=/` returns `{files:[{name,type:"file"|"dir",size,contentType,hash}]}`. Recurse into `dir` entries with `path=/sub`. Info: `GET /api/v2/public/links/<uuid>`, which includes `isDownloadable`.
  - File: `GET /content/links/<uuid>/files/get/<name>?path=/<path>&force`. **The `Referer` must be the link page**, otherwise the response is 400 "Hotlinking not allowed". Same-origin requests from a content script on app.koofr.net send it automatically. `downloads.download` cannot set `Referer` (forbidden header), so queue mode needs an in-page anchor click or a fetch→blob instead.
- **gofile** (harder):
  - Guest token: `POST https://api.gofile.io/accounts` → `data.token` (also kept in the `accountToken` cookie).
  - Listing: `GET https://api.gofile.io/contents/<id>?page=1&pageSize=100&sortField=name&sortDirection=1` with headers `Authorization: Bearer <token>`, `X-Website-Token: <wt>`, `X-BL: <lang>`. Old public `wt` values now return `error-notPremium`.
  - `wt` comes from `globalThis.generateWT(accountToken)`, defined by the obfuscated `/js/wt.obf.js`. The secret rotates server-side, and per the site's own code comments, **stale or forged tokens get the IP instantly banned**. **Never forge `wt`.**
  - Plan: a MAIN-world content script that (a) wraps `fetch` to capture the page's own `/contents` responses and (b) for more pages, calls the page's own `generateWT` with the account token. Fall back to reading the rendered DOM. File download URLs (`link` field) still need to be checked in a real browser (they probably need the `accountToken` cookie).
- Unchecked: Android support for MAIN-world scripts and `webRequest.filterResponseData`. Check during Phase 0.

## Build status (2026-10-22)
- Scaffolded and building: `npm run build` → `dist/`, `npm run typecheck`, `npm run lint` (0 warnings), `npm start` (Firefox with the extension and both sample links), `npm run package`.
- Layout: `static/` (manifest, icon) is copied to `dist/`. `src/background.ts` handles `downloads` and adds the Koofr Referer through blocking `webRequest`. `src/content/`: `adapters/` (filester, koofr), `downloader.ts` (zip via fflate `ZipPassThrough`, queue), `ui.ts` + `styles.ts` (Shadow DOM panel), `util.ts` (retry/backoff, safe filenames).
- **Change from the original plan:** the download manager runs in the **content script**, not on an extension page. It keeps the host's cookies, Referer and IP-bound tokens simple. Files are saved through the background (`downloads.download`, a blob URL for the zip). If the downloads API is missing (Android?), it falls back to an `<a download>` click.
- Min Firefox 140 (desktop) / 142 (Android), as required by `data_collection_permissions`.
- Already in: retries with backoff (3 tries), 500 ms gap between files, zip warning above 2 GB (500 MB on Android), zip blocked at 4 GB (fflate has no ZIP64), failed files stay selected so pressing Download again retries them.
- **User tested filester + koofr in desktop Firefox (`npm start`) on 2026-10-22: works as expected.** Filester subfolders (`.subfolder-name`) are not handled yet.

## Gofile adapter (written and user-tested on desktop 2026-10-22: works)
- `src/content/adapters/gofile.ts`: from the isolated content script, calls the page's own `window.wrappedJSObject.generateWT(<accountToken cookie>)` and sends the same `/contents` request as gofile's own getFolder through `window.wrappedJSObject.fetch` + `cloneInto` (page context, so the Origin is gofile.io; `content.fetch` does NOT exist in MV3 content scripts). It never forges `wt`. It refuses once the tab is over 5 h old (gofile stops at 6 h). Pages of 100 and subfolders, with a 400 ms gap between API calls. Downloads use each item's `link` (needs the accountToken cookie; zip mode fetches with `credentials: 'include'`). Frozen/overloaded files are reported as failed.
- The content script runs on all of gofile.io. `index.ts` checks the URL every 1 s because gofile is a single-page app; the button shows only on `/d/<id>`.
- Possible failure points: Xray access to the promise from `generateWT`, CORS/cookies for zip-mode fetches from store*.gofile.io.

## Next step
All 3 sites work on desktop Firefox. v0.1.0 signed on AMO as unlisted (2026-10-22) with `npm run sign` (needs WEB_EXT_API_KEY/WEB_EXT_API_SECRET env vars; in PowerShell use `npm.cmd` because script execution is disabled). Signed file: `artifacts/c49d0e36c70e4703b5e0-0.1.0.xpi`. Bump `version` in static/manifest.json (and package.json) before every re-sign. Next: user installs on the phone and tests (Phase 0 questions). Then filester subfolders.

## Phone test 1 (v0.1.0, Firefox Android, 2026-10-22)
- Listing works on all 3 sites, and zip mode downloaded all 32 gofile files into memory. **Every save failed with "Could not establish connection. Receiving end does not exist"**, meaning the background script's onMessage listener was not there. Suspected cause: blocking `webRequest` throws on Android at top level, before onMessage was registered.
- v0.1.1 fix: onMessage is registered first and webRequest is wrapped in try/catch. A new `status` message reports `{downloads, refererFix, problem}` (3 s timeout → treated as unavailable). Saving falls back to an `<a download>` page link when the background can't do it (koofr needs `refererFix` for the downloads API). The panel summary shows the reason ("Saved via page links. …") so the next phone test reveals the root cause.

## Phone test 2 (v0.1.1): same error on all 3 sites
- So the background IS alive (otherwise the status check would have fallen back). Conclusion: on Firefox Android, `browser.downloads.download` exists but itself throws "Could not establish connection. Receiving end does not exist".
- v0.1.2: the background tags errors thrown by `downloads.download` itself with `DOWNLOADS_API_FAILED`. The content script then switches to page links (`<a download>`) for the rest of the page's life and saves the current file that way. Real transfer failures (interrupted) still retry normally.
- v0.1.2 also labels every save error with its step: `[step: background status]`, `[step: sending to background]`, `[step: downloads API]`, `[step: background download]`. The panel footer shows "Grab All v<version>" before a run.

## Phone test 3 (v0.1.2): "[step: sending to background] Could not establish connection. Receiving end does not exist"
- The status message reaches the background, but download messages from the content script fail on Android. Root cause unknown (needs remote debugging via adb).
- v0.1.3: on Android, the content script never uses the background and always saves through `<a download>` page links. On desktop, a send failure also falls back to page links.

## Phone test 4 (v0.1.3): zip mode WORKS on all 3 sites on Android
- One-by-one: each file showed "leave this site?" (our own `beforeunload` guard, because the `<a>` click to another origin counted as navigation), then the Android download prompt for each file.
- v0.1.4: URL saves go through a hidden `<iframe>` instead of a link. The Android download prompt for each file will likely remain (Firefox for Android asks per download), so zip is the hands-free mode on the phone.

## Phone test 5 (v0.1.4): user confirmed everything works on Android
- Zip and one-by-one (hidden iframe) work on all 3 sites. Android still asks per file in one-by-one mode, so zip is the recommended phone mode.
- Next: git repo (being set up), then filester subfolders.

## Name (2026-10-22)
- Renamed to **Grab All**: manifest `name`, package name `grab-all`, panel title, shadow host id `grab-all-root`. The gecko **id stays `bulk-downloader@prashil.local`** on purpose: changing it would make AMO treat it as a new add-on and break updates on the phone. Never change it. The user plans to rename the project folder too.
