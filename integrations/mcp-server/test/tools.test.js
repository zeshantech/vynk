import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, dayFor, rangeFor, stripHtml, summarize, toHtml } from "../src/tools.js";
import { Vynk } from "../src/vynk.js";

const WED = new Date(2026, 2, 4); // Wednesday 4 March 2026
const ME = { id: "u1", email: "sam@acme.test", display_name: "Sam", first_name: "Sam", last_name: "Lee" };
const ALI = { id: "u2", email: "ali@acme.test", display_name: "Ali", first_name: "Ali", last_name: "Khan" };
const ACME = { id: "p1", name: "Acme", identifier: "ACM" };
const STATES = [
  { id: "s1", name: "Todo", group: "unstarted" },
  { id: "s2", name: "In Progress", group: "started" },
  { id: "s3", name: "Done", group: "completed" },
];
const LABELS = [{ id: "l1", name: "bug" }];
const CYCLES = [
  { id: "c1", name: "Sprint 1", start_date: "2026-02-16", end_date: "2026-02-27" },
  { id: "c2", name: "Sprint 2", start_date: "2026-03-02", end_date: "2026-03-13" },
];
const TASK = { id: "t1", name: "Write docs", sequence_id: 3, key: "ACM-3", project: ACME };
const ITEM = {
  id: "t1",
  name: "Write docs",
  sequence_id: 3,
  priority: "high",
  state: STATES[0],
  project: ACME,
  assignees: ["u1"],
  labels: ["l1"],
  target_date: "2026-03-06",
  description_html: "<p>Intro &amp; setup</p><ul><li>one</li></ul>",
};
const LIST = [
  { ...ITEM, project: "p1", state: STATES[0] },
  {
    id: "t2",
    name: "Ship it",
    sequence_id: 4,
    priority: "low",
    state: STATES[2],
    project: "p1",
    assignees: [],
    labels: [],
  },
  {
    id: "t5",
    name: "Fix bug",
    sequence_id: 5,
    priority: "urgent",
    state: STATES[1],
    project: "p1",
    assignees: ["u2"],
    labels: [],
  },
];
const entry = (minutes, user = ME, task = TASK) => ({
  minutes,
  spent_on: "2026-03-04",
  user: { id: user.id, display_name: user.display_name },
  project: { id: task.project.id, name: task.project.name },
  issue: { id: task.id, key: task.key, name: task.name },
});
const page = (results) => ({ results, next_page_results: false, next_cursor: "100:1:0" });

