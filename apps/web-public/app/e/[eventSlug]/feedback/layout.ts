import { titled, TitleOnlyLayout } from '@/lib/page-metadata';

/** This page is drawn in the browser and cannot name its own tab: this layout does. */
export const generateMetadata = titled('publicApp.titles.feedback');

export default TitleOnlyLayout;
