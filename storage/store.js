(function (root) {
  const profileApi = typeof require === 'function' ? require('../core/profile') : root.JobAutofiller.profile;
  const answersApi = typeof require === 'function' ? require('../core/answers') : root.JobAutofiller.answers;
  const privateApi = typeof require === 'function' ? require('../core/privatedata') : root.JobAutofiller.privatedata;

  const MAX_REPORTS = 20;

  function area(chromeApi) {
    return chromeApi.storage.local;
  }

  function createStore(chromeApi) {
    async function read(key, fallback) {
      const data = await area(chromeApi).get(key);
      return data[key] === undefined ? fallback : data[key];
    }

    return {
      async getProfile() {
        return profileApi.normalizeProfile(await read('profile', null));
      },
      async saveProfile(profile) {
        await area(chromeApi).set({ profile: profileApi.normalizeProfile(profile) });
      },
      async getAnswers() {
        return answersApi.sanitizeAnswers(await read('answers', []));
      },
      async saveAnswers(answers) {
        await area(chromeApi).set({ answers: answersApi.sanitizeAnswers(answers) });
      },
      async getPrivate() {
        return privateApi.sanitizePrivate(await read('privateData', null));
      },
      async savePrivate(data) {
        await area(chromeApi).set({ privateData: privateApi.sanitizePrivate(data) });
      },
      async clearPrivate() {
        await area(chromeApi).set({ privateData: privateApi.emptyPrivate() });
      },
      async getRole() {
        const role = await read('roleType', '');
        return privateApi.ROLES.includes(role) ? role : '';
      },
      async saveRole(role) {
        await area(chromeApi).set({ roleType: privateApi.ROLES.includes(role) ? role : '' });
      },
      async getReports() {
        return read('reports', []);
      },
      async addReport(report) {
        const reports = await read('reports', []);
        await area(chromeApi).set({ reports: [report].concat(reports).slice(0, MAX_REPORTS) });
      },
      async clearAll() {
        await area(chromeApi).clear();
      }
    };
  }

  const api = { createStore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).storage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
