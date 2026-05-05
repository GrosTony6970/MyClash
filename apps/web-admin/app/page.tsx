import Image from 'next/image';
import { t } from '@myclash/i18n';

export default function HomePage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center bg-white p-8 text-center text-gray-950"
    >
      <Image
        src="/brand/Logo_nobackground.png"
        alt={t('metadata.adminTitle')}
        width={112}
        height={112}
        priority
        className="mb-5 h-28 w-28"
      />
      <h1 className="text-4xl font-bold">{t('metadata.adminTitle')}</h1>
      <p className="mt-4 text-lg text-gray-600">{t('admin.home.description')}</p>
      <p className="mt-2 text-sm text-gray-400">{t('admin.home.placeholder')}</p>
    </main>
  );
}
