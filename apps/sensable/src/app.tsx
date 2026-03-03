import { useEffect } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Toaster } from "sonner";
import { PipelineSidebar } from "./components/pipeline-sidebar";
import { ContentArea } from "./components/content-area";
import { AgentPanel } from "./components/agent-panel";
import { useApprovalToasts } from "./components/approval-toast";
import { UserQuestionDialog } from "./components/user-question-dialog";
import { ProjectPicker } from "./components/project-picker";
import { OnboardingChat } from "./components/onboarding-chat";
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

function NavigationGuardDialog() {
  const pendingNav = useProjectStore((s) => s.pendingNavigation);
  const confirmNavigation = useProjectStore((s) => s.confirmNavigation);
  const cancelNavigation = useProjectStore((s) => s.cancelNavigation);

  if (!pendingNav) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-xl">
        <h2 className="text-sm font-semibold text-foreground">Agent is running</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          <strong>{pendingNav.featureName}</strong> has an active agent. Switching phases will stop it and clear the conversation.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={cancelNavigation}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={confirmNavigation}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            Stop agent and switch
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const contextKey = deriveContextKey(project);
  const answerQuestion = useAgentStore((s) => s.answerQuestion);
  const setPendingQuestion = useAgentStore((s) => s.setPendingQuestion);

  // Find the first session with a pending question (prefer active context)
  const pendingQuestionEntry = useAgentStore((s) => {
    // Prefer active session's question first
    const active = getSessionState(s.sessions, contextKey);
    if (active.pendingQuestion) return { contextKey, question: active.pendingQuestion };
    // Fall back to any session with a question
    for (const [key, session] of Object.entries(s.sessions)) {
      if (session.pendingQuestion) return { contextKey: key, question: session.pendingQuestion };
    }
    return null;
  });

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
      </header>

      <div className="flex flex-1 overflow-hidden">
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
                  <ContentArea />
                </Panel>
                <Separator className="w-1 hover:bg-primary/30 transition-colors" />
                <Panel id="agent" defaultSize="25%" minSize="15%" maxSize="50%">
                  <AgentPanel />
                </Panel>
              </Group>
            </>
          )
        ) : (
          <ProjectPicker />
        )}
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
      <NavigationGuardDialog />
    </div>
  );
}
