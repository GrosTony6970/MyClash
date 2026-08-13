import type { MessageTree } from '../../message-tree.js';

export const legal = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  footerNote: 'MyClash — open source, AGPL-3.0',
  accept: {
    // {terms} and {privacy} are rendered as links by the form.
    label: 'I have read and agree to the {terms} and the {privacy}.',
    required: 'Please accept the Terms of Service and the Privacy Policy to continue.',
    stale:
      'The Terms of Service or the Privacy Policy have changed. Reload the page and accept the current version.',
  },
  guestNotice: 'By continuing you agree to the {terms} and the {privacy}.',
  banner: {
    title: 'Our terms have been updated',
    body: 'Please review and accept the current version to keep using MyClash.',
    review: 'Review and accept',
    accepting: 'Saving…',
    dismiss: 'Later',
  },
  settings: {
    title: 'Your agreements',
    description: 'What you have accepted, and when.',
    acceptedOn: 'Accepted {date}',
    version: 'Version {version}',
    outdated: 'A newer version has been published',
    notAccepted: 'Not yet accepted',
    acceptCurrent: 'Accept the current version',
  },
} as const satisfies MessageTree;
