import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { WorkerClient } from "@diagram/ts-worker";

/**
 * Creates the TypeScript hover tooltip extension. Shows quick info from the
 * worker when hovering over symbols.
 */
export function createHoverSource(
  client: WorkerClient,
  path: string,
): (
  view: import("@codemirror/view").EditorView,
  pos: number,
) => Promise<Tooltip | null> {
  return async (_view, pos) => {
    const info = await client.getQuickInfo(path, pos);
    if (!info) {
      return null;
    }

    return {
      pos: info.start,
      end: info.start + info.length,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-ts-tooltip";

        const sig = document.createElement("code");
        sig.style.whiteSpace = "pre-wrap";
        sig.textContent = info.text;
        dom.appendChild(sig);

        const hasDoc = info.documentation.length > 0;
        const hasTags = info.tags.length > 0;

        if (hasDoc || hasTags) {
          const docSection = document.createElement("div");
          docSection.className = "cm-ts-tooltip-doc";
          docSection.style.borderTop = "1px solid #ddd";
          docSection.style.marginTop = "4px";
          docSection.style.paddingTop = "4px";
          docSection.style.whiteSpace = "pre-wrap";

          if (hasDoc) {
            const docText = document.createElement("div");
            docText.textContent = info.documentation;
            docSection.appendChild(docText);
          }

          if (hasTags) {
            const tagsList = document.createElement("div");
            tagsList.style.marginTop = hasDoc ? "4px" : "0";
            for (const tag of info.tags) {
              const tagEl = document.createElement("div");
              tagEl.textContent = tag.text
                ? `@${tag.name} ${tag.text}`
                : `@${tag.name}`;
              tagsList.appendChild(tagEl);
            }
            docSection.appendChild(tagsList);
          }

          dom.appendChild(docSection);
        }

        return { dom };
      },
    };
  };
}

export function tsHoverExtension(
  client: WorkerClient,
  path: string,
): Extension {
  return hoverTooltip(createHoverSource(client, path));
}
