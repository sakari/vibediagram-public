import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a single Mermaid diagram from its source text.
 *
 * Lazy-imports the `mermaid` library on first render so the ~560 KB chunk is
 * only fetched when a markdown document actually contains a mermaid fence.
 * On render failure, falls back to a `.md-mermaid-error` block that shows the
 * error message above the original source.
 */
export function MermaidBlock({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "_");
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  // Skip re-initializing on subsequent renders of the same instance.
  // `mermaid.initialize` is idempotent and cheap, so the worst case is a few
  // redundant calls when many diagrams mount at once.
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const loadMermaid = async () => {
      const mod = await import("mermaid");
      const mermaid = mod.default;
      if (!initializedRef.current) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
        });
        initializedRef.current = true;
      }
      return mermaid;
    };
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg, bindFunctions } = await mermaid.render(
          `mmd-${reactId}`,
          source,
        );
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        setError(undefined);
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, reactId]);

  // Always mount the div so `ref.current` is available when the source flips
  // from invalid back to valid; without this, the success-path `setError(undefined)`
  // would be skipped because the div had been unmounted under the error pre.
  return (
    <>
      {error !== undefined && (
        <pre className="md-mermaid-error">
          Mermaid error: {error}
          {"\n\n"}
          {source}
        </pre>
      )}
      <div
        ref={ref}
        className="md-mermaid"
        style={error !== undefined ? { display: "none" } : undefined}
      />
    </>
  );
}
