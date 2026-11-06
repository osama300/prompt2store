#!/usr/bin/env node
import { VERSION } from "./version.js";

const HELP = `prompt-to-store ${VERSION}
🚢 From one prompt to Google Play and the App Store — inside your coding agent.

Usage:
  npx prompt-to-store setup [--dry-run] [--yes]   Add the MCP server + skills to your coding agents
  npx prompt-to-store ui [--port 4477]            Open the local companion UI for this project
  npx prompt-to-store mcp                          Run the MCP server (stdio) — used by your agent
  npx prompt-to-store doctor                       Check the toolchain and connections
  npx prompt-to-store --version
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "mcp": {
      const { runStdioServer } = await import("./mcp/server.js");
      await runStdioServer();
      return;
    }
    case "setup": {
      const { runSetup } = await import("./setup/index.js");
      process.exitCode = await runSetup(rest);
      return;
    }
    case "ui": {
      const { runUiCommand } = await import("./ui/cli.js");
      await runUiCommand(rest);
      return;
    }
    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      process.exitCode = await runDoctor();
      return;
    }
    case "-v":
    case "--version":
      console.log(VERSION);
      return;
    default:
      console.log(HELP);
      if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
