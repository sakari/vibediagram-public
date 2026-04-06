# VibeDiagram

A browser-based tool for building and visualizing discrete-event simulations. Write TypeScript simulation code in an in-browser editor, and see it rendered as an interactive node-edge diagram — all client-side.

For architecture and maintenance details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Getting Started

### Prerequisites

- Node.js 22+ (latest LTS)
- pnpm 8+

### Installation

```bash
pnpm install
```

### Development

Start the development server:

```bash
pnpm dev
```

This starts the Vite development server at `http://localhost:3000`.

### FUSE mount (optional)

Mount a Jazz project as a local filesystem for editing in any text editor. Requires FUSE support (`fuse3` + `libfuse-dev` on Linux, macFUSE on macOS).

```bash
# Create Jazz worker credentials (one-time)
npx jazz-run account create --name "fuse-mirror"

# Mount a project
JAZZ_WORKER_ACCOUNT=<id> JAZZ_WORKER_SECRET=<secret> \
  npx tsx packages/fuse-mirror/src/cli.ts <project-id>
```

See [packages/fuse-mirror/README.md](packages/fuse-mirror/README.md) for details.

### Deployment

```bash
pnpm build      # Build for production
pnpm deploy     # Deploy to Vercel
```

## Dev Container

A sandboxed dev container is available for running Claude Code with network and filesystem isolation. See [`.devcontainer/README.md`](.devcontainer/README.md) for setup instructions.

## License

MIT
