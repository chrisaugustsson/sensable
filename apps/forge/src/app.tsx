import { Panel, Group, Separator } from "react-resizable-panels";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { DiffViewer } from "@/components/diff-viewer";

export function App() {
  return (
    <div className="h-screen w-screen">
      <Group orientation="horizontal">
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <div className="h-full border-r border-border">
            <Sidebar />
          </div>
        </Panel>

        <Separator className="w-px bg-border hover:bg-ring transition-colors" />

        <Panel defaultSize={45} minSize={30}>
          <ChatPanel />
        </Panel>

        <Separator className="w-px bg-border hover:bg-ring transition-colors" />

        <Panel defaultSize={35} minSize={20}>
          <DiffViewer />
        </Panel>
      </Group>
    </div>
  );
}
