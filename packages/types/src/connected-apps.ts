/**
 * The apps a person has connected to their account, as `GET /api/v1/me/connected-apps` answers.
 * The API writes this shape (`connected-apps.service.ts`); the security page reads it back. The
 * generated client has no response type for the route, so this file is the one owner.
 */

/** One connected app. `clientId` is only a key and the disconnect argument: never shown. */
export interface ConnectedApp {
  clientId: string;
  name: string;
  /** ISO time the person agreed. */
  grantedAt: string;
}

export interface ConnectedApps {
  apps: ConnectedApp[];
}
