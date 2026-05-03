import type { Metadata, Viewport } from 'next';
import { defaultLocale, t } from '@myclash/i18n';
import { I18nProvider } from '../src/i18n/I18nProvider';
import '../src/styles/globals.css';

export const metadata: Metadata = {
  title: t('metadata.scoringTitle'),
  description: t('metadata.scoringDescription'),
  manifest: '/manifest.json',
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
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-gray-950 text-white min-h-screen">
        <I18nProvider>{children}</I18nProvider>
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
