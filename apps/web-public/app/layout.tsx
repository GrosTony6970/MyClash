import type { Metadata } from 'next';
import { Fraunces, Geist, JetBrains_Mono } from 'next/font/google';
import { defaultLocale, t } from '@myclash/i18n';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { MaybeSiteHeader } from './_components/MaybeSiteHeader';
import { RuntimeBanner } from './_components/RuntimeBanner';
import '../src/styles/globals.css';

// Tournament Manual aesthetic — same font stack as apps/web-admin.
// Fraunces (variable serif, page H1), Geist (body), JetBrains Mono (codes).
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
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
    <html
      lang={defaultLocale}
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-stone-50 font-body text-slate-900 antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded focus:shadow-lg focus:text-sm focus:font-semibold"
        >
          {t('navigation.skipToMainContent')}
        </a>
        <I18nProvider>
          <RuntimeBanner />
          <MaybeSiteHeader />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
