import { titled } from '@/lib/page-metadata';
import NotificationSettingsClient from './NotificationSettingsClient';

export const generateMetadata = titled('publicApp.titles.notifications');

export default function NotificationsPage() {
  return <NotificationSettingsClient />;
}
