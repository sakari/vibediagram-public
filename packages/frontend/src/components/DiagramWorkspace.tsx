import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAccount } from "jazz-tools/react";
import {
  EditorComponent,
  type EditorHandle,
  FileTreePanel,
} from "@diagram/editor";
import {
  DiagramRenderer,
  InputNode,
  type DiagramSpec,
  type DiagramNode,
} from "@diagram/diagram-view";
import type { InputDescriptor } from "@diagram/sim-model";
import { useDiagramDocument } from "../hooks/useJazzDB";
import { VibeDiagramAccount } from "../jazz/schema";
import { JazzProjectStore } from "../stores/JazzProjectStore";
import SimControls from "./SimControls";
import MetricNode from "./MetricNode";
import { useSimulation } from "../hooks/useSimulation";
import { useMetricHistory } from "../hooks/useMetricHistory";
import { JazzFileStoreAdapter } from "../jazz/JazzFileStoreAdapter";
import { SIM_MODEL_EXTRA_LIBS, HELP_FILE_ENTRIES } from "../sim/ambient-types";
import { bundle } from "@diagram/sim-worker";
import { formatMetricValue } from "@diagram/sim-model";
import {
  JAZZ_API_KEY_STORAGE_KEY,
  JAZZ_LOCAL_ONLY_STORAGE_KEY,
} from "../jazz-api-key";

const NODE_TYPES = { metric: MetricNode, simInput: InputNode };
const TS_CONFIG = { module: "ESNext", moduleResolution: "Bundler" };

/**
 * Merge a registered input descriptor (min/max/step/kind/defaultValue),
 * the frontend-owned current value, and the change handler into a `simInput`
 * diagram node's `data`.
 *
 * The slider is fully controlled by `value`, which comes from the frontend's
 * `inputValues` map. `useInputs` seeds the map from `descriptor.defaultValue`
 * as inputs are registered, so the descriptor default is only used here as a
 * safety net for ids not yet present in the map.
 */
function enrichInputNode(
  node: DiagramNode,
  descriptor: InputDescriptor | undefined,
  inputValues: Record<string, number | boolean>,
  setInputValue: (id: string, value: number | boolean) => void,
): DiagramNode {
  // inputValues is authoritative; descriptor.defaultValue is the fallback for
  // ids not yet in the map.
  const value: number | boolean | undefined =
    Object.prototype.hasOwnProperty.call(inputValues, node.id)
      ? inputValues[node.id]
      : descriptor?.defaultValue;
  return {
    ...node,
    data: {
      ...node.data,
      ...(descriptor && {
        inputKind: descriptor.kind,
        min: descriptor.min,
        max: descriptor.max,
        step: descriptor.step,
        defaultValue: descriptor.defaultValue,
      }),
      ...(value !== undefined && { value }),
      onValueChange: setInputValue,
    },
  };
}

