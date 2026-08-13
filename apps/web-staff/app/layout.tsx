import type { Metadata, Viewport } from 'next';
import { Fraunces, Geist, JetBrains_Mono } from 'next/font/google';
import { MaintenanceBanner } from '@myclash/ui';
import { HeartbeatRunner } from '../src/components/HeartbeatRunner';
import { OfflineDrillBanner } from '../src/components/OfflineDrillBanner';
import { ServiceWorkerRegistration } from '../src/components/ServiceWorkerRegistration';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { getServerT, resolveServerLocale } from '@myclash/next-i18n/server';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { resolveServerTheme } from '../src/theme/server-theme';
import { padScopeFor } from '../src/theme/theme';
import '../src/styles/globals.css';

// Tournament Manual aesthetic — same font stack as apps/web-admin and
// apps/web-public. Load-bearing, not decoration: src/styles/globals.css imports
// packages/ui/src/theme.css, which declares
//   --font-display: var(--font-fraunces), ..., Georgia, serif
// so an app that imports the theme but never DEFINES --font-fraunces produces
// valid CSS with correct colours that silently renders in Georgia. This app did
// exactly that until 2026-07-17. `pnpm design:lint` now asserts it can't recur.
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t('metadata.scoringTitle'),
    description: t('metadata.scoringDescription'),
    manifest: '/manifest.json',
    icons: {
      icon: '/brand/Logomini_nobackground.png',
      apple: '/brand/Logomini_nobackground.png',
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: t('metadata.scoringTitle'),
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#b91c1c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await resolveServerLocale();
  const t = await getServerT();
  // The pad scope goes on <body> and everything inherits it; chrome regions
  // (header, corrections drawer, lice lists) re-scope themselves from the
  // ThemeProvider. This layout is the ONLY writer of the body attribute — the
  // switcher changes the cookie and refreshes rather than touching the DOM.
  const themeMode = await resolveServerTheme();
  return (
    <html
      lang={locale}
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <link rel="apple-touch-icon" href="/brand/Logomini_nobackground.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body
        data-theme={padScopeFor(themeMode)}
        className="bg-background font-body text-foreground min-h-screen antialiased"
      >
        {/* `strong` rather than white-on-black: the dark scope inverts
            --color-strong, so the skip link stays high-contrast on either
            surface without knowing which one it landed on. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-skip-link focus:px-4 focus:py-2 focus:bg-strong focus:text-strong-foreground focus:rounded focus:shadow-lg focus:text-sm focus:font-semibold"
        >
          {t('navigation.skipToMainContent')}
        </a>
        <I18nProvider locale={locale}>
          <ThemeProvider mode={themeMode}>
            <MaintenanceBanner apiUrl={process.env['NEXT_PUBLIC_API_URL'] ?? ''} />
            {/* Above everything, on every route: a drill the crew can navigate
                away from the reminder of is a drill someone forgets is
                running — and a forgotten drill is a real match not syncing. */}
            <OfflineDrillBanner />
            {children}
            <HeartbeatRunner />
          </ThemeProvider>
        </I18nProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
