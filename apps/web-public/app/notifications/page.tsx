import type { Metadata } from 'next';
import NotificationSettingsClient from './NotificationSettingsClient';

export const metadata: Metadata = {
  title: 'Notifications | MyClash',
  description: 'Manage MyClash push notifications.',
};

export default function NotificationsPage() {
  return <NotificationSettingsClient />;
}
