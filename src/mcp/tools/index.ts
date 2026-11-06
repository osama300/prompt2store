import type { ToolDef } from "../context.js";
import { stateGet, planSave, stageUpdate, setupLink } from "./state.js";
import { checkTools } from "./check.js";
import { fontAdd } from "./font.js";
import { codemagicTools } from "./codemagic.js";
import { playTools } from "./play.js";
import { appStoreTools } from "./appstore.js";

export function allTools(): ToolDef<any>[] {
  return [stateGet, planSave, stageUpdate, setupLink, fontAdd, ...checkTools, ...codemagicTools, ...playTools, ...appStoreTools];
}
