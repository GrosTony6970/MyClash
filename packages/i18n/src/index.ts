export type Locale = 'en' | 'fr';

type MessageLeaf = string;
export type MessageTree = {
  readonly [key: string]: MessageLeaf | MessageTree;
};

export const defaultLocale: Locale = 'en';

export const en = {
  app: {
    name: 'MyClash',
  },
  metadata: {
    publicTitle: 'MyClash',
    publicDescription: 'Free, open-source platform for HEMA event management.',
    adminTitle: 'MyClash Admin',
    adminDescription: 'MyClash organizer admin and super admin.',
    scoringTitle: 'MyClash Scoring',
    scoringDescription: 'Scorekeeper PWA - offline-first match exchange recording.',
  },
  actions: {
    add: 'Add',
    apply: 'Apply',
    approve: 'Approve',
    back: 'Back',
    cancel: 'Cancel',
    clear: 'Clear',
    close: 'Close',
    confirm: 'Confirm',
    continue: 'Continue',
    delete: 'Delete',
    edit: 'Edit',
    export: 'Export',
    import: 'Import',
    next: 'Next',
    previous: 'Previous',
    reject: 'Reject',
    remove: 'Remove',
    reset: 'Reset',
    revert: 'Revert',
    save: 'Save',
    search: 'Search',
    submit: 'Submit',
    sync: 'Sync',
    view: 'View',
  },
  common: {
    all: 'All',
    loading: 'Loading...',
    none: 'None',
    optional: 'Optional',
    required: 'Required',
    unknown: 'Unknown',
    yes: 'Yes',
    no: 'No',
  },
  test: {
    greeting: 'Hello, {name}',
  },
} as const satisfies MessageTree;

// T-1402 owns human-reviewed French copy. Until then, keep the exact same key
// shape and use English fallback values so no UI renders missing-key markers.
export const fr = en;

export const messages = {
  en,
  fr,
} as const;

export type Messages = typeof en;
export type TranslationKey = string;
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;

export function getMessages(locale: Locale | string = defaultLocale): Messages {
  return messages[locale as Locale] ?? messages[defaultLocale];
}

export function createTranslator(source: MessageTree) {
  return (key: TranslationKey, values?: TranslationValues): string => {
    const template = readMessage(source, key);
    if (template === undefined) {
      return `[${key}]`;
    }

    if (!values) {
      return template;
    }

    return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined || value === null ? match : String(value);
    });
  };
}

export const t = createTranslator(getMessages(defaultLocale));

function readMessage(source: MessageTree, key: string): string | undefined {
  let cursor: MessageTree | MessageLeaf | undefined = source;
  for (const part of key.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' ? cursor : undefined;
}
