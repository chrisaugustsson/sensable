import { z } from "zod";

const baseArtifactSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tags: z.array(z.string()),
});

export const problemStatementSchema = baseArtifactSchema.extend({
  statement: z.string().min(1),
  context: z.string(),
  targetUser: z.string(),
  currentState: z.string(),
  desiredState: z.string(),
  sourceInsights: z.array(z.string().uuid()),
  status: z.enum(["draft", "validated"]),
});

export type ProblemStatement = z.infer<typeof problemStatementSchema>;

export const requirementSchema = baseArtifactSchema.extend({
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(["functional", "non-functional", "constraint"]),
  priority: z.enum(["must", "should", "could", "wont"]),
  rationale: z.string(),
  sourceInsights: z.array(z.string().uuid()),
  acceptanceCriteria: z.array(z.string()),
  status: z.enum(["draft", "validated", "deferred"]),
  createdBy: z.enum(["user", "agent"]),
});

export type Requirement = z.infer<typeof requirementSchema>;

export const constraintSchema = baseArtifactSchema.extend({
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(["technical", "business", "user", "regulatory"]),
  impact: z.string(),
  sourceInsights: z.array(z.string().uuid()),
});

export type Constraint = z.infer<typeof constraintSchema>;
