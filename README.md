<div align="center">

<img src="https://raw.githubusercontent.com/Jerit3787/planner-release/main/docs/icon.svg" width="72" alt="Student Planner" />

# Student Planner — Releases

**Offline-first planner for classes, homework, quizzes, finals, and your GPA.**

[![Latest release](https://img.shields.io/github/v/release/Jerit3787/planner-release?label=latest&color=1e88e5)](https://github.com/Jerit3787/planner-release/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Jerit3787/planner-release/total?color=1e88e5)](https://github.com/Jerit3787/planner-release/releases)
&nbsp;·&nbsp; macOS · Windows · Linux · Android

### [⬇️ Download](https://planner.danplace.tech/#download) &nbsp;·&nbsp; [🌐 Web app](https://planner.danplace.tech) &nbsp;·&nbsp; [📖 Docs](https://docs.planner.danplace.tech)

</div>

---

This repository hosts the downloadable **desktop and Android builds** of Student Planner.
The best way to grab the app is the **[download section on planner.danplace.tech](https://planner.danplace.tech/#download)**,
which auto-detects your platform — or go straight to the **[latest release](https://github.com/Jerit3787/planner-release/releases/latest)**.

Prefer not to install anything? Student Planner runs entirely in your browser and installs as a
PWA at **[planner.danplace.tech](https://planner.danplace.tech)**.

<details>
<summary><b>Downloads by platform</b></summary>

Each [release](https://github.com/Jerit3787/planner-release/releases/latest) includes:

| Platform | File |
| --- | --- |
| 🍎 macOS (Apple Silicon + Intel) | `.dmg` |
| 🪟 Windows | `-setup.exe` / `.msi` |
| 🐧 Linux | `.AppImage` · `.deb` · `.rpm` |
| 🤖 Android | `.apk` (release-signed) |

Installed copies **auto-update** from future releases. Desktop builds are currently unsigned, so
on first launch macOS may need right-click → **Open** and Windows **More info → Run anyway**.
Every release lists **SHA-256 checksums** so you can verify your download.

</details>

<details>
<summary><b>Minimum supported versions</b></summary>

| Platform | Minimum | Notes |
| --- | --- | --- |
| 🍎 macOS | **13.0 (Ventura)** | Universal build (Apple Silicon + Intel) |
| 🪟 Windows | **10** (1809) or later | x64 or ARM64; the WebView2 Runtime auto-installs if missing |
| 🐧 Linux | `webkit2gtk-4.1` — **Ubuntu 22.04 / Debian 12** or newer, roughly | Prebuilt binaries are compiled on Ubuntu 24.04 runners (glibc ≥2.39); AppImage is the most portable format on an older base |
| 🤖 Android | **7.0 (API 24)** or later | Sideloaded APK |

See the [full system requirements page](https://docs.planner.danplace.tech/getting-started/system-requirements/)
(also covers the web app/PWA) for details.

</details>

<details>
<summary><b>For maintainers</b></summary>

The app source lives in the private `planner` repo. Releases here are built by
`.github/workflows/release.yml` (run it from the **Actions** tab; it checks out the private
code via `PLANNER_PAT`, builds every platform, signs them, and publishes here). The public
download UI lives in the planner site itself (`src/index.html`, the `#download` section), which
reads this repo's latest release via the GitHub API — there's no separate site to maintain.

</details>
