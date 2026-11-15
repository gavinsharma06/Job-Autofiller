(function (root) {
  const SCRIPT_PREFIX = 'jaf-';

  // Access is requested for the current secure hostname only, never a wildcard.
  function sitePattern(urlText) {
    let url;
    try {
      url = new URL(urlText);
    } catch (error) {
      return { error: 'This page cannot have a button.' };
    }
    if (url.protocol !== 'https:') return { error: 'The page button works on secure (https) sites only.' };
    return { pattern: `${url.protocol}//${url.hostname}/*`, hostname: url.hostname };
  }

  function reason(error) {
    return String(error && error.message || error);
  }

  function launcherPresent() {
    return Boolean(document.querySelector('[data-job-autofiller="launcher"]'));
  }

  // Must be called straight from a click so Chrome still sees the user gesture
  // when permissions.request runs. Returns { ok, stage, message } and never throws.
  async function enableOnTab(chromeApi, tab, files) {
    const site = sitePattern(tab && tab.url);
    if (site.error) return { ok: false, stage: 'page', message: site.error };

    let granted;
    try {
      granted = await chromeApi.permissions.request({ origins: [site.pattern] });
    } catch (error) {
      return { ok: false, stage: 'permission', message: `Chrome refused the access request: ${reason(error)}` };
    }
    if (!granted) return { ok: false, stage: 'denied', message: 'Access was not granted, so no button was added.' };

    let warning = '';
    try {
      const id = SCRIPT_PREFIX + site.hostname.replace(/[^a-z0-9]+/gi, '-');
      const existing = await chromeApi.scripting.getRegisteredContentScripts({ ids: [id] });
      if (!existing.length) {
        await chromeApi.scripting.registerContentScripts([{
          id, matches: [site.pattern], js: files, runAt: 'document_idle', persistAcrossSessions: true
        }]);
      }
    } catch (error) {
      warning = ` The button could not be saved for future visits: ${reason(error)}`;
    }

    try {
      const target = { tabId: tab.id };
      await chromeApi.scripting.executeScript({ target, files });
      const [check] = await chromeApi.scripting.executeScript({ target, func: launcherPresent });
      if (!check || !check.result) {
        return { ok: false, stage: 'inject', message: `The scripts ran but no button appeared on ${site.hostname}.${warning}` };
      }
    } catch (error) {
      return { ok: false, stage: 'inject', message: `Access granted, but the button could not be added to this tab: ${reason(error)}${warning}` };
    }
    return { ok: true, stage: 'done', hostname: site.hostname, message: `Button added on ${site.hostname}. Press Alt+Shift+F or use the button on the page.${warning}` };
  }

  const api = { sitePattern, enableOnTab };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).site = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
