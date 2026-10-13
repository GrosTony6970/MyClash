import { siteTitleRule, titledAbove, TitleOnlyLayout } from '@/lib/page-metadata';

/**
 * This page is drawn in the browser and cannot name its own tab: this layout
 * does. The pages of one Event sit below it, so it hands the site's rule on.
 */
export const generateMetadata = titledAbove('publicApp.titles.meEvents', siteTitleRule);

export default TitleOnlyLayout;
