import { useState, useEffect, useCallback } from "react";
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
import { ProjectSettings } from "./project-settings";
import { ElementPrompt } from "./element-prompt";

const phaseDescriptions: Record<
  FeaturePhaseName,
  { title: string; description: string; hint: string }
> = {
  discover: {
    title: "Discover",
    description:
      "Explore the problem space. Research, interview users, and gather insights.",
    hint: "Ask the agent to help you explore the problem — research users, competitors, and the domain.",
  },
  define: {
    title: "Define",
    description:
      "Synthesize your research into a clear feature spec with requirements and constraints.",
    hint: "Ask the agent to write a spec based on your Discover research.",
  },
  develop: {
    title: "Develop",
    description:
      "Explore wireframe layouts, choose one, then build an interactive prototype.",
    hint: "Ask the agent to generate wireframe options based on your spec.",
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
  settings: {
    title: "Settings",
    description:
      "Configure project-level settings like prototype framework and preferences.",
    hint: "",
  },
};

/** Supporting artifact types per phase (excludes primary artifacts like specs/wireframes) */
const supportingArtifacts: Record<FeaturePhaseName, Array<{ type: string; label: string }>> = {
  discover: [
    { type: "research-notes", label: "Research Notes" },
    { type: "interviews", label: "Interviews" },
    { type: "insights", label: "Insights" },
    { type: "opportunity-areas", label: "Opportunity Areas" },
    { type: "inspiration", label: "Inspiration" },
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
        ) : view.view === "settings" ? (
          <ProjectSettings />
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

/** Discover phase: research artifacts are the primary focus */
function DiscoverContent({
  featureId,
  hint,
}: {
  featureId: string;
  hint: string;
}) {
  const artifacts = supportingArtifacts.discover;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      {/* Primary: Research artifacts */}
      <div className="space-y-6">
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

      {/* Hint */}
      <div className="mt-4 text-center text-sm text-muted-foreground">
        <p className="max-w-sm mx-auto">{hint}</p>
      </div>
    </div>
  );
}

/** Define phase: spec viewer + supporting artifacts (problem statements, requirements, constraints) */
function DefineContent({
  featureId,
  hint,
}: {
  featureId: string;
  hint: string;
}) {
  const [supportingExpanded, setSupportingExpanded] = useState(false);
  const artifacts = supportingArtifacts.define;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      {/* Primary: Spec viewer */}
      <SpecViewer featureId={featureId} />

      {/* Hint when no spec exists yet */}
      <div className="mt-4 text-center text-sm text-muted-foreground">
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
            Supporting Artifacts
          </button>
          {supportingExpanded && (
            <div className="mt-4 space-y-6">
              {artifacts.map((a) => (
                <ArtifactList
                  key={a.type}
                  featureId={featureId}
                  phase="define"
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

/** Develop phase: wireframes first, then prototype after one is chosen */
function DevelopContent({
  featureId,
  hint,
}: {
  featureId: string;
  hint: string;
}) {
  const projectPath = useProjectStore((s) => s.projectPath);
  const fileWriteVersion = useProjectStore((s) => s.fileWriteVersion);
  const [hasWireframes, setHasWireframes] = useState(false);
  const [wireframeChosen, setWireframeChosen] = useState<boolean>(false);
  const subStep = useProjectStore((s) => s.developSubStep);
  const setDevelopSubStep = useProjectStore((s) => s.setDevelopSubStep);

  // Fetch wireframe status independently so it survives sub-step switches
  useEffect(() => {
    if (!projectPath) return;
    import("../lib/tauri").then(({ listWireframes }) =>
      listWireframes(projectPath, featureId)
        .then((m) => {
          setHasWireframes(m.options.length > 0);
          setWireframeChosen(m.chosenOption !== null);
        })
        .catch(() => {
          setHasWireframes(false);
          setWireframeChosen(false);
        }),
    );
  }, [projectPath, featureId, fileWriteVersion]);

  // Auto-advance to prototype when wireframe is chosen
  useEffect(() => {
    if (wireframeChosen) setDevelopSubStep("prototype");
  }, [wireframeChosen, setDevelopSubStep]);

  const handleChosenStatus = useCallback((isChosen: boolean) => {
    setWireframeChosen(isChosen);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col p-6">
      {/* Sub-step indicator */}
      {hasWireframes && (
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setDevelopSubStep("wireframes")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors ${
              subStep === "wireframes"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {wireframeChosen && (
              <svg className="h-3 w-3 text-green-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
            )}
            Wireframes
          </button>
          <div className="h-px w-4 bg-border" />
          <button
            onClick={() => wireframeChosen && setDevelopSubStep("prototype")}
            disabled={!wireframeChosen}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              subStep === "prototype"
                ? "bg-accent text-foreground"
                : wireframeChosen
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-muted-foreground/40 cursor-not-allowed"
            }`}
          >
            Prototype
          </button>
        </div>
      )}

      {subStep === "wireframes" ? (
        <>
          <WireframePreview
            featureId={featureId}
            onLoadStatus={setHasWireframes}
            onChosenStatus={handleChosenStatus}
          />
          {!hasWireframes && (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                {hint}
              </p>
            </div>
          )}
        </>
      ) : (
        <PrototypePreview featureId={featureId} />
      )}

      <ElementPrompt />
    </div>
  );
}
