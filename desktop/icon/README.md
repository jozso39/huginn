# Huginn's icon

- `huginn-original.png` — the drawing it started from (468 px, orange background).
- `huginn-art.png` — the final artwork, full-bleed, 1024 px: a grey background with a
  gentle gradient (#464A4E → #26282C), a yellow halo (#FFCB2E) centred and 62 % wide,
  and the raven — yellow dot eye, slimmer chest — set left of and above the centre and
  enlarged 6 %, his shoulder and chest carried on along their slopes. Used for the web
  icons and the README.
- `huginn-macos.png` — the same on Apple's icon grid (824 px rounded square on a 1024
  canvas, soft shadow). `bunx tauri icon desktop/icon/huginn-macos.png -o
  desktop/src-tauri/icons` makes the app's icon set from it (then drop the Android, iOS
  and Windows files).
- `../src-tauri/icons/tray.png`, `tray@2x.png` — the menu-bar template: bird and halo
  opaque, background and eye transparent; macOS draws it white or black.

A larger original (≥ 1024 px or SVG) would make the large sizes crisper.
