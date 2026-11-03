import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../../../../src/i18n/I18nProvider';
import { RestorePreviewCard, type RestorePreview } from './RestorePreviewCard';

/**
 * The preview says how many images the copy gets as its own files, and how many keep their old
 * link (rulings 403, 408), one and many, in both languages.
 */
const preview = (images: number, imagesKept: number): RestorePreview => ({
  scope: 'event',
  include: 'structure',
  source: { eventName: 'Open 2025' },
  counts: {},
  images,
  imagesKept,
  warnings: [],
  canRestore: true,
});

const render = (value: RestorePreview, locale: 'en' | 'fr' = 'en') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <RestorePreviewCard
        preview={value}
        confirmation=""
        onConfirmation={() => undefined}
        restoreClosed={false}
        onRestore={() => undefined}
      />
    </I18nProvider>,
  );

describe('RestorePreviewCard: the images of the copy', () => {
  it('says nothing of images when the archive carries none', () => {
    expect(render(preview(0, 0))).not.toContain('image');
  });

  it('counts the images stored with the copy and those that keep their link', () => {
    const html = render(preview(5, 1));
    expect(html).toContain('5 images will be stored with the copy.');
    expect(html).toContain('1 image keeps its old link.');
  });

  it('uses the singular for one and the plural for more', () => {
    const html = render(preview(1, 2));
    expect(html).toContain('1 image will be stored with the copy.');
    expect(html).toContain('2 images keep their old link.');
  });

  it('says it in French', () => {
    const html = render(preview(2, 1), 'fr');
    expect(html).toContain('2 images seront enregistrées avec la copie.');
    expect(html).toContain('1 image garde son ancien lien.');
  });
});
