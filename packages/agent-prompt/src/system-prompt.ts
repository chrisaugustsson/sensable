import type { Project } from "@sensable/schemas";

/**
 * System prompt builder (TypeScript version).
 * Note: The actual system prompt is built in Rust (commands/agent.rs).
 * This package is kept for potential future use.
 */
export function buildSystemPrompt(project: Project): string {
  const featuresCount = project.features.length;
  const view = project.currentView;

  const viewDesc =
    view.type === "app"
      ? `App-level view: ${view.view}`
      : `Feature view: ${view.featureId} (${view.phase} phase)`;

  return `You are the Sensable assistant for the project "${project.name}".
${project.description}

## Project Structure
${featuresCount} features defined.

## Current Context
${viewDesc}

## Tools
You have access to Sensable project tools. Use them to read and create artifacts.`;
}
