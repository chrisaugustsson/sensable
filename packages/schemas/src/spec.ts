import { z } from "zod";

const baseArtifactSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tags: z.array(z.string()),
});

export const userStorySchema = z.object({
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
});

export type UserStory = z.infer<typeof userStorySchema>;

export const specSchema = baseArtifactSchema.extend({
  title: z.string().min(1),
  overview: z.string(),
  userStories: z.array(userStorySchema),
  acceptanceCriteria: z.array(z.string()),
  outOfScope: z.array(z.string()),
  openQuestions: z.array(z.string()),
  status: z.enum(["draft", "review", "approved"]),
  createdBy: z.enum(["user", "agent"]),
});

export type Spec = z.infer<typeof specSchema>;
