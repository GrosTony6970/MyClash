import assert from 'node:assert/strict';
import { createTranslator, defaultLocale, getMessages, messages, type Locale } from './index';

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
