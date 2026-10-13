import { titledAbove, TitleOnlyLayout } from '@/lib/page-metadata';
import { eventTitleRule } from '../_lib/event-or-not-found';

/**
 * This page is drawn in the browser and cannot name its own tab: this layout
 * does. A person's page sits below it, so it hands the Event's rule on.
 */
export const generateMetadata = titledAbove('publicApp.titles.people', eventTitleRule);

export default TitleOnlyLayout;
