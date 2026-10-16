import { titledInEvent, TitleOnlyLayout } from '@/lib/page-metadata';
import { eventTitleRule } from '../../../e/[eventSlug]/_lib/event-or-not-found';

/**
 * This page is drawn in the browser and cannot name its own tab: this layout
 * does. Its schedule, Tournament and Workshop pages sit below it, so it hands
 * the Event's name on: "My event · Open de Lyon", "My schedule · Open de Lyon".
 */
export const generateMetadata = titledInEvent('publicApp.titles.meEvent', eventTitleRule);

export default TitleOnlyLayout;
