import { afterEach } from 'vitest';

// jsdom's storage lives as long as the test file, so a preference one test saves (the
// Tournament last picked, a zoom) would open the next test's page. Every test starts with
// an empty browser, as it does in a fresh tab.
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
