import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import NotificationSettingsClient from './NotificationSettingsClient';

export const metadata: Metadata = {
  title: 'Notifications | MyClash',
  description: 'Manage MyClash push notifications.',
};

export default function NotificationsPage() {
  const apiUrl = getApiUrl();
  return <NotificationSettingsClient apiUrl={apiUrl} />;
}
