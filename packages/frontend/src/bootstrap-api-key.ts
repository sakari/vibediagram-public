import { JAZZ_API_KEY_STORAGE_KEY } from "./jazz-api-key";

/**
 * Bootstrap the Jazz API key from the URL hash fragment.
 *
 * When redirecting users between Vercel deployments (different origins),
 * localStorage is lost. We pass the API key via the hash fragment
 * (e.g. `#apikey=<value>`) so the target deployment can persist it.
 * The hash is cleared immediately to avoid leaking the key in browser history.
 *
 * Call this before reading the API key from localStorage (i.e. before
 * `getJazzSyncPeer()`).
 */
export function bootstrapApiKeyFromHash(): void {
  const hash = window.location.hash;
  if (!hash.startsWith("#apikey=")) return;

  const apiKey = decodeURIComponent(hash.slice("#apikey=".length));
  if (!apiKey) return;

  localStorage.setItem(JAZZ_API_KEY_STORAGE_KEY, apiKey);
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}
