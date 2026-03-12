import { useEffect } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/error-boundary";
import { PipelineSidebar } from "./components/pipeline-sidebar";
import { ContentArea } from "./components/content-area";
import { AgentPanel } from "./components/agent-panel";
import { useApprovalToasts } from "./components/approval-toast";
import { UserQuestionDialog } from "./components/user-question-dialog";
import { ProjectPicker } from "./components/project-picker";
import { OnboardingChat } from "./components/onboarding-chat";
import { PlanDialog } from "./components/plan-dialog";
import { ActiveSessionsMenu } from "./components/active-sessions-menu";
import { useProjectStore, useCurrentFeature } from "./stores/project-store";
import { useAgentStore, deriveContextKey, getSessionState } from "./stores/agent-store";

import { useAgentEvents } from "./hooks/use-agent-events";

function FooterStatus() {
  const project = useProjectStore((s) => s.project);
  const currentFeature = useCurrentFeature();

  if (!project) return "No project open";

  // Onboarding labels
  const onboarding = project.onboarding;
  if (onboarding && onboarding.status !== "complete") {
    const stepLabels: Record<string, string> = {
      "project-spec": "Onboarding — Project Spec",
      "design-system": "Onboarding — Design System",
    };
    return stepLabels[onboarding.status] ?? "Onboarding";
  }

  const view = project.currentView;
  if (view.type === "app") {
    const labels: Record<string, string> = {
      overview: "Overview",
      features: "Features",
      architect: "Architecture",
      build: "Build",
      project: "Project Spec",
      settings: "Settings",
    };
    return labels[view.view] ?? view.view;
  }

  if (view.type === "feature" && currentFeature) {
    const phase = view.phase.charAt(0).toUpperCase() + view.phase.slice(1);
    return `${currentFeature.name} — ${phase}`;
  }

  return "";
}

function needsOnboarding(project: { onboarding?: { status: string } } | null): boolean {
  if (!project) return false;
  // Existing projects without onboarding field → treated as complete (backward compat)
  if (!project.onboarding) return false;
  return project.onboarding.status !== "complete";
}


export function App() {
  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const contextKey = deriveContextKey(project);
  const answerQuestion = useAgentStore((s) => s.answerQuestion);
  const setPendingQuestion = useAgentStore((s) => s.setPendingQuestion);
  const respondToApproval = useAgentStore((s) => s.respondToApproval);
  const pendingPlan = useAgentStore((s) =>
    s.pendingApprovals.find((a) => a.action === "plan") ?? null
  );

  // Find the first session with a pending question (prefer active context).
  // Select primitive/stable refs separately to avoid creating new objects in the selector
  // (which causes infinite re-renders with Zustand's Object.is equality check).
  const pendingQKey = useAgentStore((s) => {
    const active = getSessionState(s.sessions, contextKey);
    if (active.pendingQuestion) return contextKey;
    for (const [key, session] of Object.entries(s.sessions)) {
      if (session.pendingQuestion) return key;
    }
    return null;
  });
  const pendingQuestion = useAgentStore((s) =>
    pendingQKey ? getSessionState(s.sessions, pendingQKey).pendingQuestion : null
  );
  const pendingQuestionEntry = pendingQKey && pendingQuestion
    ? { contextKey: pendingQKey, question: pendingQuestion }
    : null;

  useAgentEvents();
  useApprovalToasts();

  // Clear unread badge when navigating to a context
  const markRead = useAgentStore((s) => s.markRead);
  useEffect(() => {
    markRead(contextKey);
  }, [contextKey, markRead]);

  const showOnboarding = needsOnboarding(project);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "sensable-main",
    storage: localStorage,
  });

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-tight">Sensable</h1>
          {project ? (
            <span className="text-xs text-muted-foreground">
              {project.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Make it make sense
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ActiveSessionsMenu />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <ErrorBoundary>
          {project ? (
            showOnboarding ? (
              <OnboardingChat />
            ) : (
              <>
                <PipelineSidebar />
                <Group
                  id="sensable-main"
                  orientation="horizontal"
                  defaultLayout={defaultLayout}
                  onLayoutChanged={onLayoutChanged}
                >
                  <Panel id="content" defaultSize="75%" minSize="50%">
                    <ErrorBoundary>
                      <ContentArea />
                    </ErrorBoundary>
                  </Panel>
                  <Separator className="w-1 hover:bg-primary/30 transition-colors" />
                  <Panel id="agent" defaultSize="25%" minSize="15%" maxSize="50%">
                    <ErrorBoundary>
                      <AgentPanel />
                    </ErrorBoundary>
                  </Panel>
                </Group>
              </>
            )
          ) : (
            <ProjectPicker />
          )}
        </ErrorBoundary>
      </div>

      <footer className="flex h-7 shrink-0 items-center border-t border-border px-4">
        <span className="text-[11px] text-muted-foreground">
          <FooterStatus />
        </span>
      </footer>

      {pendingQuestionEntry && projectPath && (
        <UserQuestionDialog
          pendingQuestion={pendingQuestionEntry.question}
          onAnswer={(answer) => answerQuestion(pendingQuestionEntry.contextKey, projectPath, answer)}
          onDismiss={() => setPendingQuestion(pendingQuestionEntry.contextKey, null)}
        />
      )}

      <Toaster
        theme="dark"
        position="bottom-right"
      />
      {pendingPlan && (
        <PlanDialog
          approval={pendingPlan}
          onApprove={(requestId) => respondToApproval(requestId, true)}
          onReject={(requestId, reason) => respondToApproval(requestId, false, reason)}
        />
      )}
    </div>
  );
}
