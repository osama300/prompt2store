import { spawn } from "node:child_process";
import { createCtx } from "../mcp/context.js";
import { findProjectRoot } from "../state/store.js";
import { startUi } from "./server.js";

function openBrowser(url: string) {
  const plat = process.platform;
  const [cmd, args] = plat === "darwin" ? ["open", [url]] : plat === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const c = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true });
    c.on("error", () => {});
    c.unref();
  } catch {
    /* printing the URL is enough */
  }
}

export async function runUiCommand(args: string[]): Promise<void> {
  const pi = args.indexOf("--port");
  const portArg = pi >= 0 ? Number(args[pi + 1]) : undefined;
  const port = portArg && Number.isInteger(portArg) && portArg > 0 && portArg < 65536 ? portArg : undefined;
  const ctx = createCtx(findProjectRoot());
  ctx.store.init();
  const ui = await startUi(ctx, { port });
  const url = `${ui.baseUrl}/?t=${ui.token}`;
  console.log(`prompt-to-store UI for ${ctx.root}`);
  console.log(`  ${url}`);
  console.log("Keys you enter there stay on this computer. Press Ctrl+C to stop.");
  if (!args.includes("--no-open")) openBrowser(url);
  const stop = async () => {
    await ui.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}
