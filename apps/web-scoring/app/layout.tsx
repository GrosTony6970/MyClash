import type { Metadata, Viewport } from 'next';
import { defaultLocale, t } from '@myclash/i18n';
import { MaintenanceBanner } from '@myclash/ui';
import { I18nProvider } from '../src/i18n/I18nProvider';
import '../src/styles/globals.css';

export const metadata: Metadata = {
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

export const viewport: Viewport = {
  themeColor: '#c0392b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={defaultLocale}>
      <head>
        <link rel="apple-touch-icon" href="/brand/Logomini_nobackground.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-gray-950 text-white min-h-screen">
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
        {/* Service worker registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(reg) { console.log('SW registered:', reg.scope); })
                    .catch(function(err) { console.warn('SW registration failed:', err); });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
