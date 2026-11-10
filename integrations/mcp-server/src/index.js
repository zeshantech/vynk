#!/usr/bin/env node
// Vynk MCP server over stdio. Configure with VYNK_URL, VYNK_WORKSPACE and VYNK_API_KEY (see README.md).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./tools.js";
import { Vynk } from "./vynk.js";

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    // stdout belongs to the MCP protocol, so problems go to stderr
    console.error(`vynk-mcp: missing ${name}. See integrations/mcp-server/README.md.`);
    process.exit(1);
  }
  return value;
};

const vynk = new Vynk({
  baseUrl: env("VYNK_URL", "https://vynk.robustcraft.com"),
  workspace: env("VYNK_WORKSPACE"),
  apiKey: env("VYNK_API_KEY"),
});

await createServer(vynk).connect(new StdioServerTransport());
console.error(`vynk-mcp: connected to ${vynk.baseUrl}/${vynk.workspace}`);
