import { z } from "zod";

const baseArtifactSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tags: z.array(z.string()),
});

export const researchNoteSchema = baseArtifactSchema.extend({
  title: z.string().min(1),
  source: z.string(),
  sourceType: z.enum(["article", "book", "website", "observation", "other"]),
  content: z.string(),
  keyFindings: z.array(z.string()),
  createdBy: z.enum(["user", "agent"]),
});

export type ResearchNote = z.infer<typeof researchNoteSchema>;

export const interviewQuestionSchema = z.object({
  question: z.string(),
  answer: z.string(),
  notes: z.string(),
});

export const interviewSchema = baseArtifactSchema.extend({
  participant: z.string().min(1),
  date: z.string(),
  context: z.string(),
  questions: z.array(interviewQuestionSchema),
  keyTakeaways: z.array(z.string()),
});

export type Interview = z.infer<typeof interviewSchema>;

export const insightEvidenceSchema = z.object({
  artifactType: z.enum(["research-note", "interview"]),
  artifactId: z.string().uuid(),
  relevance: z.string(),
});

export const insightSchema = baseArtifactSchema.extend({
  title: z.string().min(1),
  description: z.string(),
  evidence: z.array(insightEvidenceSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

export type Insight = z.infer<typeof insightSchema>;

export const opportunityAreaSchema = baseArtifactSchema.extend({
  title: z.string().min(1),
  description: z.string(),
  sourceInsights: z.array(z.string().uuid()),
  impact: z.enum(["high", "medium", "low"]),
});

export type OpportunityArea = z.infer<typeof opportunityAreaSchema>;