// eslint-disable-next-line complexity -- large render component with many UI states
const DiagramWorkspace: React.FC = () => {
  const { diagramId } = useParams<{ diagramId: string }>();
  const navigate = useNavigate();
  const { me } = useAccount(VibeDiagramAccount, {
    resolve: { root: { projects: true } },
  });

  const { document, isLoading } = useDiagramDocument(diagramId);
  const editorRef = useRef<EditorHandle | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sim = useSimulation();
  const metricHistory = useMetricHistory(sim.snapshot, sim.status);

  const [activeFile, setActiveFile] = useState<string | null>("/main.ts");
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [timeWindow, setTimeWindow] = useState<number | null>(null);
  const [forking, setForking] = useState(false);
  const [versionBannerDismissed, setVersionBannerDismissed] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // Local-only mode can never load a shared/cloud-only document. Detect it
  // up-front so we can show rescue actions immediately instead of spinning.
  const localOnlyMode =
    typeof window !== "undefined" &&
    window.localStorage.getItem(JAZZ_LOCAL_ONLY_STORAGE_KEY) === "true";

  // For cloud-sync users we still want a fallback if the doc never arrives
  // (bad/expired API key, network issues, wrong id, etc.).
  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const handle = setTimeout(() => {
      setLoadingTimedOut(true);
    }, 8000);
    return () => {
      clearTimeout(handle);
    };
  }, [isLoading]);

  const readOnlyTreeFiles = useMemo(
    () => [
      ...SIM_MODEL_EXTRA_LIBS.filter((f) => f.path.endsWith(".d.ts")),
      ...HELP_FILE_ENTRIES,
    ],
    [],
  );

  const fileStore = useMemo(() => {
    if (!document || !me) return null;
    const group = document.$jazz.owner;
    return new JazzFileStoreAdapter(document, group);
  }, [document, me]);

  const { inputDescriptors, inputValues, setInputValue } = sim;

  const inputDescriptorMap = useMemo(() => {
    const map = new Map<string, (typeof inputDescriptors)[number]>();
    for (const d of inputDescriptors) {
      map.set(d.id, d);
    }
    return map;
  }, [inputDescriptors]);

  const enrichedSpec = useMemo((): DiagramSpec | null => {
    const base = sim.topology;
    if (!base) return null;

    const hasMetrics = sim.metricsByNode.size > 0;
    const hasInputs = inputDescriptorMap.size > 0;
    // Always enrich when the spec contains simInput nodes: the slider is a
    // fully controlled component and needs `onValueChange` (and `value`)
    // wired in on every render, including before the simulation has ever
    // been started. `inputDescriptorMap` is only populated after the first
    // `init()`, so relying on `hasInputs` here would leave pre-run sliders
    // without an onChange handler and React would silently revert edits.
    const hasInputNodes = base.nodes.some((n) => n.type === "simInput");
    if (!hasMetrics && !hasInputs && !hasInputNodes) return base;

    const enrichedNodes = base.nodes.map((node) => {
      let enriched = node;

      const metrics = sim.metricsByNode.get(node.id);
      if (metrics) {
        const history = metricHistory.get(node.id);
        enriched = {
          ...enriched,
          data: { ...enriched.data, metrics, history, timeWindow },
        };
      }

      if (node.type === "simInput") {
        enriched = enrichInputNode(
          enriched,
          inputDescriptorMap.get(node.id),
          inputValues,
          setInputValue,
        );
      }

      if (node.inlineChildren && node.inlineChildren.length > 0 && hasMetrics) {
        const enrichedInline = node.inlineChildren.map((child) => {
          const childMetrics = sim.metricsByNode.get(child.id);
          if (!childMetrics || childMetrics.length === 0) return child;
          const formatted = childMetrics
            .map((m) => formatMetricValue(m.value.value, m.unit))
            .join(" / ");
          return { ...child, value: formatted };
        });
        enriched = { ...enriched, inlineChildren: enrichedInline };
      }

      return enriched;
    });

    return {
      ...base,
      nodes: enrichedNodes,
      edges: base.edges,
      groups: base.groups,
    };
  }, [
    sim.topology,
    sim.metricsByNode,
    inputDescriptorMap,
    inputValues,
    setInputValue,
    metricHistory,
    timeWindow,
  ]);

  const compileAndBundle = useCallback(
    async (
      gateOnErrors: boolean,
    ): Promise<{ iife: string; hasErrors: boolean } | null> => {
      const editor = editorRef.current;
      if (!editor || !fileStore) return null;

      const tsFiles = fileStore.listFiles().filter((f) => f.endsWith(".ts"));
      const compiledFiles: Record<string, string> = {};
      let hasErrors = false;

      for (const path of tsFiles) {
        const result = await editor.compile(path);
        if (result.diagnostics.some((d) => d.severity === "error")) {
          hasErrors = true;
        }
        if (result.files.length > 0) {
          compiledFiles[result.files[0].path] = result.files[0].content;
        }
      }

      if (gateOnErrors && hasErrors) return { iife: "", hasErrors: true };

      const iife = await bundle(compiledFiles, "/main.js");
      return { iife, hasErrors };
    },
    [fileStore],
  );

  const compileAndPreview = useCallback(async () => {
    try {
      const result = await compileAndBundle(false);
      if (result && result.iife) {
        sim.preview(result.iife);
      }
    } catch {
      // Compile errors are expected during typing
    }
  }, [sim, compileAndBundle]);

  const handleContentChange = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => void compileAndPreview(), 500);
  }, [compileAndPreview]);

  const initialCompileDone = useRef(false);
  const handleActiveTabChange = useCallback(
    (path: string | null) => {
      setActiveFile(path);
      if (!initialCompileDone.current && path !== null) {
        initialCompileDone.current = true;
        handleContentChange();
      }
    },
    [handleContentChange],
  );

  const allReadOnlyFiles = useMemo(
    () => [...SIM_MODEL_EXTRA_LIBS, ...HELP_FILE_ENTRIES],
    [],
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      const readOnly = allReadOnlyFiles.find((f) => f.path === path);
      editorRef.current?.openFile(path, readOnly?.content);
    },
    [allReadOnlyFiles],
  );

  const handleNavigate = useCallback(
    (targetPath: string, targetOffset: number) => {
      const readOnly = allReadOnlyFiles.find((f) => f.path === targetPath);
      editorRef.current?.openFile(targetPath, readOnly?.content, targetOffset);
    },
    [allReadOnlyFiles],
  );

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  const handleReset = useCallback(() => {
    sim.reset();
    setSpeed(1);
    void compileAndPreview();
  }, [sim, compileAndPreview]);

  const handleRun = useCallback(async () => {
    try {
      const result = await compileAndBundle(true);
      if (!result || result.hasErrors) {
        console.error("compile failed: error-level diagnostics present");
        return;
      }
      await sim.init(result.iife);
      sim.setSpeed(speed);
      sim.start();
    } catch (err) {
      console.error("compile failed:", err);
    }
  }, [sim, speed, compileAndBundle]);

  const store = useMemo(() => (me ? new JazzProjectStore(me) : null), [me]);

  const myRole = useMemo(() => {
    if (!document) return undefined;
    const group = document.$jazz.owner;
    return group.myRole();
  }, [document]);

  const canWrite = myRole === "admin" || myRole === "writer";
  const isReadOnly = !canWrite;

  /** Pin the Jazz document to the current deployment so viewers open the same app version. */
  const pinToCurrentDeployment = useCallback(() => {
    if (!document || !canWrite || __DEPLOYMENT_ID__ === "local") return;
    if (document.pinnedDeploymentId === __DEPLOYMENT_ID__) return;
    document.$jazz.set("pinnedDeploymentId", __DEPLOYMENT_ID__);
    document.$jazz.set("pinnedDeploymentUrl", __DEPLOYMENT_URL__);
  }, [document, canWrite]);

  // Auto-pin when the project is loaded and writable
  useEffect(() => {
    pinToCurrentDeployment();
  }, [pinToCurrentDeployment]);

  const showVersionBanner = useMemo(() => {
    if (versionBannerDismissed) return false;
    if (!document?.pinnedDeploymentId) return false;
    if (__DEPLOYMENT_ID__ === "local") return false;
    return document.pinnedDeploymentId !== __DEPLOYMENT_ID__;
  }, [document?.pinnedDeploymentId, versionBannerDismissed]);

  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    if (!document) return;
    const group = document.$jazz.owner;
    const everyoneRole = group.getRoleOf("everyone");
    setIsPublic(everyoneRole === "reader" || everyoneRole === "writer");
  }, [document]);

  const handleTogglePublic = useCallback(
    (makePublic: boolean) => {
      if (!document || myRole !== "admin") return;
      const group = document.$jazz.owner;
      if (makePublic) {
        group.addMember("everyone", "reader");
      } else {
        group.removeMember("everyone");
      }
      setIsPublic(makePublic);
    },
    [document, myRole],
  );

  const handleFork = useCallback(() => {
    if (!document || !store || forking || !diagramId) return;
    setForking(true);
    try {
      const newId = store.forkProject(diagramId, document);
      if (newId) navigate(`/diagram/${newId}`);
    } catch (err) {
      console.error("Fork failed:", err);
    } finally {
      setForking(false);
    }
  }, [document, store, forking, diagramId, navigate]);

  if (!me) {
    return (
      <div className="loading-container">
        <h2>Initializing Jazz...</h2>
        <p>Please wait while we set up your account.</p>
      </div>
    );
  }

  if (isLoading) {
    const showRescue = localOnlyMode || loadingTimedOut;
    return (
      <div className="loading-container">
        <h2>Loading diagram...</h2>
        {showRescue ? (
          <>
            <p>
              {localOnlyMode
                ? "You're in local-only mode, so shared projects from the cloud can't load. Add a Jazz API key to view this one."
                : "This is taking longer than expected. If this is a shared link, your Jazz API key may be missing or invalid."}
            </p>
            <div className="loading-rescue-actions">
              <button
                type="button"
                className="loading-rescue-primary"
                onClick={() => {
                  window.localStorage.removeItem(JAZZ_LOCAL_ONLY_STORAGE_KEY);
                  window.localStorage.removeItem(JAZZ_API_KEY_STORAGE_KEY);
                  window.location.reload();
                }}
              >
                Set up Jazz API key
              </button>
              <button
                type="button"
                className="loading-rescue-secondary"
                onClick={() => {
                  navigate("/projects");
                }}
              >
                Back to my projects
              </button>
            </div>
          </>
        ) : (
          <p>Please wait while we load your diagram.</p>
        )}
      </div>
    );
  }

  if (!document || !fileStore) {
    return (
      <div className="error-container">
        <h2>Diagram not found</h2>
        <p>
          The diagram you're looking for doesn't exist or couldn't be loaded.
        </p>
      </div>
    );
  }

  let collapseLabel: string;
  let collapseIcon: string;
  let splitClass: string;
  let leftPaneClass: string;
  if (editorCollapsed) {
    collapseLabel = "Expand editor";
    collapseIcon = "\u25b6";
    splitClass = "split-container editor-collapsed";
    leftPaneClass = "left-pane collapsed";
  } else {
    collapseLabel = "Collapse editor";
    collapseIcon = "\u25c0";
    splitClass = "split-container";
    leftPaneClass = "left-pane";
  }

  const leadingControls = (
    <>
      <button
        type="button"
        className="sim-btn sim-btn-back"
        onClick={() => {
          navigate("/projects");
        }}
        title="Back to all projects"
      >
        {"← All projects"}
      </button>
      <button
        type="button"
        className="editor-collapse-toggle"
        onClick={() => {
          setEditorCollapsed((prev) => !prev);
        }}
        aria-label={collapseLabel}
        title={collapseLabel}
      >
        {collapseIcon}
      </button>
    </>
  );

  return (
    <div className="workspace-container">
      <SimControls
        status={sim.status}
        simTime={sim.snapshot?.simTime ?? null}
        error={sim.error}
        speed={speed}
        timeWindow={timeWindow}
        onRun={() => {
          void handleRun();
        }}
        onPause={sim.pause}
        onResume={sim.start}
        onStep={sim.step}
        onReset={handleReset}
        onSetSpeed={(v) => {
          setSpeed(v);
          sim.setSpeed(v);
        }}
        onSetTimeWindow={setTimeWindow}
        leading={leadingControls}
        projectTitle={document.title}
        onTitleChange={
          isReadOnly
            ? undefined
            : (title) => {
                document.$jazz.set("title", title);
                document.$jazz.set("updatedAt", new Date().toISOString());
              }
        }
        onFork={handleFork}
        forkDisabled={forking}
        readOnly={isReadOnly}
        isPublic={isPublic}
        onTogglePublic={handleTogglePublic}
        canManageAccess={myRole === "admin"}
      />
      {isReadOnly && (
        <div className="readonly-banner">
          <span>This project is read-only.</span>
          <button
            className="sim-btn sim-btn-primary"
            onClick={handleFork}
            disabled={forking}
          >
            {forking ? "Forking..." : "Fork to edit"}
          </button>
        </div>
      )}
      {showVersionBanner && (
        <div className="version-mismatch-banner">
          <span>This simulation was last run on a different app version.</span>
          <button
            className="sim-btn sim-btn-primary"
            onClick={() => {
              const url = document.pinnedDeploymentUrl;
              if (url && diagramId && url.endsWith(".vercel.app")) {
                const apiKey = localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY);
                const hash = apiKey
                  ? `#apikey=${encodeURIComponent(apiKey)}`
                  : "";
                window.location.href = `https://${url}/diagram/${diagramId}${hash}`;
              }
            }}
          >
            Open in pinned version
          </button>
          <button
            className="sim-btn"
            onClick={() => {
              setVersionBannerDismissed(true);
            }}
          >
            Run on current version
          </button>
          <button
            className="sim-btn"
            onClick={() => {
              pinToCurrentDeployment();
              setVersionBannerDismissed(true);
            }}
          >
            Migrate to latest
          </button>
        </div>
      )}
      <div className={splitClass}>
        <div
          className={leftPaneClass}
          aria-hidden={editorCollapsed || undefined}
        >
          <div className="editor-with-tree">
            <div
              className={`file-tree-sidebar${fileTreeCollapsed ? " collapsed" : ""}`}
            >
              <button
                type="button"
                className="file-tree-toggle"
                onClick={() => {
                  setFileTreeCollapsed((prev) => !prev);
                }}
                aria-label={
                  fileTreeCollapsed ? "Expand file tree" : "Collapse file tree"
                }
              >
                {fileTreeCollapsed ? "\u25b6" : "\u25c0"}
              </button>
              {!fileTreeCollapsed && (
                <FileTreePanel
                  fileStore={fileStore}
                  onSelect={handleFileSelect}
                  activeFile={activeFile}
                  theme="dark"
                  readOnlyFiles={readOnlyTreeFiles}
                  readOnly={isReadOnly}
                />
              )}
            </div>
            <EditorComponent
              ref={editorRef}
              fileStore={fileStore}
              initialFile="/main.ts"
              tsConfig={TS_CONFIG}
              extraLibs={SIM_MODEL_EXTRA_LIBS}
              theme="dark"
              className="editor-pane"
              onActiveTabChange={handleActiveTabChange}
              onContentChange={isReadOnly ? undefined : handleContentChange}
              onNavigate={handleNavigate}
              readOnly={isReadOnly}
            />
          </div>
        </div>
        <div className="right-pane">
          {enrichedSpec ? (
            <DiagramRenderer
              spec={enrichedSpec}
              nodeTypes={NODE_TYPES}
              className="diagram-pane"
            />
          ) : sim.previewError ? (
            <div className="preview-error">
              <p>{sim.previewError}</p>
            </div>
          ) : (
            <div className="preview-placeholder">
              <p>Write simulation code to see the diagram</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiagramWorkspace;
