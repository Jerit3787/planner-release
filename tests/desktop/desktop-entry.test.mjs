import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Review M9: the dock matches the window to this entry by class (the Linux
// runner sets its program name to the app id), and the icon is the one the
// packages install.
const entry = readFileSync(new URL('../../scripts/desktop/stutastic-planner.desktop', import.meta.url), 'utf8');

test('the desktop entry names the window class and the installed icon', () => {
    assert.match(entry, /^StartupWMClass=com\.danishstudioproduction\.planner$/m);
    assert.match(entry, /^Icon=stutastic-planner$/m);
    assert.match(entry, /^Exec=stutastic-planner %U$/m);
});
