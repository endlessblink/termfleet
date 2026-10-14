import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The phone shows the TermFleet logo on its home screen. The phone fetches the
// icon and manifest without the sign-in cookie, so they must load before sign-in.
const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'bridge/server.mjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app/manifest.webmanifest'), 'utf8'));

test('the page links a manifest and a home-screen icon', () => {
  assert.match(html, /<link rel="manifest" href="\/app\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/app\/apple-touch-icon\.png">/);
});

test('every listed icon exists and is served before the sign-in check', () => {
  const files = [...manifest.icons.map(icon => icon.src), '/app/apple-touch-icon.png', '/app/favicon-32.png', '/app/manifest.webmanifest'];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, 'app', file.slice(5))), `${file} exists`);
    assert.ok(server.includes(`'${file}'`), `${file} is public`);
  }
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'), 'Android gets a maskable icon');
  assert.ok(server.indexOf('PUBLIC_APP_FILES.has(url.pathname)') < server.indexOf('if (!currentUser(req))'), 'icons load before the sign-in check');
});
