const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = require('../core/site');

const root = path.join(__dirname, '..');
const FILES = ['core/text.js', 'content/launcher.js'];
const TAB = { id: 7, url: 'https://fortra.wd12.myworkdayjobs.com/en-US/FortraCareers/job/x/apply' };

function fakeChrome(options) {
  const calls = { requested: [], registered: [], injected: [] };
  const opts = Object.assign({ grant: true, registered: [], present: true }, options);
  return {
    calls,
    permissions: {
      async request(query) {
        calls.requested.push(query);
        if (opts.requestThrows) throw new Error(opts.requestThrows);
        return opts.grant;
      }
    },
    scripting: {
      async getRegisteredContentScripts() { return opts.registered; },
      async registerContentScripts(items) {
        if (opts.registerThrows) throw new Error(opts.registerThrows);
        calls.registered.push(items);
      },
      async executeScript(details) {
        calls.injected.push(details);
        if (opts.injectThrows) throw new Error(opts.injectThrows);
        if (details.func) return [{ result: opts.present }];
        return [];
      }
    }
  };
}

test('access is requested for the current secure hostname only', () => {
  assert.deepEqual(site.sitePattern(TAB.url), { pattern: 'https://fortra.wd12.myworkdayjobs.com/*', hostname: 'fortra.wd12.myworkdayjobs.com' });
  assert.equal(site.sitePattern('https://example.com:8443/apply').pattern, 'https://example.com/*');
  assert.ok(site.sitePattern('http://example.com/').error);
  assert.ok(site.sitePattern('chrome://extensions').error);
  assert.ok(site.sitePattern(undefined).error);
});

test('every requested pattern is covered by the optional permission in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const declared = manifest.optional_host_permissions;
  assert.deepEqual(declared, ['https://*/*']);
  const covered = pattern => declared.some(item => new RegExp(`^${item.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*').replace('[^/]*/[^/]*$', '[^/]+/.*$')}`).test(pattern) || (item === 'https://*/*' && /^https:\/\/[^/*]+\/\*$/.test(pattern)));
  ['https://fortra.wd12.myworkdayjobs.com/en-US/x', 'https://boards.greenhouse.io/a', 'https://jobs.lever.co/b'].forEach(url => {
    assert.ok(covered(site.sitePattern(url).pattern), url);
  });
  assert.equal(covered('*://*.myworkdayjobs.com/*'), false);
});

test('success: requests, registers, injects and confirms the button', async () => {
  const chromeApi = fakeChrome();
  const result = await site.enableOnTab(chromeApi, TAB, FILES);
  assert.equal(result.ok, true);
  assert.deepEqual(chromeApi.calls.requested, [{ origins: ['https://fortra.wd12.myworkdayjobs.com/*'] }]);
  assert.equal(chromeApi.calls.registered[0][0].matches[0], 'https://fortra.wd12.myworkdayjobs.com/*');
  assert.equal(chromeApi.calls.registered[0][0].persistAcrossSessions, true);
  assert.deepEqual(chromeApi.calls.injected[0].target, { tabId: 7 });
  assert.match(result.message, /Button added/);
});

test('an existing registration is not registered twice', async () => {
  const chromeApi = fakeChrome({ registered: [{ id: 'x' }] });
  assert.equal((await site.enableOnTab(chromeApi, TAB, FILES)).ok, true);
  assert.equal(chromeApi.calls.registered.length, 0);
});

test('permission denied is reported and nothing is injected', async () => {
  const chromeApi = fakeChrome({ grant: false });
  const result = await site.enableOnTab(chromeApi, TAB, FILES);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'denied');
  assert.equal(chromeApi.calls.injected.length, 0);
});

test('a refused permission request is reported instead of thrown', async () => {
  const result = await site.enableOnTab(fakeChrome({ requestThrows: 'not in optional permissions' }), TAB, FILES);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'permission');
  assert.match(result.message, /not in optional permissions/);
});

test('registration failure still injects now and says what failed', async () => {
  const result = await site.enableOnTab(fakeChrome({ registerThrows: 'quota exceeded' }), TAB, FILES);
  assert.equal(result.ok, true);
  assert.match(result.message, /could not be saved for future visits: quota exceeded/);
});

test('injection failure and a missing button are both reported', async () => {
  const failed = await site.enableOnTab(fakeChrome({ injectThrows: 'cannot access page' }), TAB, FILES);
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, 'inject');
  assert.match(failed.message, /cannot access page/);
  const missing = await site.enableOnTab(fakeChrome({ present: false }), TAB, FILES);
  assert.equal(missing.ok, false);
  assert.match(missing.message, /no button appeared/);
});

test('non secure pages are rejected before any permission prompt', async () => {
  const chromeApi = fakeChrome();
  const result = await site.enableOnTab(chromeApi, { id: 1, url: 'http://example.com/' }, FILES);
  assert.equal(result.ok, false);
  assert.equal(chromeApi.calls.requested.length, 0);
});

test('popup asks for permission straight from the click, before any other await', () => {
  const source = fs.readFileSync(path.join(root, 'ui/popup.js'), 'utf8');
  const body = /async function enableSite\(\) \{([\s\S]*?)\n  \}/.exec(source)[1];
  assert.match(source, /let activeTab = null;/);
  assert.ok(body.indexOf('activeTab ||') < body.indexOf('enableOnTab'));
  assert.equal(/WORKDAY|\*:\/\//.test(source), false);
  assert.match(body, /catch \(error\)/);
});
