import { useProjectStore } from "../stores/project-store";

const frameworks = [
  {
    id: "react" as const,
    label: "React",
    description: "React 19 with JSX, Vite, and Tailwind CSS",
  },
  {
    id: "vue" as const,
    label: "Vue",
    description: "Vue 3 with Composition API, Vite, and Tailwind CSS",
  },
];

export function ProjectSettings() {
  const project = useProjectStore((s) => s.project);
  const setFramework = useProjectStore((s) => s.setFramework);

  const currentFramework = project?.framework ?? "react";

  return (
    <div className="space-y-8 p-6">
      {/* Prototype Framework */}
      <section>
        <h3 className="text-sm font-medium">Prototype Framework</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The framework used for interactive prototypes and the design system
          preview server.
        </p>

        <div className="mt-3 flex gap-3">
          {frameworks.map((fw) => (
            <button
              key={fw.id}
              onClick={() => setFramework(fw.id)}
              className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                currentFramework === fw.id
                  ? "border-foreground bg-accent"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <span className="text-sm font-medium">{fw.label}</span>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {fw.description}
              </p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
