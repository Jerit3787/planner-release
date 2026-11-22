#!/usr/bin/env bash
# Packages a Flutter Linux release bundle as a .deb.
#
#   scripts/desktop/build-deb.sh <bundle-dir> <version> <x64|arm64> <out-dir>
#
# Named stutastic-planner, not student-planner: that is the old Tauri app's
# package, and taking its name would uninstall it before its users have moved
# their data over.
set -euo pipefail

bundle="$1" version="$2" arch="$3" out="$4"
here="$(cd "$(dirname "$0")" && pwd)"
case "$arch" in
  x64) deb_arch=amd64 ;;
  arm64) deb_arch=arm64 ;;
  *) echo "::error::unknown arch $arch"; exit 1 ;;
esac

root="$(mktemp -d)/stutastic-planner"
mkdir -p "$root/DEBIAN" "$root/opt/stutastic-planner" "$root/usr/bin" \
  "$root/usr/share/applications" "$root/usr/share/pixmaps" "$out"
cp -R "$bundle/." "$root/opt/stutastic-planner/"
ln -s /opt/stutastic-planner/planner "$root/usr/bin/stutastic-planner"
cp "$here/stutastic-planner.desktop" "$root/usr/share/applications/"
cp "$bundle/data/app_icon.png" "$root/usr/share/pixmaps/stutastic-planner.png"

size="$(du -sk "$root" | cut -f1)"
# tray_manager 0.5's plugin needs libayatana at run time; 0.9 (nativeapi)
# doesn't, and GTK 3 already brings X11 and Xi.
depends='libgtk-3-0 | libgtk-3-0t64, libsecret-1-0'
if [ -f "$bundle/lib/libtray_manager_plugin.so" ]; then
  depends="$depends, libayatana-appindicator3-1"
fi
cat > "$root/DEBIAN/control" <<CONTROL
Package: stutastic-planner
Version: $version
Section: education
Priority: optional
Architecture: $deb_arch
Installed-Size: $size
Depends: $depends
Maintainer: DanPlace
Homepage: https://docs.planner.danplace.tech
Description: Stutastic Planner
 Classes, deadlines and grades in one place.
CONTROL

dpkg-deb --root-owner-group --build "$root" \
  "$out/stutastic-planner_${version}_${deb_arch}.deb"
