import { useEffect, useState } from "react";
import { listArtifacts, readArtifact } from "../lib/tauri";
import { useProjectStore } from "../stores/project-store";

// Project spec shape from onboarding agent (differs from feature Spec)
interface ProjectSpec {
  id: string;
  productName?: string;
  title?: string;
  tagline?: string;
  overview?: string;
  targetUsers?: Array<string | { name?: string; description?: string; asA?: string; iWant?: string; soThat?: string }>;
  userStories?: Array<{ asA: string; iWant: string; soThat: string }>;
  problemStatements?: string[];
  goals?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  outOfScope?: string[];
  openQuestions?: string[];
  status?: string;
  [key: string]: unknown;
}

export function ProjectSpecViewer() {
  const projectPath = useProjectStore((s) => s.projectPath);
  const [spec, setSpec] = useState<ProjectSpec | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    listArtifacts(projectPath, "project", "specs")
      .then(async (summaries) => {
        const items = summaries as Array<{ id: string }>;
        if (items.length === 0) {
          setSpec(null);
          return;
        }
        const full = await readArtifact(
          projectPath,
          "project",
          "specs",
          items[0].id,
        );
        setSpec(full as ProjectSpec);
      })
      .catch(() => setSpec(null))
      .finally(() => setLoading(false));
  }, [projectPath]);

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-xs text-muted-foreground">Loading project spec...</p>
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          No project spec yet. Use the agent to define your project — what it does, who it's for, and what problems it solves.
        </p>
      </div>
    );
  }

  const displayTitle = spec.productName ?? spec.title ?? "Untitled";
  const status = spec.status ?? "draft";
  const targetUsers = spec.targetUsers ?? [];
  const userStories = spec.userStories ?? [];
  const goals = spec.goals ?? spec.acceptanceCriteria ?? [];
  const problemStatements = spec.problemStatements ?? [];
  const constraints = spec.constraints ?? [];
  const outOfScope = spec.outOfScope ?? [];
  const openQuestions = spec.openQuestions ?? [];

  return (
    <div className="p-6">
      <div className="rounded-lg border border-border">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">{displayTitle}</h3>
            {spec.tagline && (
              <p className="mt-0.5 text-xs text-muted-foreground">{spec.tagline}</p>
            )}
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              status === "approved"
                ? "bg-green-500/10 text-green-400"
                : status === "review"
                  ? "bg-blue-500/10 text-blue-400"
                  : "bg-yellow-500/10 text-yellow-400"
            }`}
          >
            {status}
          </span>
        </div>

        {/* Overview */}
        {spec.overview && (
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm leading-relaxed text-foreground/80">
              {spec.overview}
            </p>
          </div>
        )}

        {/* Target Users (project spec format) */}
        {targetUsers.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Target Users
            </h4>
            <div className="space-y-2">
              {targetUsers.map((user, i) => (
                <div
                  key={i}
                  className="rounded-md bg-accent/30 px-3 py-2 text-sm"
                >
                  {typeof user === "string" ? (
                    <span>{user}</span>
                  ) : user.asA ? (
                    <>
                      <span className="text-muted-foreground">As a </span>
                      <span className="font-medium">{user.asA}</span>
                      {user.iWant && (
                        <>
                          <span className="text-muted-foreground">, I want </span>
                          <span className="font-medium">{user.iWant}</span>
                        </>
                      )}
                      {user.soThat && (
                        <>
                          <span className="text-muted-foreground">, so that </span>
                          <span className="font-medium">{user.soThat}</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {user.name && <span className="font-medium">{user.name}</span>}
                      {user.description && (
                        <span className="text-muted-foreground">
                          {user.name ? " — " : ""}{user.description}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Stories (feature spec format) */}
        {userStories.length > 0 && targetUsers.length === 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              User Stories
            </h4>
            <div className="space-y-2">
              {userStories.map((story, i) => (
                <div
                  key={i}
                  className="rounded-md bg-accent/30 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">As a </span>
                  <span className="font-medium">{story.asA}</span>
                  <span className="text-muted-foreground">, I want </span>
                  <span className="font-medium">{story.iWant}</span>
                  <span className="text-muted-foreground">, so that </span>
                  <span className="font-medium">{story.soThat}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Problem Statements */}
        {problemStatements.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Problems Being Solved
            </h4>
            <ul className="space-y-1">
              {problemStatements.map((problem, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0 text-muted-foreground">-</span>
                  <span className="text-foreground/80">{typeof problem === "string" ? problem : JSON.stringify(problem)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Goals */}
        {goals.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Goals
            </h4>
            <ul className="space-y-1">
              {goals.map((goal, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border" />
                  <span className="text-foreground/80">{typeof goal === "string" ? goal : JSON.stringify(goal)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Constraints */}
        {constraints.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Constraints
            </h4>
            <ul className="space-y-1">
              {constraints.map((constraint, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span className="shrink-0">-</span>
                  <span>{typeof constraint === "string" ? constraint : JSON.stringify(constraint)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Out of Scope */}
        {outOfScope.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Out of Scope
            </h4>
            <ul className="space-y-1">
              {outOfScope.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span className="shrink-0">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Open Questions */}
        {openQuestions.length > 0 && (
          <div className="px-4 py-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Open Questions
            </h4>
            <ul className="space-y-1">
              {openQuestions.map((q, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span className="shrink-0">?</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
