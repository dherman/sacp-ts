# sacp-ts

Experimental TypeScript port of [sacp-rs](https://github.com/symposium-dev/symposium-acp).

## Packages

This monorepo contains two packages:

- **[@dherman/sacp](packages/sacp)**: Core SACP library providing MCP-over-ACP protocol handling
- **[@dherman/patchwork](packages/patchwork)**: High-level API for blending deterministic code with LLM-powered reasoning

## Quick Start

```typescript
import { connect } from "@dherman/patchwork";

// Connect to an agent via the conductor
const patchwork = await connect(["sacp-conductor", "--agent", "claude"]);

// Use the think() API to compose prompts with tools
interface Summary {
  title: string;
  points: string[];
}

const summary = await patchwork.think<Summary>()
  .text("Summarize this document:")
  .display(documentContents)
  .tool("record", "Record an important item", async (input: { item: string }) => {
    console.log("Recorded:", input.item);
    return { success: true };
  })
  .run();

console.log(summary.title);
console.log(summary.points);

patchwork.close();
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Architecture

See [doc/rfd/mvp/design.md](doc/rfd/mvp/design.md) for the full design document.
