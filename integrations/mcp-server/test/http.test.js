import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/http.js";

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

/** Hosted MCP server in front of a fake Vynk API that only knows token "good". */
async function start(t) {
  const seen = [];
  const api = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers["x-api-key"] });
    const ok = req.headers["x-api-key"] === "good";
    const data = !ok
      ? [401, { detail: "Given API token is not valid" }]
      : req.url.endsWith("/users/me/")
        ? [200, { id: "u1", email: "sam@acme.test", display_name: "Sam" }]
        : [200, [{ id: "p1", name: "Acme", identifier: "ACM" }]];
    res.writeHead(data[0], { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(data[1]));
  });
  const apiPort = await listen(api);
  const mcp = createHttpServer({
    apiBase: `http://127.0.0.1:${apiPort}`,
    publicUrl: "https://vynk.example",
    log: () => {},
  });
  const port = await listen(mcp);
  t.after(() => {
    for (const s of [api, mcp]) {
      s.closeAllConnections();
      s.close();
    }
  });
  const base = `http://127.0.0.1:${port}`;
  const connect = async (token, path = "/mcp/acme") => {
    const client = new Client({ name: "test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}${path}`), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    });
    await client.connect(transport);
    t.after(() => client.close());
    return client;
  };
  return { base, seen, connect };
}

const textOf = (res) => res.content.map((c) => c.text).join("\n");

test("a client with a token uses every tool as that person, in the workspace from the URL", async (t) => {
  const { connect, seen } = await start(t);
  const client = await connect("good");
  assert.equal((await client.listTools()).tools.length, 20);
  const who = await client.callTool({ name: "whoami", arguments: {} });
  assert.equal(textOf(who), 'Sam <sam@acme.test> in workspace "acme" (https://vynk.example/acme/)');
  const projects = await client.callTool({ name: "list_projects", arguments: {} });
  assert.equal(textOf(projects), "- ACM: Acme");
  assert.ok(seen.every((s) => s.key === "good"));
  assert.ok(seen.some((s) => s.url === "/api/v1/workspaces/acme/time-entries/projects/"));
});

test("a wrong token comes back as a readable tool error", async (t) => {
  const { connect } = await start(t);
  const res = await (await connect("bad")).callTool({ name: "whoami", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /Given API token is not valid \(check VYNK_API_KEY\)/);
});

test("no token, wrong path, wrong method and health", async (t) => {
  const { base, connect } = await start(t);
  await assert.rejects(connect(null), /401|Bearer/);
  const post = (path) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{}",
    });
  assert.equal((await post("/mcp/")).status, 404);
  assert.equal((await post("/other")).status, 404);
  assert.equal((await fetch(`${base}/mcp/acme`, { method: "GET" })).status, 405);
  assert.deepEqual(await (await fetch(`${base}/mcp/health`)).json(), { ok: true });
});
