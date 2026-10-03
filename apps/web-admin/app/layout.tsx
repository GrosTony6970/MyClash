import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ToastProvider } from '@myclash/ui';
import { AppLegalFooter } from './_components/AppLegalFooter';
import { LegalUpdateBanner } from './_components/LegalUpdateBanner';
import { RuntimeBanner } from './_components/RuntimeBanner';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { getServerT, resolveServerLocale } from '@myclash/next-i18n/server';
import '../src/styles/globals.css';

// Tournament Manual aesthetic — see plan: Fraunces (display, expressive serif),
// Geist (body, distinctive but neutral), JetBrains Mono (codes, slugs, IDs).
// The files are in the repo (packages/ui/src/fonts): a build needs no font server. The Google
// loader fetched them at every build, and a slow answer failed the build and the deploy.
// The Latin file is here; the other subsets are in packages/ui/src/fonts/subsets.css.
const fraunces = localFont({
  src: '../../../packages/ui/src/fonts/fraunces-latin-opsz-normal.woff2',
  // Variable font: the opsz axis gives optical sizing, and every weight is in the one file.
  weight: '100 900',
  variable: '--font-fraunces',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});

const geist = localFont({
  src: '../../../packages/ui/src/fonts/geist-latin-wght-normal.woff2',
  // The weights the apps asked Google for: a heavier or lighter request is clamped, as before.
  weight: '400 700',
  variable: '--font-geist',
  display: 'swap',
});

const jetbrainsMono = localFont({
  src: '../../../packages/ui/src/fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '400 500',
  variable: '--font-jetbrains',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t('metadata.adminTitle'),
    description: t('metadata.adminDescription'),
    icons: {
      icon: '/brand/Logomini_nobackground.png',
      apple: '/brand/Logomini_nobackground.png',
    },
  };
}

// Web-admin is fully auth-gated (super-admin + organizer routes + /login).
// Static prerender produces an empty skeleton that the client immediately
// replaces after cookie-auth + /api/v1 fetch — zero value, and it trips
// Next.js 16's CSR-bailout rule whenever any page uses useSearchParams()
// (e.g. via the useUrlState hook on /admin/organizations). Opt out at the
// layout level so future pages don't need to opt out individually.
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveServerLocale();
  const t = await getServerT();
  return (
    <html
      lang={locale}
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-background font-body text-foreground antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-skip-link focus:px-4 focus:py-2 focus:bg-surface focus:text-foreground focus:rounded focus:shadow-lg focus:text-sm focus:font-semibold"
        >
          {t('navigation.skipToMainContent')}
        </a>
        <I18nProvider locale={locale}>
          <ToastProvider>
            <RuntimeBanner />
            <LegalUpdateBanner />
            {children}
            <AppLegalFooter />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
