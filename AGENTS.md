# AGENTS.md

Guidance for coding agents (and humans) working **on** prompt-to-store itself.
(Agents *using* prompt-to-store to build apps follow `skills/prompt-to-store/SKILL.md`.)

## Commands
- `npm install` · `npm run build` (tsc → `dist/`) · `npm test` (vitest) · `npm run typecheck`
- Call any tool against a project without an MCP client: `npx tsx scripts/try-tool.ts <projectDir> <tool> '<json>'`
- Run the UI for a project: `npx tsx src/cli.ts ui` (from the project dir) · Doctor: `npx tsx src/cli.ts doctor`
- Point your own agents at this checkout: `node dist/cli.js setup --local`

## Architecture (one paragraph)
`src/mcp/server.ts` registers the tools from `src/mcp/tools/*` (all listed in `tools/index.ts`). Every tool is a `defineTool({...})` with a zod input, an optional `gate` (from `src/mcp/gates.ts`) and `run`. `invokeTool` parses args, runs the gate, runs the tool, redacts secrets from the output, and converts `GateError` into `{blocked, reason, next_step, link}`. All shared state is `.prompt-to-store/state.json` (`src/state/`, zod schema, atomic writes, lockfile) — the MCP server and the local UI (`src/ui/`) both read/write it; the UI pushes changes over SSE. Secrets live in `src/secrets/` (macOS Keychain or `secrets.json` 0600) and are only written by the UI after `src/services/verify.ts` validates them. Service clients in `src/services/` use `src/lib/http.ts` (`setFetch` for tests).

## Rules
- Never return secret values from a tool or the UI API; never log them. Use `ctx.secrets` and rely on `redact()` as a safety net only.
- New tools: add to `tools/index.ts`, give them a precise description written for an agent, a gate when order matters, `supportsDryRun` when they mutate remote state, and a test using `setFetch` + a temp project.
- Anything that publishes to a store must go through `requireUiApproval`.
- Keep `codemagic.yaml` workflow ids (`p2s-*`) stable — tools reference them.
- No new runtime dependencies without a strong reason (current: MCP SDK, zod, qrcode, smol-toml, node-forge).
- Tests must not hit the network.
