import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Plane, PlaneError } from "../src/plane.js";

// A tiny fake of the Vynk API: records requests, answers the few endpoints the bot uses.
function fake(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        key: req.headers["x-api-key"],
        body: body ? JSON.parse(body) : null,
      });
      const [status, data] = handler(req, body ? JSON.parse(body) : null);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, () =>
      resolve({
        seen,
        close: () => server.close(),
        plane: new Plane({ baseUrl: `http://127.0.0.1:${server.address().port}`, workspace: "acme", apiKey: "k" }),
      })
    )
  );
}

test("logs time as the person, in minutes", async () => {
  const f = await fake(() => [201, { id: "e1" }]);
  await f.plane.logTime({ userId: "u1", issueId: "i1", hours: 1.5, spentOn: "2026-03-04", comment: "docs" });
  f.close();
  const [call] = f.seen;
  assert.equal(call.url, "/api/v1/workspaces/acme/time-entries/");
  assert.equal(call.key, "k");
  assert.deepEqual(call.body, { user_id: "u1", issue_id: "i1", minutes: 90, spent_on: "2026-03-04", comment: "docs" });
});

test("maps entries to the shape the Slack views use", async () => {
  const f = await fake(() => [
    200,
    [
      {
        minutes: 150,
        spent_on: "2026-03-04",
        comment: "x",
        user: { id: "u1", display_name: "Sam" },
        project: { id: "p1", name: "Acme" },
        issue: { key: "ACM-1", name: "Write docs" },
      },
    ],
  ]);
  const [e] = await f.plane.timeEntries({ from: "2026-03-02", to: "2026-03-08", userId: "u1" });
  f.close();
  assert.deepEqual(e, {
    hours: 2.5,
    spentOn: "2026-03-04",
    userId: "u1",
    userName: "Sam",
    workPackageId: "ACM-1",
    workPackageTitle: "Write docs",
    projectId: "p1",
    projectTitle: "Acme",
    comment: "x",
  });
  assert.match(f.seen[0].url, /from=2026-03-02&to=2026-03-08&user_id=u1/);
});

test("finds people by email (case-insensitive) and flags admins", async () => {
  const f = await fake(() => [
    200,
    [
      { id: "a", email: "Ann@X.com", display_name: "Ann", role: 20 },
      { id: "b", email: "bo@x.com", display_name: "Bo", role: 15 },
    ],
  ]);
  assert.equal((await f.plane.userByEmail("ann@x.com")).admin, true);
  assert.equal((await f.plane.userByEmail("BO@x.com")).admin, false);
  assert.equal(await f.plane.userByEmail("nobody@x.com"), null);
  f.close();
  assert.equal(f.seen.length, 1, "members are cached");
});

test("taskByKey only returns an exact key match", async () => {
  const f = await fake(() => [
    200,
    [
      { id: "i2", key: "ACM-12", name: "b" },
      { id: "i1", key: "ACM-1", name: "a" },
    ],
  ]);
  assert.equal((await f.plane.taskByKey("u1", "acm-1")).id, "i1");
  assert.equal(await f.plane.taskByKey("u1", "ACM-9"), null);
  f.close();
});

test("server errors surface as PlaneError with the server's message", async () => {
  const f = await fake(() => [400, { error: "That would be more than 24 hours on 2026-03-04; 4h 0m left that day." }]);
  await assert.rejects(f.plane.logTime({ userId: "u", issueId: "i", hours: 5, spentOn: "2026-03-04" }), (err) => {
    assert.ok(err instanceof PlaneError);
    assert.match(err.message, /24 hours/);
    return true;
  });
  f.close();
});

test("project keys come from the initials and retry when taken", async () => {
  let n = 0;
  const f = await fake((req, body) =>
    n++ === 0
      ? [400, { identifier: ["Project identifier already taken"] }]
      : [201, { id: "p", name: body.name, identifier: body.identifier }]
  );
  const project = await f.plane.createProject({ name: "Fyx Home Services", leadId: "u1" });
  f.close();
  assert.equal(f.seen[0].body.identifier, "FHS");
  assert.equal(project.identifier, "FHS1");
  assert.equal(f.seen[1].body.project_lead, "u1");
});
