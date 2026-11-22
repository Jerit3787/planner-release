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
case "$arch" in
  x64) tool_arch=x86_64 ;;
  arm64) tool_arch=aarch64 ;;
  *) echo "::error::unknown arch $arch"; exit 1 ;;
esac

work="$(mktemp -d)"
appdir="$work/StutasticPlanner.AppDir"
mkdir -p "$appdir/usr/lib/stutastic-planner" "$out"
cp -R "$bundle/." "$appdir/usr/lib/stutastic-planner/"
cp "$here/stutastic-planner.desktop" "$appdir/stutastic-planner.desktop"
cp "$bundle/data/app_icon.png" "$appdir/stutastic-planner.png"
cat > "$appdir/AppRun" <<'RUN'
#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
exec "$here/usr/lib/stutastic-planner/planner" "$@"
RUN
chmod 755 "$appdir/AppRun"

tool="$work/appimagetool"
curl -fsSL -o "$tool" \
  "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$tool_arch.AppImage"
chmod 755 "$tool"
# No FUSE on CI runners.
APPIMAGE_EXTRACT_AND_RUN=1 ARCH="$tool_arch" "$tool" --no-appstream "$appdir" \
  "$out/stutastic-planner-$version-linux-$arch.AppImage"
rm -rf "$work"
