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

The app source lives in the private `planner` repo. The existing
`.github/workflows/release.yml` remains the manually dispatched legacy Tauri
release lane. The separate `.github/workflows/testflight.yml` workflow is a
`workflow_dispatch` Flutter iOS/iPadOS + macOS lane: private `planner` dispatches
the exact source commit only after all five required `Tests` checks pass on
`dev`, and `verify-source` validates the matching completed run before
`build-upload` receives the `testflight` environment. A separate Ubuntu job
validates production iOS and macOS release policy for that exact revision
(including macOS's approved `attested` posture) before the protected signing
job starts.

For the TestFlight lane, configure `PLANNER_PAT` as a repository secret with
`Contents:read` and `Actions:read` on private `planner`. The private repository
uses `RELEASE_DISPATCH_PAT` with `Actions:write` on this public repository. The
`testflight` environment must be restricted to the default branch `main`, have
no required reviewer for automatic dev updates, and contain these six secrets:
`TESTFLIGHT_APPLE_ID`, `TESTFLIGHT_APP_SPECIFIC_PASSWORD`,
`TESTFLIGHT_DISTRIBUTION_CERTIFICATE_P12_BASE64`,
`TESTFLIGHT_CERTIFICATE_PASSWORD`, `TESTFLIGHT_IOS_PROFILE_BASE64`, and
`TESTFLIGHT_MACOS_PROFILE_BASE64`. It also needs the non-secret production
variables `POWERSYNC_URL`, `WORKER_URL`, and `GOOGLE_WEB_CLIENT_ID`; the build
sets `PLANNER_ENV=prod`. Never use development service endpoints for a release.

An Apple CLI upload being accepted means **accepted for processing**, not that
the build has completed processing or reached the PE Personal internal group.
Verify both platform results independently; a one-platform upload is a partial
failure requiring follow-up. Build packages are uploaded directly to App Store
Connect and are not retained as GitHub artifacts.

The public download UI lives in the planner site itself (`src/index.html`, the
`#download` section), which reads this repo's latest release via the GitHub API
— there's no separate site to maintain.

</details>
