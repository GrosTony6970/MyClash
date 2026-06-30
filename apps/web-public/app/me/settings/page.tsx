import SettingsClient from './SettingsClient';

/** `/me/settings` — consolidated settings hub. The client island resolves the
 *  API URL and is locale-aware; this server wrapper stays minimal. */
export default function MeSettingsPage() {
  return <SettingsClient />;
}
