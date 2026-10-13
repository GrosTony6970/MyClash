import { siteTitleRule, titledAbove, TitleOnlyLayout } from '@/lib/page-metadata';

/**
 * This page is drawn in the browser and cannot name its own tab: this layout
 * does. Its schedule, Tournament and Workshop pages sit below it, so it hands
 * the site's rule on.
 */
export const generateMetadata = titledAbove('publicApp.titles.meEvent', siteTitleRule);

export default TitleOnlyLayout;
