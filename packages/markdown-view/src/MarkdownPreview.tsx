import { useCallback, useRef, useState, useMemo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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

/** @public */
export type MarkdownPreviewProps = {
  readonly source: string;
  readonly editorView?: EditorView;
  readonly currentAuthor?: string;
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
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  return (
    <div
      className={`md-preview${showMargin ? " md-preview--with-margin" : ""}`}
      ref={containerRef}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processedSource}
      </Markdown>
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
