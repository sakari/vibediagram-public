/** @public */
export {
  parseInlineBody,
  parseBlockBody,
  serializeInlineBody,
  serializeBlockBody,
  appendReply,
  setResolved,
  generateId,
  InvalidBodyError,
  escapeBodyText,
  unescapeBodyText,
  escapeHighlightExact,
  unescapeHighlightExact,
} from "./grammar";
/** @public */
export type {
  Message,
  InlineThread,
  BlockThread,
  BlockTarget,
} from "./grammar";

/** @public */
export {
  preprocessCriticMarkup,
  mapProcessedToOriginal,
  mapProcessedRangeToOriginal,
} from "./preprocess";
/** @public */
export type { MarkerInfo, MarkerSpan, PreprocessResult } from "./preprocess";

/** @public */
export { rehypeCriticmarkup } from "./rehype-criticmarkup";

/** @public */
export { repairCriticMarkup } from "./repair";
/** @public */
export type { Issue, RepairResult } from "./repair";
