import { z } from "zod";
import { phaseStatusSchema } from "./project";

export const featurePhaseNames = [
  "discover",
  "define",
  "develop",
  "deliver",
] as const;

export type FeaturePhaseName = (typeof featurePhaseNames)[number];

export const featureSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentPhase: z.enum(featurePhaseNames),
  phases: z.object({
    discover: phaseStatusSchema,
    define: phaseStatusSchema,
    develop: phaseStatusSchema,
    deliver: phaseStatusSchema,
  }),
});

export type Feature = z.infer<typeof featureSchema>;
