// Hosted mode: MCP over Streamable HTTP at /mcp/<workspace-slug>.
// Each request brings the caller's own Vynk personal access token (Authorization: Bearer …), so the
// server holds no secrets and every call runs with that person's permissions. Stateless: one MCP
// server per request, JSON responses, no sessions to keep.
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./tools.js";
import { Vynk } from "./vynk.js";

const MAX_BODY = 1_000_000;
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const rpcError = (res, status, message, headers) =>
  json(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * apiBase: where to reach the Vynk API (inside Docker: http://api:8000).
 * publicUrl: the address people use, for links in tool replies and in the docs.
 */
export function createHttpServer({ apiBase, publicUrl, fetchImpl, log = console.error }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/mcp/health") return json(res, 200, { ok: true });

    const m = /^\/mcp\/([^/]+)\/?$/.exec(url.pathname);
    if (!m || !SLUG.test(m[1]))
      return json(res, 404, { error: `Use ${publicUrl}/mcp/<workspace-slug>, e.g. ${publicUrl}/mcp/robustcraft` });
    if (req.method !== "POST")
      return rpcError(res, 405, "This server is stateless: send JSON-RPC with POST.", { allow: "POST" });

    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token)
      return rpcError(
        res,
        401,
        "Send your Vynk personal access token as 'Authorization: Bearer <token>' (Vynk → Profile settings → Personal access tokens).",
        { "www-authenticate": 'Bearer realm="vynk"' }
      );

    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      return rpcError(res, 400, "The request body must be JSON (at most 1 MB).");
    }

    const vynk = new Vynk({ baseUrl: apiBase, publicUrl, workspace: m[1], apiKey: token, fetchImpl });
    const server = createServer(vynk);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log("mcp request failed", err);
      if (!res.headersSent) rpcError(res, 500, "Internal error");
    }
  });
}