/** Fake Vynk API: records calls and answers the endpoints the tools use. */
function fakeVynk() {
  const calls = [];
  const P = "/api/v1/workspaces/acme/projects/p1";
  const routes = [
    ["GET", /\/users\/me\/$/, () => [200, ME]],
    ["GET", /\/time-entries\/projects\/$/, () => [200, [ACME]]],
    ["GET", /\/time-entries\/tasks\//, () => [200, [TASK]]],
    ["POST", /\/time-entries\/$/, () => [201, { id: "e1" }]],
    ["GET", /\/time-entries\//, (url) => [200, url.includes("user_id") ? [entry(90)] : [entry(90), entry(60, ALI)]]],
    [
      "GET",
      /\/work-items\/search\//,
      () => [200, { issues: [{ id: "t2", name: "Ship it", sequence_id: 4, project__identifier: "ACM" }] }],
    ],
    ["GET", /\/work-items\/ACM-3\//, () => [200, ITEM]],
    ["GET", /\/work-items\/ACM-5\//, () => [200, { ...LIST[2], project: ACME, state: STATES[1] }]],
    ["GET", /\/work-items\/ACM-99\//, () => [404, { error: "Work item not found" }]],
    ["GET", new RegExp(`${P}/$`), () => [200, { ...ACME, description: "Main product" }]],
    ["GET", new RegExp(`${P}/members/$`), () => [200, [ME, ALI]]],
    ["GET", new RegExp(`${P}/states/`), () => [200, page(STATES)]],
    ["GET", new RegExp(`${P}/labels/`), () => [200, page(LABELS)]],
    ["POST", new RegExp(`${P}/labels/$`), (_u, body) => [201, { id: "l9", name: body.name }]],
    ["GET", new RegExp(`${P}/cycles/\\?`), () => [200, page(CYCLES)]],
    ["POST", new RegExp(`${P}/cycles/$`), (_u, body) => [201, { id: "c9", ...body }]],
    ["POST", new RegExp(`${P}/cycles/c\\d/cycle-issues/$`), () => [201, {}]],
    ["GET", new RegExp(`${P}/modules/\\?`), () => [200, page([{ id: "m1", name: "Auth" }])]],
    ["POST", new RegExp(`${P}/modules/m1/module-issues/$`), () => [201, {}]],
    ["GET", new RegExp(`${P}/work-items/\\?`), () => [200, page(LIST)]],
    ["POST", new RegExp(`${P}/work-items/$`), () => [201, { id: "t9", sequence_id: 9 }]],
    ["PATCH", new RegExp(`${P}/work-items/t\\d/$`), (_u, body) => [200, { ...LIST[0], ...body }]],
    ["DELETE", new RegExp(`${P}/work-items/t1/$`), () => [204, null]],
    [
      "GET",
      /\/work-items\/t1\/comments\//,
      () => [
        200,
        page([
          { actor: { display_name: "Ali" }, created_at: "2026-03-03T10:00:00Z", comment_html: "<p>Looks good</p>" },
        ]),
      ],
    ],
    ["POST", /\/work-items\/t1\/comments\/$/, () => [201, {}]],
    ["GET", /\/work-items\/t1\/links\//, () => [200, page([{ title: "PR", url: "https://git.test/pr/1" }])]],
    ["POST", /\/work-items\/t1\/links\/$/, () => [201, {}]],
    ["POST", /\/work-items\/t1\/relations\/$/, () => [201, {}]],
  ];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method, url: req.url, key: req.headers["x-api-key"], body });
      const route = routes.find(([m, re]) => m === req.method && re.test(req.url));
      const [status, data] = route ? route[2](req.url, body) : [404, { error: `no route ${req.method} ${req.url}` }];
      res.writeHead(status, { "content-type": "application/json", connection: "close" });
      res.end(data === null ? "" : JSON.stringify(data));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ calls, server, port: server.address().port })));
}

/** A connected MCP client + the fake API; cleaned up when the test ends. */
async function connect(t) {
  const fake = await fakeVynk();
  const vynk = new Vynk({ baseUrl: `http://127.0.0.1:${fake.port}`, workspace: "acme", apiKey: "key-1" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(vynk, { now: () => WED }).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  t.after(async () => {
    await client.close();
    fake.server.closeAllConnections();
    fake.server.close();
  });
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return { text: res.content.map((c) => c.text).join("\n"), isError: !!res.isError };
  };
  const sent = (method, re) => fake.calls.filter((c) => c.method === method && re.test(c.url)).map((c) => c.body);
  return { ...fake, client, call, sent };
}

test("offers the full set of tools", async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).toSorted(), [
    "add_comment",
    "add_link",
    "add_tasks_to",
    "create_cycle",
    "create_module",
    "create_project",
    "create_task",
    "delete_task",
    "get_task",
    "list_projects",
    "list_tasks",
    "log_time",
    "my_hours",
    "project_overview",
    "relate_tasks",
    "search_tasks",
    "team_hours",
    "update_task",
    "vynk_api",
    "whoami",
  ]);
  assert.equal(tools.find((x) => x.name === "delete_task").annotations.destructiveHint, true);
});

test("create_task with every field resolves names to ids", async (t) => {
  const { call, sent } = await connect(t);
  const res = await call("create_task", {
    project: "acm",
    title: "Fix login",
    description: "Steps:\n1. open",
    status: "in progress",
    priority: "urgent",
    assignees: ["me", "ali@acme.test"],
    labels: ["bug", "backend"],
    start_date: "today",
    due_date: "2026-03-10",
    parent: "ACM-3",
    cycle: "current",
    module: "auth",
  });
  assert.equal(res.isError, false, res.text);
  assert.match(res.text, /Created ACM-9: Fix login in Acme\. Added to cycle Sprint 2 and module Auth\./);
  assert.deepEqual(sent("POST", /\/labels\/$/), [{ name: "backend" }]);
  assert.deepEqual(sent("POST", /\/work-items\/$/)[0], {
    name: "Fix login",
    description_html: "<p>Steps:<br />1. open</p>",
    state: "s2",
    priority: "urgent",
    start_date: "2026-03-04",
    target_date: "2026-03-10",
    parent: "t1",
    assignees: ["u1", "u2"],
    labels: ["l1", "l9"],
  });
  assert.deepEqual(sent("POST", /cycle-issues/), [{ issues: ["t9"] }]);
  assert.deepEqual(sent("POST", /module-issues/), [{ issues: ["t9"] }]);
});

