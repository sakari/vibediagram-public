export * from "./store/index.js";
export { EditorStateManager } from "./state/index.js";
export {
  EditorComponent,
  type EditorProps,
  type EditorHandle,
  type CompileResult,
} from "./EditorComponent.js";
export { TabBar } from "./TabBar.js";
export {
  ReferencesPanel,
  type ReferenceItem,
  type ReferencesPanelProps,
} from "./ReferencesPanel.js";
export {
  FileTreePanel,
  type FileTreePanelProps,
} from "./tree/FileTreePanel.js";
export {
  tsExtensions,
  tsLintExtension,
  tsAutocompleteExtension,
  tsHoverExtension,
  tsGoToDefExtension,
  tsReferencesExtension,
  tsSyncExtension,
  isRemote,
} from "./ts-extensions/index.js";
