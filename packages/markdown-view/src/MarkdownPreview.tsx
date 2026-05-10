import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CoordTransform } from "@diagram/draw-overlay";
import type { EditorView } from "@codemirror/view";
import { MermaidBlock } from "./MermaidBlock";
import {
  preprocessCriticMarkup,
  rehypeCriticmarkup,
  mapProcessedToOriginal,
} from "./criticmarkup";
import { rehypeSourcePosition } from "./rehype-source-position";
import { CommentHighlight } from "./comments/CommentHighlight";
import { BlockCommentMarker } from "./comments/BlockCommentMarker";
import { BlockCommentTrigger } from "./comments/BlockCommentTrigger";
import { CommentMargin } from "./comments/CommentMargin";
import { NewCommentPopover } from "./comments/NewCommentPopover";
import { useThreads } from "./comments/useThreads";
import { useTextSelection } from "./comments/selection";
import "./markdown-view.css";

/**
 * @public
 *
 * `renderOverlay` is the optional integration seam for the drawing overlay.
 * When supplied, the markdown content is wrapped in an inner
 * `.md-preview-content` (`position: relative`) container that hosts the
 * overlay and provides a content-coordinate space the overlay's transform
 * can anchor to. Strokes scroll with the markdown content rather than
 * sticking to the viewport.
 */
export type MarkdownPreviewProps = {
  readonly source: string;
  readonly editorView?: EditorView;
  readonly currentAuthor?: string;
  readonly renderOverlay?: (transform: CoordTransform) => ReactNode;
};

const hasCommentAnchorClass = (cn: unknown): boolean =>
  typeof cn === "string" && cn.split(/\s+/).includes("vd-comment-anchor");

const readDataAttr = (props: object, key: string): unknown =>
  Reflect.get(props, key);

type ComponentDeps = {
  readonly onActivate: (id: string) => void;
  readonly editorView?: EditorView;
  readonly currentAuthor: string;
};

// Renders the wrapper around a `<pre>` so we can capture a ref to the wrapper
// without violating Rules of Hooks (the `pre` override would otherwise call
// `useRef` conditionally based on `showTrigger`).
type BlockTriggerWrapperProps = {
  readonly pre: ReactNode;
  readonly editorView: EditorView;
  readonly sourceStart: number;
  readonly currentAuthor: string;
  readonly onActivate: (id: string) => void;
};

function BlockTriggerWrapper({
  pre,
  editorView,
  sourceStart,
  currentAuthor,
  onActivate,
}: BlockTriggerWrapperProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="vd-block-trigger-wrapper" ref={wrapperRef}>
      {pre}
      <BlockCommentTrigger
        editorView={editorView}
        sourceStart={sourceStart}
        currentAuthor={currentAuthor}
        wrapperRef={wrapperRef}
        onActivate={onActivate}
      />
    </div>
  );
}

