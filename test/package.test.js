const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const exists = file => fs.existsSync(path.join(root, file));

test('manifest is MV3 with minimal permissions and existing entry points', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(exists(manifest.action.default_popup));
  assert.ok(exists(manifest.options_page));
});

test('every file injected by the popup exists', () => {
  const source = fs.readFileSync(path.join(root, 'ui/popup.js'), 'utf8');
  const block = /CONTENT_FILES = \[([\s\S]*?)\];/.exec(source)[1];
  const files = block.match(/'[^']+'/g).map(item => item.slice(1, -1));
  assert.ok(files.length > 5);
  files.concat(['content/launcher.js']).forEach(file => assert.ok(exists(file), file));
});

test('scripts referenced by the extension pages exist', () => {
  for (const page of ['ui/popup.html', 'ui/options.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
      assert.ok(exists(path.join(path.dirname(page), match[1])), `${page} -> ${match[1]}`);
    }
  }
});

test('extension code makes no network calls', () => {
  const dirs = ['adapters', 'content', 'core', 'storage', 'ui'];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (!file.endsWith('.js')) continue;
      const source = fs.readFileSync(path.join(root, dir, file), 'utf8');
      assert.equal(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\/(?!www\.w3\.org)/.test(source.replace(/\/\/.*$/gm, '')), false, `${dir}/${file}`);
    }
  }
});
