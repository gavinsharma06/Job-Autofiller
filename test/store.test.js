const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../storage/store');
const { sampleProfile } = require('./helpers');

function fakeChrome() {
  const data = {};
  return {
    data,
    storage: {
      local: {
        async get(key) { return key in data ? { [key]: data[key] } : {}; },
        async set(items) { Object.assign(data, JSON.parse(JSON.stringify(items))); },
        async clear() { Object.keys(data).forEach(key => delete data[key]); }
      }
    }
  };
}

test('profile round trips and unknown fields are dropped', async () => {
  const chromeApi = fakeChrome();
  const store = createStore(chromeApi);
  assert.equal((await store.getProfile()).personal.firstName, '');
  await store.saveProfile(Object.assign(sampleProfile(), { password: 'x' }));
  const loaded = await store.getProfile();
  assert.equal(loaded.personal.firstName, 'Jane');
  assert.equal('password' in chromeApi.data.profile, false);
});

test('answers are sanitized on save', async () => {
  const store = createStore(fakeChrome());
  await store.saveAnswers([{ label: 'Notice period', answer: '2 weeks' }, { label: 'Gender', answer: 'x' }]);
  assert.deepEqual((await store.getAnswers()).map(item => item.label), ['Notice period']);
});

test('only the most recent reports are kept', async () => {
  const store = createStore(fakeChrome());
  for (let i = 0; i < 25; i++) await store.addReport({ n: i });
  const reports = await store.getReports();
  assert.equal(reports.length, 20);
  assert.equal(reports[0].n, 24);
});

test('clearAll removes everything', async () => {
  const chromeApi = fakeChrome();
  const store = createStore(chromeApi);
  await store.saveProfile(sampleProfile());
  await store.clearAll();
  assert.deepEqual(chromeApi.data, {});
});
