/**
 * The pages where a visitor becomes signed in WITHOUT a page load: the password
 * form, the OAuth return and the new-password form each end in a client-side
 * navigation.
 *
 * The site header asks `/me` once, when it mounts, and the layout keeps it
 * mounted across such a navigation. `MaybeSiteHeader` keys the header on this
 * answer, so it mounts again, and asks again, when the visitor leaves a door.
 * A page that signs a visitor in or out with a page load needs no entry here.
 */
export function isSignInDoor(path: string | null | undefined): boolean {
  if (!path) return false;
  return path === '/login' || path === '/reset-password' || path.startsWith('/auth/');
}
