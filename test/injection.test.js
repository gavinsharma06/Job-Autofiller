const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { sampleProfile } = require('./helpers');

const root = path.join(__dirname, '..');
const popupSource = fs.readFileSync(path.join(root, 'ui/popup.js'), 'utf8');
const files = /CONTENT_FILES = \[([\s\S]*?)\];/.exec(popupSource)[1].match(/'[^']+'/g).map(item => item.slice(1, -1));

function inject(html, stored) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://careers.example.com/apply', runScripts: 'outside-only' });
  const listeners = [];
  const data = Object.assign({}, stored);
  dom.window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.2.0' }),
      onMessage: { addListener: listener => listeners.push(listener) }
    },
    storage: {
      local: {
        async get(key) { return key in data ? { [key]: data[key] } : {}; },
        async set(items) { Object.assign(data, items); }
      }
    }
  };
  dom.window.Element.prototype.scrollIntoView = () => {};
  const load = () => files.forEach(file => dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8')));
  load();
  const send = message => new Promise(resolve => listeners[0](message, {}, resolve));
  return { dom, send, data, load, listeners };
}

test('files injected in popup order register one working message handler', async () => {
  const { dom, send, data } = inject(
    '<label for="e">Email</label><input id="e" type="email"><label for="q">Favourite colour</label><input id="q">',
    { profile: sampleProfile() }
  );
  const response = await send({ type: 'fill' });
  assert.equal(dom.window.document.getElementById('e').value, 'jane.sample@example.com');
  assert.equal(response.counts.filled, 1);
  assert.equal(response.counts.review, 1);
  assert.equal(JSON.stringify(response).includes('jane.sample'), false);
  assert.equal(data.reports.length, 1);
  assert.equal(data.reports[0].host, 'careers.example.com');

  dom.window.document.getElementById('q').value = 'Green';
  const learn = await send({ type: 'learn' });
  assert.equal(JSON.stringify(learn.items.map(item => [item.label, item.value])), JSON.stringify([['Favourite colour', 'Green']]));
  assert.equal(data.answers, undefined);

  assert.equal((await send({ type: 'focus', index: 1 })).ok, true);
  await send({ type: 'clear' });
  assert.equal(dom.window.document.querySelector('[data-jaf]'), null);
});

test('injecting twice does not register a second handler', () => {
  const { load, listeners } = inject('<input>', { profile: sampleProfile() });
  load();
  assert.equal(listeners.length, 1);
});

test('fill refuses to run without a profile', async () => {
  const { send, dom } = inject('<label for="e">Email</label><input id="e" type="email">', {});
  assert.equal((await send({ type: 'fill' })).error, 'no_profile');
  assert.equal(dom.window.document.getElementById('e').value, '');
});
