/**
 * The escaping convention, turned from prose into something an edit cannot
 * quietly break.
 *
 * mail-templates.ts states it in its own header: every interpolated value goes
 * through `escapeHtml`. Nothing enforced it. mail.service.test.ts spot-checks
 * two templates through the service, and three more — notificationHtml,
 * eventPassHtml and ownerWelcomeHtml — were executed by nothing at all, because
 * every consumer mocks MailService wholesale.
 *
 * The property is *every interpolated value*, not "every user-supplied field".
 * The logo URL and the action URLs are built by the app rather than typed by a
 * person, so a test that poisoned only user-supplied fields would leave the two
 * escapes inside the private `renderHeader` and `button` helpers unfalsifiable —
 * they could be deleted and nothing would go red.
 *
 * The table below is the guard: it is compared against the module's own export
 * list, so a new template cannot be added without a row here.
 */
import { describe, expect, it } from 'vitest';
import * as templates from './mail-templates';
import {
  broadcastHtml,
  emailChangeHtml,
  eventPassHtml,
  magicLinkHtml,
  notificationHtml,
  ownerWelcomeHtml,
  renderHeader,
} from './mail-templates';

/** Carries all five characters the escaper handles, in one payload. */
const POISON = `<script>alert("x&y's")</script>`;
const ESCAPED = '&lt;script&gt;alert(&quot;x&amp;y&#39;s&quot;)&lt;/script&gt;';

const LOGO = 'https://cdn.example.com/brand/logo.png';

type Values = Record<string, string>;
const s = (values: Values, key: string): string => values[key] ?? '';

interface TemplateCase {
  name: string;
  /** Benign defaults for every value the template interpolates, logo included. */
  base: Values;
  render(values: Values): string;
}

const CASES: TemplateCase[] = [
  {
    name: 'renderHeader',
    base: { logoUrl: LOGO },
    render: (v) => renderHeader(s(v, 'logoUrl')),
  },
  {
    name: 'magicLinkHtml',
    base: {
      logoUrl: LOGO,
      magicLink: 'https://admin.example.com/login?token_hash=abc',
      displayName: 'Ada Fencer',
    },
    render: (v) =>
      magicLinkHtml(s(v, 'logoUrl'), {
        magicLink: s(v, 'magicLink'),
        type: 'claim',
        displayName: s(v, 'displayName'),
      }),
  },
  {
    name: 'notificationHtml',
    base: {
      logoUrl: LOGO,
      title: 'Your next bout',
      body: 'Piste 2 in ten minutes.',
      actionUrl: 'https://app.example.com/me',
    },
    render: (v) =>
      notificationHtml(s(v, 'logoUrl'), {
        title: s(v, 'title'),
        body: s(v, 'body'),
        actionUrl: s(v, 'actionUrl'),
      }),
  },
  {
    name: 'broadcastHtml',
    base: {
      logoUrl: LOGO,
      title: 'Venue change',
      body: 'Use hall B.',
      actionUrl: 'https://app.example.com/events/demo',
    },
    render: (v) =>
      broadcastHtml(s(v, 'logoUrl'), {
        title: s(v, 'title'),
        body: s(v, 'body'),
        actionUrl: s(v, 'actionUrl'),
        severity: 'alert',
      }),
  },
  {
    name: 'emailChangeHtml',
    base: {
      logoUrl: LOGO,
      oldEmail: 'old@example.com',
      newEmail: 'new@example.com',
      confirmUrl: 'https://api.example.com/email-change/confirm?token=abc',
      expiresAt: '2026-08-19T16:00:00.000Z',
      displayName: 'Ada Fencer',
    },
    render: (v) =>
      emailChangeHtml(s(v, 'logoUrl'), {
        oldEmail: s(v, 'oldEmail'),
        newEmail: s(v, 'newEmail'),
        confirmUrl: s(v, 'confirmUrl'),
        expiresAt: s(v, 'expiresAt'),
        displayName: s(v, 'displayName'),
      }),
  },
  {
    name: 'eventPassHtml',
    base: {
      logoUrl: LOGO,
      displayName: 'Ada Fencer',
      eventName: 'Demo Open',
      passUrl: 'https://app.example.com/pass/abc',
    },
    render: (v) =>
      eventPassHtml(s(v, 'logoUrl'), {
        displayName: s(v, 'displayName'),
        eventName: s(v, 'eventName'),
        passUrl: s(v, 'passUrl'),
      }),
  },
  {
    name: 'ownerWelcomeHtml',
    base: {
      logoUrl: LOGO,
      to: 'organizer@example.com',
      displayName: 'Ada Fencer',
      orgName: 'Demo Club',
      temporaryPassword: 'not-a-real-password',
      loginUrl: 'https://admin.example.com/login',
      orgUrl: 'https://app.example.com/orgs/demo',
    },
    render: (v) =>
      ownerWelcomeHtml(s(v, 'logoUrl'), {
        to: s(v, 'to'),
        displayName: s(v, 'displayName'),
        orgName: s(v, 'orgName'),
        temporaryPassword: s(v, 'temporaryPassword'),
        loginUrl: s(v, 'loginUrl'),
        orgUrl: s(v, 'orgUrl'),
      }),
  },
];

describe('the escaping convention covers every template in the module', () => {
  it('has a case for every function mail-templates exports', () => {
    const exported = Object.entries(templates)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();

    expect(CASES.map((c) => c.name).sort()).toEqual(exported);
  });
});

for (const template of CASES) {
  describe(`${template.name} escapes every interpolated value`, () => {
    for (const field of Object.keys(template.base)) {
      it(`escapes ${field}`, () => {
        const html = template.render({ ...template.base, [field]: POISON });

        expect(html).not.toContain(POISON);
        expect(html).toContain(ESCAPED);
      });
    }
  });
}

describe('notificationHtml action button', () => {
  it('renders the button only when there is somewhere to go', () => {
    const withAction = notificationHtml(LOGO, {
      title: 'Your next bout',
      body: 'Piste 2 in ten minutes.',
      actionUrl: 'https://app.example.com/me',
    });
    const withoutAction = notificationHtml(LOGO, {
      title: 'Your next bout',
      body: 'Piste 2 in ten minutes.',
    });

    expect(withAction).toContain('Ouvrir MyClash / Open MyClash');
    expect(withoutAction).not.toContain('Ouvrir MyClash / Open MyClash');
  });
});