test("create_task assigns to you by default, or to nobody", async (t) => {
  const { call, sent } = await connect(t);
  await call("create_task", { project: "Acme", title: "A" });
  await call("create_task", { project: "Acme", title: "B", assign_to_me: false });
  assert.deepEqual(
    sent("POST", /\/work-items\/$/).map((b) => b.assignees),
    [["u1"], []]
  );
});

test("update_task adds and removes people and labels, and clears dates", async (t) => {
  const { call, sent } = await connect(t);
  const res = await call("update_task", {
    key: "ACM-3",
    add_assignees: ["Ali"],
    remove_labels: ["bug"],
    due_date: "none",
    status: "done",
  });
  assert.equal(res.isError, false, res.text);
  assert.deepEqual(sent("PATCH", /work-items\/t1/)[0], {
    state: "s3",
    target_date: null,
    assignees: ["u1", "u2"],
    labels: [],
  });
  assert.match(res.text, /ACM-3: Write docs · Status: Done/);
});

test("names that don't match say what the choices are", async (t) => {
  const { call } = await connect(t);
  assert.match(
    (await call("create_task", { project: "nope", title: "x" })).text,
    /No project matches "nope"\. Choices: ACM \(Acme\)\./
  );
  assert.match(
    (await call("update_task", { key: "ACM-3", status: "shipped" })).text,
    /No status matches "shipped"\. Choices: Todo, In Progress, Done\./
  );
  assert.match(
    (await call("update_task", { key: "ACM-3", assignees: ["zed"] })).text,
    /No project member matches "zed"\. Choices: Sam <sam@acme\.test>, Ali <ali@acme\.test>\./
  );
  assert.match((await call("get_task", { key: "ACM-99" })).text, /No task ACM-99\./);
  assert.match((await call("get_task", { key: "nonsense" })).text, /isn't a task key/);
});

test("get_task shows everything: people, labels, dates, description, links, comments", async (t) => {
  const { call } = await connect(t);
  const { text } = await call("get_task", { key: "acm-3" });
  assert.match(
    text,
    /^ACM-3: Write docs\nStatus: Todo\nPriority: high\nAssignees: Sam\nLabels: bug\nDates: \? → 2026-03-06\nProject: Acme/
  );
  assert.match(text, /Intro & setup\n- one/);
  assert.match(text, /Links:\n- PR: https:\/\/git\.test\/pr\/1/);
  assert.match(text, /Comments \(1\):\n- Ali \(2026-03-03\): Looks good/);
});

test("list_tasks filters open tasks by assignee, status and priority", async (t) => {
  const { call } = await connect(t);
  const open = (await call("list_tasks", { project: "ACM" })).text;
  assert.match(open, /ACM-3: Write docs/);
  assert.match(open, /ACM-5: Fix bug · Status: In Progress · Priority: urgent · Assignees: Ali/);
  assert.doesNotMatch(open, /Ship it/);
  assert.doesNotMatch((await call("list_tasks", { project: "ACM", assignee: "me" })).text, /Fix bug/);
  assert.match((await call("list_tasks", { project: "ACM", status: "completed" })).text, /^- ACM-4: Ship it/);
  assert.equal((await call("list_tasks", { project: "ACM", priority: "low" })).text, "No tasks match.");
  assert.match((await call("list_tasks", { project: "ACM", label: "bug" })).text, /^- ACM-3/);
});

test("search_tasks: your open tasks, or anything including closed ones", async (t) => {
  const { call } = await connect(t);
  assert.equal((await call("search_tasks")).text, "- ACM-3: Write docs (Acme)");
  assert.equal((await call("search_tasks", { query: "ship", include_closed: true })).text, "- ACM-4: Ship it");
});

test("comments, links, relations, delete", async (t) => {
  const { call, sent } = await connect(t);
  await call("add_comment", { key: "ACM-3", comment: "Done <soon>" });
  await call("add_link", { key: "ACM-3", url: "https://git.test/pr/2", title: "PR 2" });
  assert.equal(
    (await call("relate_tasks", { key: "ACM-3", relation: "blocked_by", others: ["ACM-5"] })).text,
    "ACM-3 blocked by ACM-5."
  );
  assert.equal((await call("delete_task", { key: "ACM-3" })).text, "Deleted ACM-3: Write docs.");
  assert.deepEqual(sent("POST", /comments/), [{ comment_html: "<p>Done &lt;soon&gt;</p>" }]);
  assert.deepEqual(sent("POST", /links/), [{ url: "https://git.test/pr/2", title: "PR 2" }]);
  assert.deepEqual(sent("POST", /relations/), [{ relation_type: "blocked_by", issues: ["t5"] }]);
});

test("project overview, cycles and modules", async (t) => {
  const { call, sent } = await connect(t);
  const overview = (await call("project_overview", { project: "ACM" })).text;
  assert.match(
    overview,
    /ACM: Acme — Main product\nStatuses: Todo \(unstarted\), In Progress \(started\), Done \(completed\)\nLabels: bug\nMembers: Sam <sam@acme\.test>, Ali <ali@acme\.test>\nCycles: Sprint 1/
  );
  await call("create_cycle", { project: "ACM", name: "Sprint 3", start_date: "2026-03-16", end_date: "2026-03-27" });
  assert.deepEqual(sent("POST", /\/cycles\/$/)[0], {
    name: "Sprint 3",
    start_date: "2026-03-16",
    end_date: "2026-03-27",
    owned_by: "u1",
    project_id: "p1",
  });
  const added = await call("add_tasks_to", { keys: ["ACM-3", "ACM-5"], cycle: "Sprint 1" });
  assert.equal(added.text, "Added ACM-3, ACM-5 to cycle Sprint 1.");
  assert.deepEqual(sent("POST", /c1\/cycle-issues/), [{ issues: ["t1", "t5"] }]);
});

test("log_time logs as you and reports the week", async (t) => {
  const { call, sent, calls } = await connect(t);
  const res = await call("log_time", { task: "acm-3", duration: "1h30", date: "yesterday", note: "intro" });
  assert.equal(res.text, "Logged 1h30 on ACM-3 (Write docs) for 2026-03-03. This week: 1h 30m.");
  assert.deepEqual(sent("POST", /time-entries/)[0], {
    issue_id: "t1",
    minutes: "1h30",
    spent_on: "2026-03-03",
    comment: "intro",
  });
  assert.ok(calls.every((c) => c.key === "key-1"));
});

test("my_hours and team_hours", async (t) => {
  const { call, calls } = await connect(t);
  assert.match((await call("my_hours")).text, /Your time 2026-03-02 to 2026-03-08\nTotal: 1h 30m/);
  assert.ok(calls.some((c) => c.url.includes("from=2026-03-02&to=2026-03-08&user_id=u1")));
  assert.match(
    (await call("team_hours", { period: "this_week" })).text,
    /Total: 2h 30m[\s\S]*- Sam: 1h 30m\n- Ali: 1h/
  );
  assert.match((await call("team_hours", { person: "ali" })).text, /Total: 1h\n/);
});

test("vynk_api reaches any endpoint as you", async (t) => {
  const { call, sent } = await connect(t);
  assert.match(
    (await call("vynk_api", { method: "GET", path: "/projects/p1/members/" })).text,
    /"email": "ali@acme\.test"/
  );
  await call("vynk_api", { method: "PATCH", path: "/projects/p1/work-items/t5/", body: { priority: "low" } });
  assert.deepEqual(sent("PATCH", /t5/), [{ priority: "low" }]);
  assert.match((await call("vynk_api", { method: "GET", path: "/nowhere/" })).text, /no route GET/);
});

test("helpers", () => {
  assert.deepEqual(rangeFor("this_week", WED), { from: "2026-03-02", to: "2026-03-08" });
  assert.deepEqual(rangeFor("last_week", WED), { from: "2026-02-23", to: "2026-03-01" });
  assert.deepEqual(rangeFor("last_month", WED), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(dayFor("tomorrow", WED), "2026-03-05");
  assert.throws(() => dayFor("someday", WED), /isn't a date/);
  assert.equal(toHtml("a\n\nb"), "<p>a</p><p>b</p>");
  assert.equal(stripHtml("<p>x &amp; y</p><ul><li>1</li></ul>"), "x & y\n- 1");
  assert.equal(summarize([]), "No time logged.");
});
