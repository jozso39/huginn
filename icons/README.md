# Huginn's images

Every image of Huginn lives here; the app, the web app and the README point at these
files. (The logos of the sources Huginn connects to are UI parts of the web app, in
`web/src/assets/logos`.)

## `source/` — the artwork

- `huginn-original.png` — the drawing it started from (468 px, orange background).
- `huginn-art.png` — the final artwork, full-bleed, 1024 px: a grey background with a
  gentle gradient (#464A4E → #26282C), a yellow halo (#FFCB2E) centred and 62 % wide,
  and the raven — yellow dot eye, slimmer chest — set left of and above the centre and
  enlarged 6 %, his shoulder and chest carried on along their slopes.
- `huginn-macos.png` — the same on Apple's icon grid (824 px rounded square on a 1024
  canvas, soft shadow). The README shows it, and `app/` is made from it.
- `social-preview.png` — the repository's preview on GitHub, 1280 × 640 (GitHub keeps
  its own copy: Settings → Social preview).

A larger original (≥ 1024 px or SVG) would make the large sizes crisper.

## `app/` — the Mac app

Used by `desktop/tauri.conf.json` (the app icon) and `desktop/src/lib.rs` (the menu bar).

- `32x32.png` … `icon.png`, `icon.icns` — made from `source/huginn-macos.png` with
  `bunx tauri icon icons/source/huginn-macos.png -o icons/app`; then delete the Android,
  iOS and Windows files it adds.
- `tray.png`, `tray@2x.png` (22 and 44 px) — the menu-bar template: bird and halo
  opaque, background and eye transparent; macOS draws it white or black.

The loading page (`desktop/loading/index.html`) carries `source/huginn-macos.png` at
144 px inline, as a `data:` URL, so the page needs no file of its own. After changing the
art: `sips -Z 144 icons/source/huginn-macos.png --out /tmp/huginn.png && base64 -i
/tmp/huginn.png`, and put the result after `base64,` there.

## `web/` — the web app

Vite's `publicDir` (see `vite.config.ts`): served at `/` and copied into `web/dist`.

- `favicon.png` (64 px) — the browser tab icon, for development in a browser.
- `logo.png` (96 px) — the logo in the app's header.
