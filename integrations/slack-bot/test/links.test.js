import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { PlaneError, SlackLinks } from "../src/plane.js";
import { connectView, menuView } from "../src/views.js";

// A fake of Vynk's /api/v1/slack/ endpoints that records what the bot sent.
function fake(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      seen.push({ method: req.method, url: req.url, secret: req.headers["x-slack-bot-secret"], body: parsed });
      const [status, data] = handler(req, parsed);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, () => {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve({
        seen,
        baseUrl,
        close: () => server.close(),
        links: new SlackLinks({ baseUrl, secret: "s3cret", teamId: "T1" }),
      });
    })
  );
}

test("connect link: asks Vynk for a signed code and builds the page URL", async () => {
  const f = await fake(() => [200, { code: "abc:def" }]);
  const url = await f.links.connectUrl("U1");
  f.close();
  assert.equal(url, `${f.baseUrl}/slack/connect/abc%3Adef`);
  assert.deepEqual(f.seen[0], {
    method: "POST",
    url: "/api/v1/slack/connect-code/",
    secret: "s3cret",
    body: { team_id: "T1", user_id: "U1" },
  });
});

test("find: returns the link, or null when the Slack user isn't connected", async () => {
  const link = { user: { id: "u1" }, workspace: { slug: "acme", name: "Acme" }, api_token: "tok" };
  const f = await fake((req) => (req.url.includes("U1") ? [200, link] : [404, { error: "not_connected" }]));
  assert.deepEqual(await f.links.find("U1"), link);
  assert.equal(await f.links.find("U2"), null);
  f.close();
  assert.equal(f.seen[0].url, "/api/v1/slack/link/?team_id=T1&user_id=U1");
});

test("a wrong bot secret is reported as an error, not as 'not connected'", async () => {
  const f = await fake(() => [403, { detail: "Forbidden" }]);
  await assert.rejects(f.links.find("U1"), (err) => err instanceof PlaneError && err.status === 403);
  f.close();
});

test("connectView: a link button to the connect page", () => {
  const view = connectView("https://vynk.example/slack/connect/x");
  const button = view.blocks.find((b) => b.type === "actions").elements[0];
  assert.equal(button.url, "https://vynk.example/slack/connect/x");
  assert.equal(button.action_id, "connect_vynk");
  assert.match(button.text.text, /Connect Vynk account/);
  assert.match(connectView("u", { switching: true }).blocks[1].elements[0].text.text, /Choose workspace/);
});

test("menuView: shows the workspace and a Switch workspace button", () => {
  const view = menuView([["log_time", "Log time"]], [], "Zeshan", "Robustcraft");
  const text = JSON.stringify(view.blocks);
  assert.match(text, /Signed in as \*Zeshan\* in \*Robustcraft\*/);
  assert.match(text, /menu_switch_workspace/);
});
