const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sources = ['core', 'ui', 'storage', 'content', 'adapters'].flatMap(dir =>
  fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.js')).map(name => `${dir}/${name}`));
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\/.*$/gm, '');

test('extension code never evaluates or injects markup from data', () => {
  for (const file of sources) {
    assert.equal(/\beval\(|new Function\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write|setTimeout\(\s*['"`]/.test(read(file)), false, file);
  }
});

test('extension code does not log, so personal data cannot reach a console', () => {
  for (const file of sources) {
    const code = read(file);
    assert.equal(/console\.(log|info|warn|error|debug|dir|table)/.test(code), false, file);
  }
});

test('quick setup files have no network, telemetry or storage outside chrome.storage.local', () => {
  for (const file of ['core/quicksetup.js', 'core/setupPrompt.js', 'ui/quicksetup.js']) {
    const code = read(file);
    assert.equal(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|localStorage|sessionStorage|indexedDB|chrome\.runtime\.sendMessage|chrome\.storage\.(sync|session)/.test(code), false, file);
  }
});

test('the manifest asks for no new permissions and no host access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions.slice().sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
});

test('personal profile files stay ignored by Git and are not tracked', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const pattern of ['private/', 'profile.json', '*.profile.json']) assert.ok(ignore.includes(pattern), pattern);
});
