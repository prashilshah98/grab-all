# Grab All

A Firefox extension (desktop and Android) that adds a floating **Download all** button to file-host folder pages. It downloads every file in the folder, either as **one zip** or **one by one** in an automatic queue, so you don't have to click through dozens of files by hand.

## Supported sites

| Site | Folder links |
|---|---|
| [Gofile](https://gofile.io) | `gofile.io/d/<id>` (including subfolders) |
| [Filester](https://filester.me) | `filester.me/f/<id>` (all pages) |
| [Koofr](https://koofr.net) | `app.koofr.net/links/<id>` and `k00.fr` short links (including subfolders) |

## Features

- File list with checkboxes, so you can pick which files to download
- **Zip mode**: everything goes into one `.zip` file (store-only, no recompression)
- **One-by-one mode**: each file is saved separately, with a short pause between files
- Progress display, cancel, and automatic retries with backoff. Files that still fail stay selected, so pressing Download again retries only those.
- Warns about very large zips and blocks zips over 4 GB (use one-by-one mode instead)
- Plain HTML/CSS in a Shadow DOM, with no framework, so it stays light on phones

### Notes for Firefox for Android

- **Zip mode is the recommended mode on Android.** In one-by-one mode, Firefox for Android asks for confirmation on every file.
- The zip is built in memory. On a phone, keep it under about 500 MB.

## Install

The extension is signed through AMO as an **unlisted** add-on, so it isn't searchable on addons.mozilla.org.

1. Get the signed `.xpi` (made with `npm run sign`, see below).
2. **Desktop:** open `about:addons` → gear icon → *Install Add-on From File…*
3. **Android:** Firefox for Android only installs add-ons from a file after you turn on its hidden debug menu:
   1. Download the `.xpi` to the phone.
   2. In Firefox, open **Settings → About Firefox** and tap the Firefox logo **5 times**, until it says the debug menu is enabled.
   3. Go back to **Settings**. Near the bottom, tap **Install add-on from file** and pick the `.xpi`.

## Development

Requirements: Node.js 20+ and Firefox 140+ (Android: 142+).

```bash
npm install
npm run build        # bundle into dist/
npm run watch        # rebuild on every change
npm start            # launch Firefox with the extension and sample links
npm run typecheck    # TypeScript check
npm run lint         # web-ext lint
npm run package      # unsigned .zip in artifacts/
```

### Signing a release

1. Bump `version` in both `static/manifest.json` and `package.json`.
2. Set your AMO API credentials, then run the sign script:

   ```powershell
   $env:WEB_EXT_API_KEY = "user:..."
   $env:WEB_EXT_API_SECRET = "..."
   npm.cmd run sign
   ```

   The signed `.xpi` is written to `artifacts/`.

> Never change the gecko id (`bulk-downloader@prashil.local`) in the manifest. AMO would treat the add-on as a new one, and installed copies would stop getting updates.

## Project layout

```
static/            manifest.json and icon (copied into dist/)
src/background.ts  downloads API and the Koofr Referer fix
src/content/
  index.ts         site detection and the floating button
  adapters/        one adapter per site (gofile, filester, koofr), registered in adapters/index.ts
  downloader.ts    zip mode (fflate) and queue mode
  ui.ts, styles.ts the Shadow DOM panel
  types.ts         shared types
  util.ts          retry/backoff and safe filenames
src/shared/        message types shared by the content and background scripts
build.mjs          esbuild config
```

To add a site, write a new adapter in `src/content/adapters/`. It needs `matches(url)` and `listFiles()`, which returns each file's name, size and URL. Then register it in `src/content/adapters/index.ts`. Also add the site's domain to the content script `matches` in `static/manifest.json`.

## Roadmap

- Filester subfolders
- Bunkr (any `bunkr.*` domain)

## Disclaimer

For personal use. Only download content you have the right to download, and respect each site's terms of service.
