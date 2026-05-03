import type { Metadata } from 'next';
import { defaultLocale, t } from '@myclash/i18n';
import { I18nProvider } from '../src/i18n/I18nProvider';
import '../src/styles/globals.css';

export const metadata: Metadata = {
  title: t('metadata.publicTitle'),
  description: t('metadata.publicDescription'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={defaultLocale}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
