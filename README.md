# Student Planner — Releases

Public download host for the **Student Planner** desktop app.

The app is a static, offline-first PWA — use it in your browser at
**[planner.danplace.tech](https://planner.danplace.tech)** (installable as a PWA),
or download the desktop build below.

## Downloads

Grab the installer for your platform from the [latest release](../../releases/latest):

- **macOS** — `.dmg` (universal: Apple Silicon + Intel)
- **Windows** — `.exe` / `.msi`
- **Linux** — `.AppImage` / `.deb`

Installed copies **auto-update** from future releases.

> The desktop app is currently unsigned, so macOS Gatekeeper / Windows SmartScreen
> may warn on first launch. Open it via right-click → Open (macOS) or "More info →
> Run anyway" (Windows).

## For maintainers

The app source is in the private `planner` repo. Releases here are built by
`.github/workflows/release.yml`, triggered manually from the **Actions** tab
(pick the `planner` branch/tag to build; the version comes from planner's
`package.json`). See that file's header for the required repo secrets.
