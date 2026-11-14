const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeProfile } = require('../core/profile');

test('the example profile matches the current schema', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../profile.example.json'), 'utf8'));
  assert.deepEqual(normalizeProfile(raw), raw);
  assert.match(raw.personal.email, /@example\.com$/);
});
