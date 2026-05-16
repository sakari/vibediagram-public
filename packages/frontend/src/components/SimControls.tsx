import React from "react";

interface SimControlsProps {
  /** Optional leading element rendered before the title (e.g. back button). */
  leading?: React.ReactNode;
  /** Fork the current project into a new copy. */
  onFork?: () => void;
  /** Whether the fork button should be disabled (e.g. while forking is in progress). */
  forkDisabled?: boolean;
  /** Whether the project is publicly readable. */
  isPublic?: boolean;
  /** Toggle public/private access on the project. */
  onTogglePublic?: (makePublic: boolean) => void;
  /** Whether the current user can change public access (admin only). */
  canManageAccess?: boolean;
  /** Current project title (shown in the toolbar). */
  projectTitle?: string;
  /** Called when the user edits the project title. */
  onTitleChange?: (title: string) => void;
  /** Whether the project is read-only for the current user. */
  readOnly?: boolean;
}

const SimControls: React.FC<SimControlsProps> = ({
  leading,
  onFork,
  forkDisabled,
  projectTitle,
  onTitleChange,
  isPublic,
  onTogglePublic,
  canManageAccess,
  readOnly,
}) => {
  return (
    <div className="sim-controls">
      <div className="sim-controls-buttons">
        {leading}
        {projectTitle !== undefined && (
          <input
            className="sim-title-input"
            value={projectTitle}
            onChange={(e) => onTitleChange?.(e.target.value)}
            aria-label="Project title"
            spellCheck={false}
            readOnly={readOnly || !onTitleChange}
          />
        )}

        {onFork && (
          <button
            className="sim-btn"
            onClick={onFork}
            disabled={forkDisabled}
            title="Create your own editable copy of this project"
          >
            {forkDisabled ? "Forking..." : "Fork"}
          </button>
        )}

        {canManageAccess && onTogglePublic && (
          <button
            className={`sim-btn ${isPublic ? "sim-btn-public" : ""}`}
            onClick={() => {
              onTogglePublic(!isPublic);
            }}
            title={
              isPublic
                ? "This project is publicly readable. Click to make private."
                : "This project is private. Click to make publicly readable."
            }
          >
            {isPublic ? "Public" : "Private"}
          </button>
        )}
      </div>
    </div>
  );
};

export default SimControls;
