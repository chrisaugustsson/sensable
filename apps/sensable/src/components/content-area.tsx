import { useState } from "react";
import { useProjectStore, useCurrentFeature } from "../stores/project-store";
import type { FeaturePhaseName } from "@sensable/schemas";
import { FeatureStepper } from "./feature-stepper";
import { ArtifactList } from "./artifact-list";
import { SpecViewer } from "./spec-viewer";
import { WireframePreview } from "./wireframe-preview";
import { PrototypePreview } from "./prototype-preview";
import { DeliverContent } from "./deliver-content";
import { ProjectSpecViewer } from "./project-spec-viewer";
import { DesignSystemContent } from "./design-system-content";

const phaseDescriptions: Record<
  FeaturePhaseName,
  { title: string; description: string; hint: string }
> = {
  discover: {
    title: "Discover",
    description:
      "Define what this feature needs. The agent helps you write a spec through guided conversation.",
    hint: "Ask the agent to help you write a spec for this feature — it will interview you about purpose, users, and key behaviors.",
  },
  define: {
    title: "Define",
    description:
      "Explore layout options with wireframes. The agent generates HTML wireframes for review.",
    hint: "Ask the agent to generate wireframes based on your spec. It will create multiple layout options for you to compare.",
  },
  develop: {
    title: "Develop",
    description:
      "Build interactive prototypes using your design system and components.",
    hint: "Ask the agent to generate a prototype from your chosen wireframe and design system.",
  },
  deliver: {
    title: "Deliver",
    description:
      "Implement the feature in your codebase based on the approved prototype.",
    hint: "Ask the agent to implement this feature in your actual codebase, using the prototype as a reference.",
  },
};

const appViewDescriptions: Record<
  string,
  { title: string; description: string; hint: string }
> = {
  project: {
    title: "Project Spec",
    description:
      "Your project's high-level spec — what it is, who it's for, and what it aims to achieve.",
    hint: "Use the agent to review or update your project spec.",
  },
  overview: {
    title: "Overview",
    description:
      "Describe your product idea. The agent will help you break it down into features.",
    hint: "Tell the agent about your app idea — what it does, who it's for, and what problems it solves. The agent will help you define individual features.",
  },
  architect: {
    title: "Architecture",
    description:
      "Define system architecture, data models, and component structure.",
    hint: "Ask the agent to help plan your system architecture — data models, API design, routing, and component structure.",
  },
  "design-system": {
    title: "Design System",
    description:
      "Your project's visual language — colors, typography, components, and layouts.",
    hint: "Ask the agent to help define your design system — colors, typography, border radius, components, and layouts.",
  },
  build: {
    title: "Build",
    description:
      "Scaffold the application with rich context from every prior phase.",
    hint: "This phase will be available in a future update.",
  },
};

/** Supporting artifact types per phase (excludes primary artifacts like specs/wireframes) */
const supportingArtifacts: Record<FeaturePhaseName, Array<{ type: string; label: string }>> = {
  discover: [
    { type: "research-notes", label: "Research Notes" },
    { type: "interviews", label: "Interviews" },
    { type: "insights", label: "Insights" },
    { type: "opportunity-areas", label: "Opportunity Areas" },
  ],
  define: [
    { type: "problem-statements", label: "Problem Statements" },
    { type: "requirements", label: "Requirements" },
    { type: "constraints", label: "Constraints" },
  ],
  develop: [],
  deliver: [],
};

