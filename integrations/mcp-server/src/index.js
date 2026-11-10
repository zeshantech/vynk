#!/usr/bin/env node
// Vynk MCP server.
//   Local (stdio):  VYNK_WORKSPACE + VYNK_API_KEY (+ VYNK_URL). Used by `claude mcp add … -- node src/index.js`.
//   Hosted (HTTP):  MCP_HTTP_PORT set. Serves /mcp/<workspace>; each caller sends their own token.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpServer } from "./http.js";
import { createServer } from "./tools.js";
import { Vynk } from "./vynk.js";

const PUBLIC_URL = (process.env.VYNK_URL || "https://vynk.robustcraft.com").replace(/\/$/, "");

/** A required setting for local (stdio) mode; stdout belongs to the MCP protocol, so problems go to stderr. */
function env(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`vynk-mcp: missing ${name}. See integrations/mcp-server/README.md.`);
    process.exit(1);
  }
  return value;
}

if (process.env.MCP_HTTP_PORT) {
  const port = Number(process.env.MCP_HTTP_PORT);
  const apiBase = process.env.VYNK_API_BASE || PUBLIC_URL;
  createHttpServer({ apiBase, publicUrl: PUBLIC_URL }).listen(port, () =>
    console.error(`vynk-mcp: serving ${PUBLIC_URL}/mcp/<workspace> on :${port} (API at ${apiBase})`)
  );
} else {
  const vynk = new Vynk({ baseUrl: PUBLIC_URL, workspace: env("VYNK_WORKSPACE"), apiKey: env("VYNK_API_KEY") });
  await createServer(vynk).connect(new StdioServerTransport());
  console.error(`vynk-mcp: connected to ${PUBLIC_URL}/${vynk.workspace}`);
}
