import { AuthPage } from '../login/AuthPage';

/**
 * Signing up is a tab of the login panel, not a separate design. This route
 * stays because it is linked from the marketing site and from mail we have
 * already sent — it just opens the panel on the other tab.
 */
export default function SignupPage() {
  return <AuthPage initialTab="signup" />;
}
