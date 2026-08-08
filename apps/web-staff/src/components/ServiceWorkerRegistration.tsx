/**
 * Registers the offline service worker.
 *
 * A blocking inline <script> rather than a `useEffect`, on purpose: the pad is
 * used on venue wifi that drops mid-bout, so the worker has to be claimed as
 * early as possible rather than after React hydrates. Extracted from the root
 * layout only so the layout stays readable — the markup is unchanged.
 */
export function ServiceWorkerRegistration() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(reg) { console.log('SW registered:', reg.scope); })
                    .catch(function(err) { console.warn('SW registration failed:', err); });
                });
              }
            `,
      }}
    />
  );
}
