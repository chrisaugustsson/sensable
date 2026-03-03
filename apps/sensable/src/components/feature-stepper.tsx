import type { Feature, FeaturePhaseName } from "@sensable/schemas";
import { useProjectStore } from "../stores/project-store";

const steps: Array<{ phase: FeaturePhaseName; label: string }> = [
  { phase: "discover", label: "Discover" },
  { phase: "define", label: "Define" },
  { phase: "develop", label: "Develop" },
  { phase: "deliver", label: "Deliver" },
];

interface FeatureStepperProps {
  feature: Feature;
  activePhase: FeaturePhaseName;
}

export function FeatureStepper({ feature, activePhase }: FeatureStepperProps) {
  const setView = useProjectStore((s) => s.setView);

  const activeIndex = steps.findIndex((s) => s.phase === activePhase);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, index) => {
        const status = feature.phases[step.phase]?.status ?? "not-started";
        const isActive = step.phase === activePhase;
        const isComplete = status === "complete";
        const isPast = index < activeIndex;

        return (
          <div key={step.phase} className="flex items-center">
            <button
              onClick={() =>
                setView({
                  type: "feature",
                  featureId: feature.id,
                  phase: step.phase,
                })
              }
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                  isComplete
                    ? "bg-green-500/20 text-green-400"
                    : isActive
                      ? "border border-foreground text-foreground"
                      : isPast
                        ? "border border-muted-foreground text-muted-foreground"
                        : "border border-border text-muted-foreground"
                }`}
              >
                {isComplete ? (
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5l3.5 3.5 6.5-7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="font-medium">{step.label}</span>
            </button>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div
                className={`h-px w-6 ${
                  index < activeIndex ? "bg-muted-foreground" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
