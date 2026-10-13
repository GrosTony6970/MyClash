import { NotFoundCard } from '@/components/NotFoundCard';
import { requestLoginNeedsRenewal } from '@/lib/login-cookie';

/**
 * The not-found page of the whole public site: an address no route answers, and
 * every `notFound()` a page calls. Without this file Next shows its own page,
 * in English, with no way back.
 *
 * A page the API shows to a club member only is "not found" for a login that
 * ended an hour ago. The card renews such a login and loads the page again.
 */
export default async function NotFound() {
  return <NotFoundCard renewLogin={await requestLoginNeedsRenewal()} />;
}
