/**
 * Project listing page. Shows the user's saved projects and available examples.
 * Serves as the landing page for authenticated users.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "jazz-tools/react";
import { VibeDiagramAccount } from "../jazz/schema";
import { exampleProjects, type ExampleMeta } from "@diagram/sim-examples";
import { JazzProjectStore } from "../stores/JazzProjectStore";
import { AuthorizedAccountsSettings } from "./AuthorizedAccountsSettings";
import {
  JAZZ_API_KEY_STORAGE_KEY,
  JAZZ_LOCAL_ONLY_STORAGE_KEY,
} from "../jazz-api-key";

import rawCacheSource from "@diagram/sim-examples/cache-example-source?raw";
import rawLBSource from "@diagram/sim-examples/loadbalancer-example-source?raw";
import rawShapesSource from "@diagram/sim-examples/shapes-example-source?raw";
import rawWorkerPoolSource from "@diagram/sim-examples/worker-pool-example-source?raw";

/** Maps example sourceExport identifiers to their raw source text. */
const exampleSourceMap: Record<string, string> = {
  "@diagram/sim-examples/cache-example-source": rawCacheSource,
  "@diagram/sim-examples/loadbalancer-example-source": rawLBSource,
  "@diagram/sim-examples/shapes-example-source": rawShapesSource,
  "@diagram/sim-examples/worker-pool-example-source": rawWorkerPoolSource,
};

/** Strip `export` keywords so the editor can parse the source as a plain script. */
function stripExports(source: string): string {
  return source.replace(/^export /gm, "");
}

/** Displays the current user's Jazz account ID with a copy-to-clipboard button. */
function AccountIdDisplay({ accountId }: { accountId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(accountId).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      },
      () => {
        // Clipboard write can fail in insecure contexts; silently ignore.
      },
    );
  }, [accountId]);

  return (
    <div className="account-id-display">
      <span className="account-id-label">Your Account ID:</span>
      <code className="account-id-value">{accountId}</code>
      <button
        type="button"
        className="account-id-copy-btn"
        onClick={handleCopy}
        title="Copy account ID"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function ApiKeySettings() {
  const [open, setOpen] = useState(false);
  const stored = localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY) ?? "";
  const isLocalOnly =
    localStorage.getItem(JAZZ_LOCAL_ONLY_STORAGE_KEY) === "true";
  const [value, setValue] = useState(stored);

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    localStorage.removeItem(JAZZ_LOCAL_ONLY_STORAGE_KEY);
    localStorage.setItem(JAZZ_API_KEY_STORAGE_KEY, trimmed);
    window.location.reload();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="api-key-settings-toggle"
        onClick={() => {
          setOpen(true);
        }}
        title="Jazz API key settings"
      >
        Settings
      </button>
    );
  }

  return (
    <div className="api-key-settings-panel">
      {isLocalOnly && (
        <p className="api-key-settings-local-notice">
          Running in local-only mode. Add an API key to enable cloud sync.
        </p>
      )}
      <label className="api-key-settings-label">
        Jazz API Key
        <input
          className="api-key-settings-input"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          placeholder="your-jazz-api-key"
        />
      </label>
      <a
        className="api-key-settings-link"
        href="https://jazz.tools/docs/react/quickstart#get-your-free-api-key"
        target="_blank"
        rel="noopener noreferrer"
      >
        Get a free key
      </a>
      <div className="api-key-settings-actions">
        <button
          type="button"
          className="api-key-settings-save"
          onClick={handleSave}
          disabled={!value.trim() || value.trim() === stored}
        >
          Save & Reload
        </button>
        <button
          type="button"
          className="api-key-settings-cancel"
          onClick={() => {
            setOpen(false);
            setValue(stored);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const ProjectListPage: React.FC = () => {
  const navigate = useNavigate();
  const { me } = useAccount(VibeDiagramAccount, {
    resolve: {
      root: {
        projects: { $each: true },
        authorizedAccounts: { $each: true },
      },
    },
  });

  const store = useMemo(() => (me ? new JazzProjectStore(me) : null), [me]);

  const handleNewProject = useCallback(() => {
    if (!store) return;
    const id = store.createProject("Untitled Project", [
      { path: "/main.ts", content: "" },
    ]);
    if (id) navigate(`/diagram/${id}`);
  }, [store, navigate]);

  const handleOpenExample = useCallback(
    (example: ExampleMeta) => {
      if (!store) return;
      const rawSource = exampleSourceMap[example.sourceExport];
      if (!rawSource) return;
      const content = stripExports(rawSource);
      const id = store.createProject(example.title, [
        { path: "/main.ts", content },
      ]);
      if (id) navigate(`/diagram/${id}`);
    },
    [store, navigate],
  );

  const handleDeleteProject = useCallback(
    (projectId: string) => {
      if (!store) return;
      store.deleteProject(projectId);
    },
    [store],
  );

  if (!me) {
    return (
      <div className="loading-container">
        <h2>Loading...</h2>
        <p>Please wait while we set up your account.</p>
      </div>
    );
  }

  const projectList = store?.listProjects() ?? [];

  return (
    <div className="project-list-page">
      <header className="project-list-header">
        <h1>VibeDiagram</h1>
        <AccountIdDisplay accountId={me.$jazz.id} />
        <div className="project-list-header-actions">
          {store && <AuthorizedAccountsSettings me={me} store={store} />}
          <ApiKeySettings />
          <button
            type="button"
            className="new-project-btn"
            onClick={handleNewProject}
          >
            + New Project
          </button>
        </div>
      </header>

      <section className="project-section">
        <h2>My Projects</h2>
        {projectList.length === 0 ? (
          <p className="empty-state">
            No projects yet. Create one or try an example below.
          </p>
        ) : (
          <div className="project-grid">
            {projectList.map((project) => (
              <div
                key={project.id}
                className="project-card"
                onClick={() => {
                  navigate(`/diagram/${project.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/diagram/${project.id}`);
                }}
                role="button"
                tabIndex={0}
              >
                <div className="project-card-header">
                  <h3>{project.title}</h3>
                  <div className="project-card-actions">
                    <span className={`role-badge role-${project.role}`}>
                      {project.role}
                    </span>
                    {project.role === "admin" && (
                      <button
                        type="button"
                        className="delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id);
                        }}
                        title="Delete project"
                      >
                        x
                      </button>
                    )}
                  </div>
                </div>
                {project.description && (
                  <p className="project-description">{project.description}</p>
                )}
                <p className="project-meta">
                  Last updated:{" "}
                  {new Date(project.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="project-section">
        <h2>Examples</h2>
        <div className="project-grid">
          {exampleProjects.map((example) => (
            <div
              key={example.id}
              className="project-card example-card"
              onClick={() => {
                handleOpenExample(example);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleOpenExample(example);
              }}
              role="button"
              tabIndex={0}
            >
              <div className="project-card-header">
                <h3>{example.title}</h3>
                <span className="example-badge">Example</span>
              </div>
              <p className="project-description">{example.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default ProjectListPage;
