import { redirect } from 'next/navigation';

// A push tap opens /notifications (the API's workers send that address). The inbox lives in the
// personal space, whose shell renews a lapsed login and asks a signed-out visitor to sign in; this
// bare page did neither, so its read was refused and it said "no messages" (quick-win M5).
// Kept as a redirect so the address of every push already sent still opens the inbox.
export default function NotificationsPage() {
  redirect('/me/notifications');
}
