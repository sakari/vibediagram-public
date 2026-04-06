import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { JazzReactProvider } from "jazz-tools/react";
import ProjectListPage from "./components/ProjectListPage";
import DiagramWorkspace from "./components/DiagramWorkspace";
import { VibeDiagramAccount } from "./jazz/schema";
import "./App.css";

import {
  JAZZ_API_KEY_STORAGE_KEY,
  JAZZ_LOCAL_ONLY_STORAGE_KEY,
  resolveJazzSyncConfig,
} from "./jazz-api-key";
import { bootstrapApiKeyFromHash } from "./bootstrap-api-key";

// Run at module load time, before any component renders.
bootstrapApiKeyFromHash();

function getJazzSyncConfig() {
  return resolveJazzSyncConfig(
    import.meta.env.VITE_JAZZ_SYNC_PEER,
    localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY),
    localStorage.getItem(JAZZ_LOCAL_ONLY_STORAGE_KEY),
  );
}

/** Prompt the user to enter their Jazz API key before the app can start. */
function ApiKeySetup() {
  const [apiKey, setApiKey] = React.useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    localStorage.setItem(JAZZ_API_KEY_STORAGE_KEY, apiKey.trim());
    window.location.reload();
  }

  function handleLocalOnly() {
    localStorage.setItem(JAZZ_LOCAL_ONLY_STORAGE_KEY, "true");
    window.location.reload();
  }

  return (
    <div className="api-key-setup-backdrop">
      <form className="api-key-setup-card" onSubmit={handleSubmit}>
        <h1 className="api-key-setup-title">Welcome to VibeDiagram</h1>
        <p className="api-key-setup-subtitle">
          Enter your Jazz API key to enable cloud sync, or use locally without
          an account
        </p>
        <a
          className="api-key-setup-link"
          href="https://jazz.tools/docs/react/quickstart#get-your-free-api-key"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get your free API key
        </a>
        <input
          className="api-key-setup-input"
          type="text"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
          }}
          placeholder="your-jazz-api-key"
        />
        <button
          className="api-key-setup-button"
          type="submit"
          disabled={!apiKey.trim()}
        >
          Save & Continue
        </button>
        <div className="api-key-setup-divider">or</div>
        <button
          className="api-key-setup-local-button"
          type="button"
          onClick={handleLocalOnly}
        >
          Use locally without cloud sync
        </button>
      </form>
    </div>
  );
}

function DiagramApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectListPage />} />
        <Route path="/diagram" element={<Navigate to="/projects" replace />} />
        <Route path="/diagram/:diagramId" element={<DiagramWorkspace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  const syncConfig = getJazzSyncConfig();

  if (!syncConfig) {
    return <ApiKeySetup />;
  }

  return (
    <JazzReactProvider
      sync={syncConfig}
      AccountSchema={VibeDiagramAccount}
      defaultProfileName="profile"
    >
      <DiagramApp />
    </JazzReactProvider>
  );
}

export default App;
