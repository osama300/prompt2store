// Local companion UI — implemented by the UI work package. Contract:
import type { Ctx, UiHandle } from "../mcp/context.js";

export interface UiServer {
  baseUrl: string;
  token: string;
  close(): Promise<void>;
}

export async function startUi(_ctx: Ctx, _opts: { port?: number; open?: boolean } = {}): Promise<UiServer> {
  throw new Error("not implemented");
}

export function createUiHandle(ctx: Ctx): UiHandle {
  return {
    async ensure() {
      const s = await startUi(ctx);
      return { baseUrl: s.baseUrl, token: s.token };
    },
    async link(p: string) {
      const s = await startUi(ctx);
      return `${s.baseUrl}${p}${p.includes("?") ? "&" : "?"}t=${s.token}`;
    },
  };
}
