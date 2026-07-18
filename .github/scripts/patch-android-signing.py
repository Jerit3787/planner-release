#!/usr/bin/env python3
"""Wire real release signing into Tauri v2's generated Android Gradle project.

`tauri android init` regenerates `app/build.gradle.kts` on every CI run with no
real release signing config (release builds fall back to the debug key, which
changes per build so updates can't install over each other). This patches the
freshly-generated file to load `keystore.properties` (written by the workflow
from repo secrets) and sign the release build type with it.

Usage: patch-android-signing.py <path to app/build.gradle.kts>
Idempotent: a no-op if the file already references keystore.properties.
"""
import re
import sys

SIGNING_BLOCK = """
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    val keystoreProperties = Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(FileInputStream(keystorePropertiesFile))
    }
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
"""


def main(path):
    src = open(path).read()

    if "keystore.properties" in src:
        print("build.gradle.kts already patched — nothing to do.")
        return

    for imp in ("import java.io.FileInputStream", "import java.util.Properties"):
        if imp not in src:
            src = imp + "\n" + src

    # Insert the property loading + signingConfigs right after `android {`.
    src, n = re.subn(r"(android\s*\{)", r"\1\n" + SIGNING_BLOCK, src, count=1)
    if n == 0:
        sys.exit("ERROR: could not find the `android {` block to patch.")

    # Point the release build type at the real signing config. Tauri's template
    # usually assigns the debug config there; replace it, else inject one.
    if 'signingConfigs.getByName("debug")' in src:
        src = src.replace(
            'signingConfigs.getByName("debug")',
            'signingConfigs.getByName("release")',
        )
    elif re.search(r'getByName\("release"\)\s*\{', src):
        src = re.sub(
            r'(getByName\("release"\)\s*\{)',
            r'\1\n            signingConfig = signingConfigs.getByName("release")',
            src,
            count=1,
        )
    else:
        sys.exit("ERROR: could not find the release build type to sign.")

    open(path, "w").write(src)

    # Echo the buildTypes region so a bad patch is obvious in the CI log.
    m = re.search(r"buildTypes\s*\{.*?\n    \}", src, re.S)
    print("Patched. Release buildTypes now:")
    print(m.group(0) if m else "[buildTypes block not found for preview]")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: patch-android-signing.py <build.gradle.kts>")
    main(sys.argv[1])
