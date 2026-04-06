/** localStorage key where the user-supplied Jazz API key is persisted. */
export const JAZZ_API_KEY_STORAGE_KEY = "vibediagram-jazz-api-key";

/** localStorage key indicating the user chose local-only mode (no cloud sync). */
export const JAZZ_LOCAL_ONLY_STORAGE_KEY = "vibediagram-local-only";

type SyncConfig =
  | { peer: `wss://${string}` | `ws://${string}` }
  | { when: "never" };

/**
 * Resolve the Jazz sync configuration from the given inputs.
 *
 * Priority:
 * 1. envSyncPeer (VITE_JAZZ_SYNC_PEER env var)
 * 2. apiKey from localStorage
 * 3. localOnly flag from localStorage
 * 4. null — no mode configured yet
 */
export function resolveJazzSyncConfig(
  envSyncPeer: unknown,
  apiKey: string | null,
  localOnly: string | null,
): SyncConfig | null {
  if (
    typeof envSyncPeer === "string" &&
    (envSyncPeer.startsWith("ws://") || envSyncPeer.startsWith("wss://"))
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
    return { peer: envSyncPeer as `ws://${string}` };
  }

  if (apiKey) {
    return {
      peer: `wss://cloud.jazz.tools/?key=${encodeURIComponent(apiKey)}`,
    };
  }

  if (localOnly === "true") {
    return { when: "never" };
  }

  return null;
}
