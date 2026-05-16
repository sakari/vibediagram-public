import React, { useState } from "react";
import { co } from "jazz-tools";
import {
  type VibeDiagramAccount,
  AuthorizedAccount,
  AuthorizedAccountList,
} from "../jazz/schema";
import type { JazzProjectStore } from "../stores/JazzProjectStore";
import type { Role } from "../stores/ProjectStore";

interface Props {
  me: co.loaded<typeof VibeDiagramAccount>;
  store: JazzProjectStore;
}

export function AuthorizedAccountsSettings({ me, store }: Props) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [role, setRole] = useState<Role>("writer");

  if (!open) {
    return (
      <button
        type="button"
        className="api-key-settings-toggle"
        onClick={() => {
          setOpen(true);
        }}
        title="Manage shared access"
      >
        Shared Access
      </button>
    );
  }

  const list = me.root?.authorizedAccounts;
  const length = list?.length ?? 0;

  function handleAdd() {
    const trimmed = accountId.trim();
    if (!trimmed) return;

    // Prevent duplicates
    if (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i]?.accountId === trimmed) return;
      }
    }

    // Create the list on first use — owned by account since this is personal settings
    let target = list;
    if (!target) {
      const root = me.root;
      if (!root) return;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- personal account-level data
      target = AuthorizedAccountList.create([], { owner: me });
      root.$jazz.set("authorizedAccounts", target);
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- personal account-level data
    const entry = AuthorizedAccount.create(
      { accountId: trimmed, role },
      { owner: me },
    );
    target.$jazz.push(entry);

    // Grant access to all existing projects (async, fire-and-forget)
    void store.addAccountToAllProjects(trimmed, role);

    setAccountId("");
  }

  function handleRemove(index: number) {
    if (!list) return;
    const entry = list[index];
    if (!entry?.accountId) return;
    void store.removeAccountFromAllProjects(entry.accountId);
    list.$jazz.splice(index, 1);
  }

  return (
    <div className="authorized-accounts-panel">
      <div className="authorized-accounts-header">
        <span className="authorized-accounts-title">Shared Access</span>
        <button
          type="button"
          className="api-key-settings-cancel"
          onClick={() => {
            setOpen(false);
          }}
          title="Close the shared access panel"
        >
          Close
        </button>
      </div>
      <p className="authorized-accounts-hint">
        Grant other Jazz accounts access to all your projects. Use this to
        connect fuse-mirror or share with collaborators.
      </p>

      {length > 0 && list && (
        <div className="authorized-accounts-list">
          {Array.from({ length }, (_, i) => {
            const entry = list[i];
            if (!entry) return null;
            return (
              <div key={i} className="authorized-account-row">
                <span className="authorized-account-id">{entry.accountId}</span>
                <span className={`role-badge role-${entry.role}`}>
                  {entry.role}
                </span>
                <button
                  type="button"
                  className="delete-btn"
                  onClick={() => {
                    handleRemove(i);
                  }}
                  title="Remove access"
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="authorized-accounts-add-row">
        <input
          className="api-key-settings-input"
          type="text"
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
          }}
          placeholder="co_z... (account ID)"
        />
        <select
          className="authorized-accounts-role-select"
          value={role}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "reader" || val === "writer" || val === "admin") {
              setRole(val);
            }
          }}
        >
          <option value="reader">reader</option>
          <option value="writer">writer</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          className="api-key-settings-save"
          onClick={handleAdd}
          disabled={!accountId.trim()}
          title="Grant this account access to all your projects"
        >
          Add
        </button>
      </div>
    </div>
  );
}