export function ContentArea() {
  const project = useProjectStore((s) => s.project);
  const currentFeature = useCurrentFeature();

  if (!project) return null;

  const view = project.currentView;

  // App-level views
  if (view.type === "app") {
    const info = appViewDescriptions[view.view] ?? appViewDescriptions.overview;

    const needsInternalScroll = view.view === "design-system";

    return (
      <main className={`flex h-full flex-col ${needsInternalScroll ? "overflow-hidden" : "overflow-auto"}`}>
        <div className="shrink-0 border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">{info.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {info.description}
          </p>
        </div>

        {view.view === "project" ? (
          <ProjectSpecViewer />
        ) : view.view === "overview" && project.features.length > 0 ? (
          <div className="p-6">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              Features ({project.features.length})
            </h3>
            <div className="space-y-2">
              {project.features.map((feature) => (
                <div
                  key={feature.id}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{feature.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {feature.currentPhase}
                    </span>
                  </div>
                  {feature.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {feature.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : view.view === "architect" ? (
          <ArchitectContent />
        ) : view.view === "design-system" ? (
          <DesignSystemContent />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              {info.hint}
            </p>
          </div>
        )}
      </main>
    );
  }

  // Feature-level view
  if (view.type === "feature" && currentFeature) {
    const phase = view.phase as FeaturePhaseName;
    const info = phaseDescriptions[phase] ?? phaseDescriptions.discover;

    return (
      <main className="flex h-full flex-col overflow-hidden">
        {/* Header with feature name */}
        <div className="shrink-0 border-b border-border px-6 py-4">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {currentFeature.name}
          </div>
          <FeatureStepper feature={currentFeature} activePhase={phase} />
        </div>

        {/* Phase description */}
        <div className="shrink-0 border-b border-border px-6 py-3">
          <p className="text-sm text-muted-foreground">{info.description}</p>
        </div>

        {/* Phase-specific content */}
        <PhaseContent
          phase={phase}
          featureId={currentFeature.id}
          hint={info.hint}
        />
      </main>
    );
  }

  // Fallback
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">Select a view to begin.</p>
    </main>
  );
}

function PhaseContent({
  phase,
  featureId,
  hint,
}: {
  phase: FeaturePhaseName;
  featureId: string;
  hint: string;
}) {
  if (phase === "discover") {
    return <DiscoverContent featureId={featureId} hint={hint} />;
  }

  if (phase === "define") {
    return <DefineContent featureId={featureId} hint={hint} />;
  }

  if (phase === "develop") {
    return <DevelopContent featureId={featureId} hint={hint} />;
  }

  return <DeliverContent featureId={featureId} hint={hint} />;
}

function ArchitectContent() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        Ask the agent to help plan your system architecture — data models, API design, routing, and component structure.
      </p>
    </div>
  );
}

function DefineContent({
  featureId,
  hint,
}: {
  featureId: string;
  hint: string;
}) {
  const [hasWireframes, setHasWireframes] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <WireframePreview featureId={featureId} onLoadStatus={setHasWireframes} />

      {!hasWireframes && (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {hint}
          </p>
        </div>
      )}
    </div>
  );
}

function DevelopContent({
  featureId,
  hint,
}: {
  featureId: string;
  hint: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <PrototypePreview featureId={featureId} />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        <p className="max-w-sm mx-auto">{hint}</p>
      </div>
    </div>
  );
}

function DiscoverContent({
  featureId,
  hint,
}: {
  featureId: string;
  hint: string;
}) {
  const [supportingExpanded, setSupportingExpanded] = useState(false);
  const artifacts = supportingArtifacts.discover;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      {/* Primary: Spec viewer */}
      <SpecViewer featureId={featureId} />

      {/* Hint when no spec exists yet (SpecViewer returns null) */}
      <div className="mt-4 text-center text-sm text-muted-foreground empty:hidden" id={`hint-${featureId}`}>
        <p className="max-w-sm mx-auto">{hint}</p>
      </div>

      {/* Supporting artifacts — collapsible */}
      {artifacts.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <button
            onClick={() => setSupportingExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg
              className={`h-3 w-3 transition-transform ${supportingExpanded ? "rotate-90" : ""}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
            Supporting Research
          </button>
          {supportingExpanded && (
            <div className="mt-4 space-y-6">
              {artifacts.map((a) => (
                <ArtifactList
                  key={a.type}
                  featureId={featureId}
                  phase="discover"
                  artifactType={a.type}
                  label={a.label}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
