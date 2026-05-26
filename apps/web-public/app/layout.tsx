import type { Metadata } from 'next';
import { defaultLocale, t } from '@myclash/i18n';
import { MaintenanceBanner } from '@myclash/ui';
import { I18nProvider } from '../src/i18n/I18nProvider';
import '../src/styles/globals.css';

export const metadata: Metadata = {
  title: t('metadata.publicTitle'),
  description: t('metadata.publicDescription'),
  icons: {
    icon: '/brand/Logomini_nobackground.png',
    apple: '/brand/Logomini_nobackground.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={defaultLocale}>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded focus:shadow-lg focus:text-sm focus:font-semibold"
        >
          {t('navigation.skipToMainContent')}
        </a>
        <I18nProvider>
          <MaintenanceBanner apiUrl={process.env['NEXT_PUBLIC_API_URL'] ?? ''} />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
