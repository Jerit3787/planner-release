#!/usr/bin/env bash
# Packages a Flutter Linux release bundle as an AppImage.
#
#   scripts/desktop/build-appimage.sh <bundle-dir> <version> <x64|arm64> <out-dir>
#
# The app checks $APPIMAGE (set by the AppImage runtime) to know it can
# replace itself on update.
set -euo pipefail

bundle="$1" version="$2" arch="$3" out="$4"
here="$(cd "$(dirname "$0")" && pwd)"
# Pinned, and checked against the digests GitHub records for these release
# assets: what runs here builds a file the signed manifest then vouches for.
appimagetool_version=1.9.1
runtime_version=20251108
case "$arch" in
  x64)
    tool_arch=x86_64
    tool_sha=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
    runtime_sha=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
    ;;
  arm64)
    tool_arch=aarch64
    tool_sha=f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158
    runtime_sha=00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444
    ;;
  *) echo "::error::unknown arch $arch"; exit 1 ;;
esac

fetch() { # <url> <sha256> <dest>
  curl -fsSL -o "$3" "$1"
  echo "$2  $3" | sha256sum -c --quiet - || { echo "::error::checksum mismatch for $1"; exit 1; }
}

work="$(mktemp -d)"
appdir="$work/StutasticPlanner.AppDir"
mkdir -p "$appdir/usr/lib/stutastic-planner" "$out"
cp -R "$bundle/." "$appdir/usr/lib/stutastic-planner/"
cp "$here/stutastic-planner.desktop" "$appdir/stutastic-planner.desktop"
cp "$bundle/data/app_icon.png" "$appdir/stutastic-planner.png"

# tray_manager 0.5's plugin links libayatana-appindicator at load time, and
# some distros (Fedora Workstation) don't ship it, so it and its own libraries
# travel inside the AppImage. AppRun puts them on the library path. From 0.9
# the tray is nativeapi, which needs none of them: no plugin, nothing to bundle.
mkdir -p "$appdir/usr/lib/stutastic-planner/bundled"
if [ -f "$bundle/lib/libtray_manager_plugin.so" ]; then
  for lib in $(ldd "$bundle/lib/libtray_manager_plugin.so" | awk '/ayatana|dbusmenu/ { print $3 }'); do
    cp -L "$lib" "$appdir/usr/lib/stutastic-planner/bundled/"
  done
  ls "$appdir/usr/lib/stutastic-planner/bundled" | grep -q appindicator \
    || { echo "::error::libayatana-appindicator was not found to bundle"; exit 1; }
fi

cat > "$appdir/AppRun" <<'RUN'
#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
LD_LIBRARY_PATH="$here/usr/lib/stutastic-planner/bundled${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
exec "$here/usr/lib/stutastic-planner/planner" "$@"
RUN
chmod 755 "$appdir/AppRun"

tool="$work/appimagetool"
runtime="$work/runtime"
fetch "https://github.com/AppImage/appimagetool/releases/download/$appimagetool_version/appimagetool-$tool_arch.AppImage" "$tool_sha" "$tool"
fetch "https://github.com/AppImage/type2-runtime/releases/download/$runtime_version/runtime-$tool_arch" "$runtime_sha" "$runtime"
chmod 755 "$tool"
# No FUSE on CI runners.
APPIMAGE_EXTRACT_AND_RUN=1 ARCH="$tool_arch" "$tool" --no-appstream --runtime-file "$runtime" \
  "$appdir" "$out/stutastic-planner-$version-linux-$arch.AppImage"
rm -rf "$work"
