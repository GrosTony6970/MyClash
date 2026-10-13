import { NotFoundCard } from '@/components/NotFoundCard';

/**
 * The not-found page of the whole public site: an address no route answers, and
 * every `notFound()` a page calls. Without this file Next shows its own page,
 * in English, with no way back.
 */
export default function NotFound() {
  return <NotFoundCard />;
}
