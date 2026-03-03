# Sensable v0.1

A local-first desktop app that guides you through the product development lifecycle — from discovery to delivery — with an AI agent at every step.

Each feature in your project progresses through its own pipeline: **Discover → Define → Develop → Deliver**. At every phase, an AI agent helps you write specs, generate wireframes, build prototypes, and implement the final code.

## How It Works

- **Discover** — The agent guides you through spec writing, capturing requirements and user flows
- **Define** — The agent generates HTML wireframes you can preview and compare side-by-side
- **Develop** — The agent builds interactive React prototypes served via a local Vite dev server
- **Deliver** — The agent implements the feature in your real codebase, using the prototype as reference

All data stays on your machine. Projects are stored as structured JSON files — no cloud, no accounts.

## Architecture

Sensable is a [Tauri v2](https://v2.tauri.app/) app with a React frontend and Rust backend. The AI agent is a long-running [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) process that communicates via MCP (Model Context Protocol).

```
sensable/
├── apps/
│   ├── sensable/          # Tauri desktop app (React frontend + Rust backend)
│   └── sensable-mcp/      # MCP server binary (Rust) — domain tools for the agent
├── packages/
│   ├── schemas/           # Shared Zod schemas (project, feature, spec, etc.)
│   ├── ui/                # Shared UI components
│   └── agent-prompt/      # Agent system prompt builder
```

### Key Technologies

| Layer | Tech |
|-------|------|
| Desktop shell | Tauri v2 |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| State management | Zustand |
| Backend | Rust, Axum (internal HTTP for approval gates) |
| AI agent | Claude Code CLI via `stream-json` protocol |
| Agent tools | MCP server (rmcp), 12 domain-specific tools |
| Monorepo | pnpm workspaces, Turborepo |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v10+)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Getting Started

```bash
# Install dependencies
pnpm install

# Run in development mode (starts Vite dev server + Tauri app)
cd apps/sensable
pnpm tauri dev
```

## Building

```bash
# Build all packages
pnpm build

# Build the desktop app
cd apps/sensable
pnpm tauri build
```

## License

MIT
