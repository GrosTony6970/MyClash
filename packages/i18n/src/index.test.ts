import assert from 'node:assert/strict';
import {
  createTranslator,
  defaultLocale,
  getMessages,
  messages,
  negotiateLocale,
  type Locale,
} from './index';

function collectKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

assert.equal(defaultLocale, 'en');
assert.equal(getMessages('en').app.name, 'MyClash');
assert.equal(getMessages('fr').app.name, 'MyClash');
assert.equal(getMessages('zz' as Locale).app.name, 'MyClash');

const t = createTranslator({
  greeting: {
    welcome: 'Welcome, {name}.',
  },
  known: 'Known',
});

assert.equal(t('greeting.welcome', { name: 'Tony' }), 'Welcome, Tony.');
assert.equal(t('missing.key'), '[missing.key]');
assert.deepEqual(collectKeys(messages.fr).sort(), collectKeys(messages.en).sort());

// --- negotiateLocale ---
// Cookie is an explicit choice and wins over the header.
assert.equal(negotiateLocale({ cookie: 'fr', acceptLanguage: 'en-US,en;q=0.9' }), 'fr');
assert.equal(negotiateLocale({ cookie: 'en', acceptLanguage: 'fr-FR' }), 'en');
assert.equal(negotiateLocale({ cookie: 'FR' }), 'fr'); // case-insensitive
// Unsupported/garbage cookie is ignored, falls through to the header.
assert.equal(negotiateLocale({ cookie: 'de', acceptLanguage: 'fr-FR,fr;q=0.9' }), 'fr');
assert.equal(negotiateLocale({ cookie: '', acceptLanguage: 'fr' }), 'fr');
// Accept-Language: primary subtag match, highest q wins, q=0 excluded.
assert.equal(negotiateLocale({ acceptLanguage: 'fr-CA,fr;q=0.8,en;q=0.5' }), 'fr');
assert.equal(negotiateLocale({ acceptLanguage: 'en-GB,en;q=0.9,fr;q=0.8' }), 'en');
assert.equal(negotiateLocale({ acceptLanguage: 'de,fr;q=0.7' }), 'fr'); // skip unsupported de
assert.equal(negotiateLocale({ acceptLanguage: 'fr;q=0,en;q=0.5' }), 'en'); // q=0 = unacceptable
// Nothing usable → defaultLocale.
assert.equal(negotiateLocale({}), defaultLocale);
assert.equal(negotiateLocale({ cookie: null, acceptLanguage: null }), defaultLocale);
assert.equal(negotiateLocale({ acceptLanguage: 'de,es;q=0.9' }), defaultLocale);
