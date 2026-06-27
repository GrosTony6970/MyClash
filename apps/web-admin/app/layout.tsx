import type { Metadata } from 'next';
import { Fraunces, Geist, JetBrains_Mono } from 'next/font/google';
import { defaultLocale, t } from '@myclash/i18n';
import { MaintenanceBanner, ToastProvider } from '@myclash/ui';
import { I18nProvider } from '../src/i18n/I18nProvider';
import '../src/styles/globals.css';

// Tournament Manual aesthetic — see plan: Fraunces (display, expressive serif),
// Geist (body, distinctive but neutral), JetBrains Mono (codes, slugs, IDs).
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  // Variable font: the opsz axis gives us optical sizing for free, and all
  // weights resolve through the same file.
  axes: ['opsz'],
});

const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-geist',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: t('metadata.adminTitle'),
  description: t('metadata.adminDescription'),
  icons: {
    icon: '/brand/Logomini_nobackground.png',
    apple: '/brand/Logomini_nobackground.png',
  },
};

// Web-admin is fully auth-gated (super-admin + organizer routes + /login).
// Static prerender produces an empty skeleton that the client immediately
// replaces after cookie-auth + /api/v1 fetch — zero value, and it trips
// Next.js 16's CSR-bailout rule whenever any page uses useSearchParams()
// (e.g. via the useUrlState hook on /admin/organizations). Opt out at the
// layout level so future pages don't need to opt out individually.
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={defaultLocale}
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-background font-body text-foreground antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-surface focus:text-foreground focus:rounded focus:shadow-lg focus:text-sm focus:font-semibold"
        >
          {t('navigation.skipToMainContent')}
        </a>
        <I18nProvider>
          <ToastProvider>
            <MaintenanceBanner apiUrl={process.env['NEXT_PUBLIC_API_URL'] ?? ''} />
            {children}
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
