'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createTranslator,
  defaultLocale,
  getMessages,
  type Locale,
  type TranslationValues,
} from '@myclash/i18n';

type Translator = (key: string, values?: TranslationValues) => string;
type I18nContextValue = {
  locale: Locale;
  t: Translator;
};

const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  t: createTranslator(getMessages(defaultLocale)),
});

export function I18nProvider({
  children,
  locale = defaultLocale,
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(getMessages(locale)),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
