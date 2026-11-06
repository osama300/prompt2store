import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCtx, invokeTool, type Ctx, type ToolDef } from "./context.js";
import { stateGet, planSave, stageUpdate, setupLink } from "./tools/state.js";
import { checkTools } from "./tools/check.js";
import { codemagicTools } from "./tools/codemagic.js";
import { playTools } from "./tools/play.js";
import { appStoreTools } from "./tools/appstore.js";
import { createUiHandle } from "../ui/server.js";
import { VERSION } from "../version.js";

export function allTools(): ToolDef<any>[] {
  return [stateGet, planSave, stageUpdate, setupLink, ...checkTools, ...codemagicTools, ...playTools, ...appStoreTools];
}

export const SERVER_INSTRUCTIONS = `prompt-to-store takes a Flutter app from one prompt to a tested build and the stores.
Pipeline: Plan → Build → Check → Ship → Store. Tools enforce the order: a tool that is called too early returns {blocked, reason, next_step} — do what next_step says.
Start every session with state_get. Never ask the user to paste API keys, tokens or key files in chat: call setup_link and send them the link. Never read .prompt-to-store/secrets.json.
Publishing to a store always needs the user to press Publish in the local UI.`;

export function buildServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: "prompt-to-store", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });
  for (const def of allTools()) {
    const shape: Record<string, z.ZodType> = { ...def.input };
    if (def.supportsDryRun) shape.dry_run = z.boolean().optional().describe("Validate and show what would happen without changing anything");
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: shape,
        annotations: { readOnlyHint: !!def.readOnly, destructiveHint: false, openWorldHint: true },
      },
      (async (args: Record<string, unknown>) => invokeTool(ctx, def, args ?? {})) as any,
    );
  }
  return server;
}

export async function runStdioServer(root?: string) {
  const ctx = createCtx(root);
  ctx.ui = createUiHandle(ctx);
  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
}
