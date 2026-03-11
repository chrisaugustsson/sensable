import { useState } from "react";
import { SpecViewer } from "./spec-viewer";
import { ArtifactList } from "./artifact-list";

interface DeliverContentProps {
  featureId: string;
  hint: string;
}

export function DeliverContent({ featureId, hint }: DeliverContentProps) {
  const [referenceExpanded, setReferenceExpanded] = useState(false);

  return (
    <div className="flex-1 p-6">
      {/* Primary: Implementation Notes */}
      <ArtifactList
        featureId={featureId}
        phase="deliver"
        artifactType="implementation-notes"
        label="Implementation Notes"
        emptyHint={hint}
      />

      {/* Reference: Spec from Define phase — collapsible */}
      <div className="mt-6 border-t border-border pt-4">
        <button
          onClick={() => setReferenceExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg
            className={`h-3 w-3 transition-transform ${referenceExpanded ? "rotate-90" : ""}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          Feature Spec Reference
        </button>
        {referenceExpanded && (
          <div className="mt-4">
            <SpecViewer featureId={featureId} />
          </div>
        )}
      </div>
    </div>
  );
}
