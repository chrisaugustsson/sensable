import { z } from "zod";
import { featureSchema, featurePhaseNames } from "./feature";

export const phaseStatusSchema = z.object({
  status: z.enum(["not-started", "in-progress", "complete"]),
});

export type PhaseStatus = z.infer<typeof phaseStatusSchema>;

export const onboardingSchema = z.object({
  status: z.enum(["project-spec", "design-system", "complete"]),
});

export type Onboarding = z.infer<typeof onboardingSchema>;

export const appLevelViewNames = [
  "overview",
  "features",
  "architect",
  "design-system",
  "build",
  "project",
  "settings",
] as const;

export type AppLevelViewName = (typeof appLevelViewNames)[number];

export const currentViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app"), view: z.enum(appLevelViewNames) }),
  z.object({
    type: z.literal("feature"),
    featureId: z.string().uuid(),
    phase: z.enum(featurePhaseNames),
  }),
]);

export type CurrentView = z.infer<typeof currentViewSchema>;

export const designSystemComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
  hasExample: z.boolean().default(false),
});

export type DesignSystemComponent = z.infer<typeof designSystemComponentSchema>;

export const designSystemLayoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  hasExample: z.boolean().default(false),
});

export type DesignSystemLayout = z.infer<typeof designSystemLayoutSchema>;

export const designSystemStatusSchema = z.object({
  status: z.enum(["not-started", "in-progress", "complete"]),
  theme: z.record(z.string()).optional(),
  componentLibrary: z.enum(["shadcn", "custom"]).optional(),
  components: z.array(designSystemComponentSchema).default([]),
  layouts: z.array(designSystemLayoutSchema).default([]),
});

export type DesignSystemStatus = z.infer<typeof designSystemStatusSchema>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.number().default(2),
  currentView: currentViewSchema,
  features: z.array(featureSchema).default([]),
  appPhases: z.object({
    architect: phaseStatusSchema,
    build: phaseStatusSchema,
  }),
  agentSessionId: z.string().nullable(),
  framework: z.enum(["react", "vue"]).optional(),
  designSystem: designSystemStatusSchema.optional(),
  onboarding: onboardingSchema.optional(),
});

export type Project = z.infer<typeof projectSchema>;