const buildComponents = (deps: ComponentDeps): Components => {
  const { onActivate, editorView, currentAuthor } = deps;
  const components: Components = {
    code(props) {
      const { className, children, ...rest } = props;
      const match = /language-(\w+)/.exec(className ?? "");
      const lang = match?.[1];
      if (lang === "mermaid" && typeof children === "string") {
        const text = children.replace(/\n$/, "");
        return <MermaidBlock source={text} />;
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    pre(props) {
      const { children, className } = props;
      const sourceStartAttr = readDataAttr(props, "data-source-start");
      const sourceEndAttr = readDataAttr(props, "data-source-end");
      const sourceStart =
        typeof sourceStartAttr === "string"
          ? Number.parseInt(sourceStartAttr, 10)
          : Number.NaN;
      const showTrigger =
        editorView !== undefined && Number.isFinite(sourceStart);
      // Re-attach only the data-source-* attributes; the rehype-injected
      // `node` extra prop is intentionally dropped so it does not leak onto
      // the DOM as `node="[object Object]"`.
      const pre = (
        <pre
          className={typeof className === "string" ? className : undefined}
          data-source-start={
            typeof sourceStartAttr === "string" ? sourceStartAttr : undefined
          }
          data-source-end={
            typeof sourceEndAttr === "string" ? sourceEndAttr : undefined
          }
        >
          {children}
        </pre>
      );
      if (!showTrigger) return pre;
      return (
        <BlockTriggerWrapper
          pre={pre}
          editorView={editorView}
          sourceStart={sourceStart}
          currentAuthor={currentAuthor}
          onActivate={onActivate}
        />
      );
    },
    mark(props) {
      const { className, children } = props;
      const threadId = readDataAttr(props, "data-thread-id");
      const isAnchor =
        typeof threadId === "string" && hasCommentAnchorClass(className);
      if (!isAnchor) {
        return (
          <mark
            className={typeof className === "string" ? className : undefined}
          >
            {children}
          </mark>
        );
      }
      const resolved = readDataAttr(props, "data-resolved") === "true";
      const originalLengthAttr = readDataAttr(props, "data-original-length");
      return (
        <CommentHighlight
          threadId={threadId}
          resolved={resolved}
          onActivate={onActivate}
          originalLength={
            typeof originalLengthAttr === "string"
              ? originalLengthAttr
              : undefined
          }
        >
          {children}
        </CommentHighlight>
      );
    },
    div(props) {
      const threadId = readDataAttr(props, "data-thread-id");
      const target = readDataAttr(props, "data-target");
      const isBlockMarker =
        typeof threadId === "string" &&
        (target === "next" || target === "prev");
      if (!isBlockMarker) {
        return <div>{props.children}</div>;
      }
      const resolved = readDataAttr(props, "data-resolved") === "true";
      const originalLengthAttr = readDataAttr(props, "data-original-length");
      return (
        <BlockCommentMarker
          threadId={threadId}
          target={target}
          resolved={resolved}
          originalLength={
            typeof originalLengthAttr === "string"
              ? originalLengthAttr
              : undefined
          }
        />
      );
    },
  };
  return components;
};

export function MarkdownPreview({
  source,
  editorView,
  currentAuthor,
  renderOverlay,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Inner content wrapper that hosts the drawing overlay (only mounted
  // when `renderOverlay` is supplied). Its bounding rect is the
  // coordinate space the overlay's transform anchors to.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const handleActivate = useCallback((id: string) => {
    setActiveThreadId((cur) => (cur === id ? null : id));
  }, []);
  const handleClosePopover = useCallback(() => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
  }, []);

  const author = currentAuthor ?? "anonymous";

  const {
    source: processedSource,
    markers: markerMap,
    markerSpans,
  } = useMemo(() => preprocessCriticMarkup(source), [source]);
  const rehypePlugins = useMemo(() => {
    // Wrap rehype-source-position so the plugin entry is a Plugin<[]> that
    // captures the per-render mapOffset closure. Avoids the [plugin, opts]
    // tuple form, which `Pluggable` types as a mutable tuple.
    const mapOffset = (offset: number): number =>
      mapProcessedToOriginal(offset, markerSpans);
    const sourcePositionPlugin = () => rehypeSourcePosition({ mapOffset });
    return [sourcePositionPlugin, rehypeCriticmarkup(markerMap, markerSpans)];
  }, [markerMap, markerSpans]);

  const markers = useThreads(containerRef, source);
  const selection = useTextSelection(containerRef);

  // Drawing-overlay subscribers. Mutable Set rather than React state
  // because subscribers fire imperatively on scroll; storing in state
  // would force re-renders and break `useSyncExternalStore` snapshot
  // identity.
  const subs = useRef(new Set<() => void>());
  const transform: CoordTransform = useMemo(
    () => ({
      toContent(clientX, clientY) {
        const el = contentRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
      },
      toScreen(x, y) {
        // The SVG sits inside .md-preview-content, so its local origin
        // is the content wrapper's top-left and a content-coord (x, y)
        // is also the SVG-local point. We still null-guard for an
        // unmounted-then-captured transform.
        const el = contentRef.current;
        if (!el) return null;
        return { left: x, top: y };
      },
      subscribe(cb) {
        subs.current.add(cb);
        return () => {
          subs.current.delete(cb);
        };
      },
    }),
    [],
  );

  // Notify drawing-overlay subscribers on scroll so strokes re-position.
  useEffect(() => {
    const el = containerRef.current;
    /* v8 ignore next */
    if (!el) return;
    const onScroll = () => {
      for (const cb of Array.from(subs.current)) cb();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const components = useMemo(
    () =>
      buildComponents({
        onActivate: handleActivate,
        editorView,
        currentAuthor: author,
      }),
    [handleActivate, editorView, author],
  );

  const showMargin = markers.length > 0;
  // The popover stays mounted whenever an editor is available so it can keep
  // its internal draft/selection-snapshot state across selection changes that
  // happen as soon as the user clicks the textarea.
  const showPopover = editorView !== undefined;

  const markdownContent = (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {processedSource}
    </Markdown>
  );

  return (
    <div
      className={`md-preview${showMargin ? " md-preview--with-margin" : ""}`}
      ref={containerRef}
    >
      {renderOverlay ? (
        <div ref={contentRef} className="md-preview-content">
          {markdownContent}
          {renderOverlay(transform)}
        </div>
      ) : (
        markdownContent
      )}
      {showMargin && (
        <CommentMargin
          containerRef={containerRef}
          markers={markers}
          editorView={editorView}
          currentAuthor={author}
          activeThreadId={activeThreadId}
          onToggle={handleActivate}
        />
      )}
      {showPopover && (
        <NewCommentPopover
          editorView={editorView}
          selection={selection ?? null}
          currentAuthor={author}
          onClose={handleClosePopover}
        />
      )}
    </div>
  );
}
