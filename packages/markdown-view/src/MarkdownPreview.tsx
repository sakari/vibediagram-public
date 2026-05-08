import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";
import "./markdown-view.css";

const components: Components = {
  code(props) {
    const { className, children, ...rest } = props;
    const match = /language-(\w+)/.exec(className ?? "");
    const lang = match?.[1];
    // react-markdown v10 always passes a string child for fenced code blocks
    // even though the typed signature is `ReactNode`. The guard narrows the
    // type so the mermaid branch never sees a non-string node.
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
};

export function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="md-preview">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  );
}
