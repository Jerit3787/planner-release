#!/usr/bin/env bash
# Starts a packaged build and passes if it is still running after 20 seconds,
# so a missing library, a broken AppRun or a crash at launch fails the run.
#
#   scripts/desktop/launch-check.sh <command> [args...]
#
# Runs under a virtual display and its own session bus (the app uses the
# keyring and, on Linux, D-Bus for single instance).
set -uo pipefail

timeout 20 xvfb-run -a dbus-run-session -- "$@"
status=$?
if [ "$status" -eq 124 ]; then
  echo "Still running after 20 seconds: $*"
  exit 0
fi
echo "::error::$* exited with $status before 20 seconds"
exit 1
