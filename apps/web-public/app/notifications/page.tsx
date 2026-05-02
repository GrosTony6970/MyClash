import type { Metadata } from 'next';
import NotificationSettingsClient from './NotificationSettingsClient';

export const metadata: Metadata = {
  title: 'Notifications | MyClash',
  description: 'Manage MyClash push notifications.',
};

export default function NotificationsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  return <NotificationSettingsClient apiUrl={apiUrl} />;
}
