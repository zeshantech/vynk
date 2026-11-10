// The Vynk tools an AI assistant can call. Everything runs as the person whose API key is configured,
// so Vynk's own permissions apply (projects you're in, admin-only actions, the 24h/day time limit).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VynkError, personName } from "./vynk.js";

// ---------- small helpers ----------

const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** "this_week" | "last_week" | "this_month" | "last_month" -> { from, to } (Monday-first weeks, local time). */
export function rangeFor(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (period) {
    case "last_week":
      return { from: isoDay(addDays(monday, -7)), to: isoDay(addDays(monday, -1)) };
    case "this_month":
      return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
    case "last_month":
      return {
        from: isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: isoDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    default:
      return { from: isoDay(monday), to: isoDay(addDays(monday, 6)) };
  }
}

/** "today" | "yesterday" | "tomorrow" | "YYYY-MM-DD" -> YYYY-MM-DD. */
export function dayFor(value, now = new Date()) {
  const v = String(value ?? "today")
    .trim()
    .toLowerCase();
  if (v === "" || v === "today") return isoDay(now);
  if (v === "yesterday") return isoDay(addDays(now, -1));
  if (v === "tomorrow") return isoDay(addDays(now, 1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new VynkError(`"${value}" isn't a date. Use today, yesterday, tomorrow or YYYY-MM-DD.`, 400);
}

export const formatMinutes = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain text -> simple HTML paragraphs (Vynk stores rich text as HTML). */
export const toHtml = (text) =>
  String(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br />")}</p>`)
    .join("");
export const stripHtml = (html) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const text = (body) => ({ content: [{ type: "text", text: body }] });
const fail = (err) => ({
  isError: true,
  content: [{ type: "text", text: err instanceof VynkError ? err.message : `Something went wrong: ${err.message}` }],
});
/** Wraps a handler so Vynk errors come back to the assistant as readable tool errors. */
const safe = (fn) => async (args) => {
  try {
    return await fn(args ?? {});
  } catch (err) {
    return fail(err);
  }
};

const byTotal = (a, b) => b[1] - a[1];

/** Entries -> totals by person (optional) and by project and task. */
export function summarize(entries, { byPerson = false } = {}) {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  if (!entries.length) return "No time logged.";
  const lines = [`Total: ${formatMinutes(total)}`];
  if (byPerson) {
    const people = new Map();
    for (const e of entries) people.set(e.user.display_name, (people.get(e.user.display_name) ?? 0) + e.minutes);
    lines.push("", "By person:");
    for (const [name, m] of [...people].toSorted(byTotal)) lines.push(`- ${name}: ${formatMinutes(m)}`);
  }
  const projects = new Map();
  for (const e of entries) {
    const p = projects.get(e.project.name) ?? { total: 0, tasks: new Map() };
    p.total += e.minutes;
    const key = `${e.issue.key} ${e.issue.name}`;
    p.tasks.set(key, (p.tasks.get(key) ?? 0) + e.minutes);
    projects.set(e.project.name, p);
  }
  lines.push("", "By project and task:");
  for (const [name, p] of [...projects].toSorted((a, b) => b[1].total - a[1].total)) {
    lines.push(`- ${name}: ${formatMinutes(p.total)}`);
    for (const [task, m] of [...p.tasks].toSorted(byTotal)) lines.push(`  - ${task}: ${formatMinutes(m)}`);
  }
  return lines.join("\n");
}

const PRIORITY = z.enum(["urgent", "high", "medium", "low", "none"]);
const PERIOD = z
  .enum(["this_week", "last_week", "this_month", "last_month"])
  .optional()
  .describe("Shortcut range (Monday-first weeks). Default this_week. Ignored when from/to are given.");
const DAY = z.string().optional().describe("YYYY-MM-DD");
const KEY = z.string().describe("Task key like ACM-12");
const KEYS = z.array(z.string()).min(1).describe("Task keys like ACM-12");
const PEOPLE = z.array(z.string()).describe('Names, emails or "me" (must be project members)');
const CLOSED_GROUPS = new Set(["completed", "cancelled"]);
const projectIdOf = (t) => t.project?.id ?? t.project;

// ---------- the server ----------

export function createServer(vynk, { now = () => new Date() } = {}) {
  const server = new McpServer({ name: "vynk", version: "1.1.0" });
  const tool = (name, config, handler) => server.registerTool(name, config, safe(handler));
  const range = ({ period, from, to }) => (from && to ? { from, to } : rangeFor(period, now()));
  const today = () => isoDay(now());

  /** One work item as text: a single line, or everything (`full`). */
  async function describe(t, { full = false } = {}) {
    const projectId = projectIdOf(t);
    const project = (await vynk.projects()).find((p) => p.id === projectId) ?? t.project ?? {};
    const key = `${project.identifier ?? "?"}-${t.sequence_id}`;
    const [members, labels, states] = await Promise.all([
      vynk.members(projectId).catch(() => []),
      vynk.labels(projectId).catch(() => []),
      typeof t.state === "object" ? null : vynk.states(projectId).catch(() => []),
    ]);
    const nameOf = (id) => personName(members.find((m) => m.id === id) ?? { id });
    const state = typeof t.state === "object" ? t.state : states?.find((s) => s.id === t.state);
    const labelNames = (t.labels ?? []).map((id) => labels.find((l) => l.id === id)?.name ?? id);
    const parts = [
      `${key}: ${t.name}`,
      `Status: ${state?.name ?? "?"}`,
      `Priority: ${t.priority ?? "none"}`,
      `Assignees: ${(t.assignees ?? []).map(nameOf).join(", ") || "nobody"}`,
    ];
    if (labelNames.length) parts.push(`Labels: ${labelNames.join(", ")}`);
    if (t.start_date || t.target_date) parts.push(`Dates: ${t.start_date ?? "?"} → ${t.target_date ?? "?"}`);
    if (!full) return parts.join(" · ");
    if (project.name) parts.push(`Project: ${project.name}`);
    if (t.parent) parts.push(`Parent id: ${t.parent}`);
    parts.push(`Link: ${vynk.link(`/browse/${key}/`)}`);
    const desc = stripHtml(t.description_html);
    if (desc) parts.push("", desc);
    return parts.join("\n");
  }

  // ======== account and projects ========

  tool(
    "whoami",
    {
      title: "Who am I",
      description: "The Vynk account and workspace these tools act as.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const me = await vynk.me();
      return text(`${me.name} <${me.email}> in workspace "${vynk.workspace}" (${vynk.link("/")})`);
    }
  );

  tool(
    "list_projects",
    {
      title: "List projects",
      description: "Projects you're a member of, with their keys (e.g. ACM).",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const list = await vynk.projects();
      return text(list.length ? list.map((p) => `- ${p.identifier}: ${p.name}`).join("\n") : "No projects.");
    }
  );

  tool(
    "project_overview",
    {
      title: "Project overview",
      description:
        "Everything needed to work in a project: its statuses, labels, members, cycles and modules. Call this before creating or updating tasks in an unfamiliar project.",
      inputSchema: { project: z.string().describe("Project key, name or id") },
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      const p = await vynk.project(project);
      const [details, states, labels, members, cycles, modules] = await Promise.all([
        vynk.projectDetails(p.id).catch(() => ({})),
        vynk.states(p.id),
        vynk.labels(p.id),
        vynk.members(p.id),
        vynk.cycles(p.id).catch(() => []),
        vynk.modules(p.id).catch(() => []),
      ]);
      const desc = stripHtml(details.description_html ?? details.description);
      return text(
        [
          `${p.identifier}: ${p.name}${desc ? ` — ${desc}` : ""}`,
          `Statuses: ${states.map((s) => `${s.name} (${s.group})`).join(", ")}`,
          `Labels: ${labels.map((l) => l.name).join(", ") || "none"}`,
          `Members: ${members.map((m) => `${personName(m)} <${m.email}>`).join(", ")}`,
          `Cycles: ${cycles.map((c) => `${c.name} (${c.start_date ?? "?"} → ${c.end_date ?? "?"})`).join(", ") || "none"}`,
          `Modules: ${modules.map((m) => m.name).join(", ") || "none"}`,
        ].join("\n")
      );
    }
  );

  tool(
    "create_project",
    {
      title: "Create project",
      description: "Create a project (needs permission to create projects in the workspace). You become its admin.",
      inputSchema: {
        name: z.string().min(1).max(255),
        identifier: z.string().max(12).optional().describe("Short key like ACM; made from the name if omitted"),
        description: z.string().optional(),
      },
    },
    async ({ name, identifier, description }) => {
      const p = await vynk.createProject({ name, identifier: identifier?.toUpperCase(), description });
      return text(`Created project ${p.identifier}: ${p.name}. ${vynk.link(`/projects/${p.id}/issues/`)}`);
    }
  );

  // ======== finding tasks ========

  tool(
    "search_tasks",
    {
      title: "Search tasks",
      description:
        "Find tasks by words or key. With no query and no project, returns open tasks assigned to you. include_closed also finds done/cancelled tasks.",
      inputSchema: {
        query: z.string().optional().describe("Words from the title, or a key like ACM-12"),
        project: z.string().optional().describe("Project key, name or id"),
        assigned_to_me: z.boolean().optional(),
        include_closed: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query: q, project, assigned_to_me, include_closed, limit }) => {
      const projectId = project ? (await vynk.project(project)).id : undefined;
      if (include_closed && q) {
        const found = await vynk.searchAll({ q, projectId, limit: limit ?? 20 });
        if (!found.length) return text("No tasks found.");
        return text(found.map((t) => `- ${t.project__identifier}-${t.sequence_id}: ${t.name}`).join("\n"));
      }
      const assigned = assigned_to_me ?? (!q && !projectId);
      const tasks = await vynk.openTasks({ q, projectId, assigned, limit: limit ?? 30 });
      if (!tasks.length) return text("No open tasks found.");
      return text(tasks.map((t) => `- ${t.key}: ${t.name} (${t.project.name})`).join("\n"));
    }
  );

  tool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Tasks in a project, filtered by status, assignee, priority, label or due date. Open tasks only unless include_closed or a status is given.",
      inputSchema: {
        project: z.string().describe("Project key, name or id"),
        status: z.string().optional().describe("Status name or group (backlog, unstarted, started, completed)"),
        assignee: z.string().optional().describe('Name, email, "me" or "nobody"'),
        priority: PRIORITY.optional(),
        label: z.string().optional(),
        due_before: DAY,
        include_closed: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, status, assignee, priority, label, due_before, include_closed, limit = 50 }) => {
      const p = await vynk.project(project);
      const [tasks, states, labels] = await Promise.all([
        vynk.projectTasks(p.id),
        vynk.states(p.id),
        vynk.labels(p.id),
      ]);
      const stateOf = (t) => (typeof t.state === "object" ? t.state : states.find((s) => s.id === t.state)) ?? {};
      const wantState = status ? await vynk.state(p.id, status) : null;
      const byGroup = wantState && status.trim().toLowerCase() === wantState.group;
      const nobody = assignee?.toLowerCase() === "nobody";
      const who = assignee && !nobody ? (await vynk.person(p.id, assignee)).id : null;
      const labelId = label ? labels.find((l) => l.name.toLowerCase() === label.toLowerCase())?.id : null;
      if (label && !labelId)
        throw new VynkError(`No label "${label}". Labels: ${labels.map((l) => l.name).join(", ") || "none"}.`, 404);
      const shown = tasks.filter((t) => {
        const s = stateOf(t);
        if (wantState && (byGroup ? s.group !== wantState.group : s.id !== wantState.id)) return false;
        if (!wantState && !include_closed && CLOSED_GROUPS.has(s.group)) return false;
        if (nobody && t.assignees?.length) return false;
        if (who && !(t.assignees ?? []).includes(who)) return false;
        if (priority && t.priority !== priority) return false;
        if (labelId && !(t.labels ?? []).includes(labelId)) return false;
        if (due_before && !(t.target_date && t.target_date <= due_before)) return false;
        return true;
      });
      if (!shown.length) return text("No tasks match.");
      const lines = await Promise.all(shown.slice(0, limit).map((t) => describe(t)));
      const more = shown.length > limit ? `\n…and ${shown.length - limit} more` : "";
      return text(lines.map((l) => `- ${l}`).join("\n") + more);
    }
  );

  tool(
    "get_task",
    {
      title: "Get task",
      description:
        "Everything about one task: status, priority, assignees, labels, dates, description, links and comments.",
      inputSchema: { key: KEY },
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => {
      const t = await vynk.task(key);
      const projectId = projectIdOf(t);
      const [body, comments, links] = await Promise.all([
        describe(t, { full: true }),
        vynk.comments(projectId, t.id).catch(() => []),
        vynk.links(projectId, t.id).catch(() => []),
      ]);
      const out = [body];
      if (links.length) out.push("", "Links:", ...links.map((l) => `- ${l.title || l.url}: ${l.url}`));
      if (comments.length)
        out.push(
          "",
          `Comments (${comments.length}):`,
          ...comments
            .slice(-10)
            .map(
              (c) =>
                `- ${c.actor?.display_name ?? "someone"} (${String(c.created_at).slice(0, 10)}): ${stripHtml(c.comment_html)}`
            )
        );
      return text(out.join("\n"));
    }
  );

  // ======== creating and changing tasks ========

  /** Friendly fields -> the API body (ids for status, people, labels, parent). */
  async function taskBody(projectId, f, current = null) {
    const body = {};
    if (f.title !== undefined) body.name = f.title;
    if (f.description !== undefined) body.description_html = f.description ? toHtml(f.description) : "<p></p>";
    if (f.status) body.state = (await vynk.state(projectId, f.status)).id;
    if (f.priority) body.priority = f.priority;
    if (f.start_date !== undefined) body.start_date = f.start_date === "none" ? null : dayFor(f.start_date, now());
    if (f.due_date !== undefined) body.target_date = f.due_date === "none" ? null : dayFor(f.due_date, now());
    if (f.parent !== undefined) body.parent = f.parent === "none" ? null : (await vynk.task(f.parent)).id;
    const ids = (refs) => Promise.all(refs.map(async (r) => (await vynk.person(projectId, r)).id));
    if (f.assignees || f.add_assignees || f.remove_assignees) {
      let list = f.assignees ? await ids(f.assignees) : [...(current?.assignees ?? [])];
      if (f.add_assignees) list.push(...(await ids(f.add_assignees)));
      if (f.remove_assignees) {
        const drop = new Set(await ids(f.remove_assignees));
        list = list.filter((id) => !drop.has(id));
      }
      body.assignees = [...new Set(list)];
    }
    if (f.labels || f.add_labels || f.remove_labels) {
      let list = f.labels ? await vynk.labelIds(projectId, f.labels) : [...(current?.labels ?? [])];
      if (f.add_labels) list.push(...(await vynk.labelIds(projectId, f.add_labels)));
      if (f.remove_labels) {
        const drop = new Set(await vynk.labelIds(projectId, f.remove_labels, { create: false }));
        list = list.filter((id) => !drop.has(id));
      }
      body.labels = [...new Set(list)];
    }
    return body;
  }

  const TASK_FIELDS = {
    description: z.string().optional().describe("Plain text; blank lines make paragraphs"),
    status: z.string().optional().describe("Status name, e.g. Todo, In Progress, Done"),
    priority: PRIORITY.optional(),
    start_date: z.string().optional().describe('YYYY-MM-DD, today, tomorrow, or "none" to clear'),
    due_date: z.string().optional().describe('YYYY-MM-DD, today, tomorrow, or "none" to clear'),
    labels: z.array(z.string()).optional().describe("Label names (missing ones are created)"),
    parent: z.string().optional().describe('Parent task key, or "none" to clear'),
    cycle: z.string().optional().describe('Cycle name, or "current", to add the task to'),
    module: z.string().optional().describe("Module name to add the task to"),
  };

  async function placeInCycleAndModule(projectId, taskIds, { cycle, module }) {
    const notes = [];
    if (cycle) {
      const c = await vynk.cycle(projectId, cycle, today());
      await vynk.addToCycle(projectId, c.id, taskIds);
      notes.push(`cycle ${c.name}`);
    }
    if (module) {
      const m = await vynk.module(projectId, module);
      await vynk.addToModule(projectId, m.id, taskIds);
      notes.push(`module ${m.name}`);
    }
    return notes;
  }

  tool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create a task with any fields. Assigned to you unless assignees is given or assign_to_me is false. Use project_overview to see valid statuses, labels and people.",
      inputSchema: {
        project: z.string().describe("Project key, name or id"),
        title: z.string().min(1).max(255),
        assignees: PEOPLE.optional(),
        assign_to_me: z.boolean().optional(),
        ...TASK_FIELDS,
      },
    },
    async ({ project, title, assignees, assign_to_me, cycle, module, ...fields }) => {
      const p = await vynk.project(project);
      const who = assignees ?? (assign_to_me === false ? [] : ["me"]);
      const body = await taskBody(p.id, { ...fields, title, assignees: who });
      const t = await vynk.createTask(p.id, body);
      const key = `${p.identifier}-${t.sequence_id}`;
      const placed = await placeInCycleAndModule(p.id, [t.id], { cycle, module });
      const where = placed.length ? ` Added to ${placed.join(" and ")}.` : "";
      return text(`Created ${key}: ${title} in ${p.name}.${where} ${vynk.link(`/browse/${key}/`)}`);
    }
  );

  tool(
    "update_task",
    {
      title: "Update task",
      description:
        "Change any fields of a task: title, description, status, priority, dates, assignees, labels, parent, cycle, module. `assignees`/`labels` replace the list; add_*/remove_* change it.",
      inputSchema: {
        key: KEY,
        title: z.string().min(1).max(255).optional(),
        assignees: PEOPLE.optional().describe("Replace assignees"),
        add_assignees: PEOPLE.optional(),
        remove_assignees: PEOPLE.optional(),
        add_labels: z.array(z.string()).optional(),
        remove_labels: z.array(z.string()).optional(),
        ...TASK_FIELDS,
      },
    },
    async ({ key, cycle, module, ...fields }) => {
      const t = await vynk.task(key);
      const projectId = projectIdOf(t);
      const body = await taskBody(projectId, fields, t);
      const updated = Object.keys(body).length ? await vynk.updateTask(projectId, t.id, body) : {};
      const placed = await placeInCycleAndModule(projectId, [t.id], { cycle, module });
      const where = placed.length ? ` Added to ${placed.join(" and ")}.` : "";
      const after = { ...t, ...updated, state: typeof updated.state === "string" ? updated.state : t.state };
      if (body.state) after.state = body.state;
      return text(`Updated.${where}\n${await describe(after)}`);
    }
  );

  tool(
    "delete_task",
    {
      title: "Delete task",
      description: "Delete a task. Only when the user clearly asked to delete it.",
      inputSchema: { key: KEY },
      annotations: { destructiveHint: true },
    },
    async ({ key }) => {
      const t = await vynk.task(key);
      await vynk.deleteTask(projectIdOf(t), t.id);
      return text(`Deleted ${key.toUpperCase()}: ${t.name}.`);
    }
  );

  tool(
    "add_comment",
    {
      title: "Add comment",
      description: "Comment on a task.",
      inputSchema: { key: KEY, comment: z.string().min(1) },
    },
    async ({ key, comment }) => {
      const t = await vynk.task(key);
      await vynk.comment(projectIdOf(t), t.id, toHtml(comment));
      return text(`Commented on ${key.toUpperCase()}.`);
    }
  );

  tool(
    "add_link",
    {
      title: "Add link",
      description: "Attach a URL (PR, doc, design…) to a task.",
      inputSchema: { key: KEY, url: z.string().url(), title: z.string().optional() },
    },
    async ({ key, url, title }) => {
      const t = await vynk.task(key);
      await vynk.addLink(projectIdOf(t), t.id, { url, title });
      return text(`Linked ${url} to ${key.toUpperCase()}.`);
    }
  );

  tool(
    "relate_tasks",
    {
      title: "Relate tasks",
      description: "Mark a task as blocking, blocked by, duplicate of, or related to other tasks.",
      inputSchema: {
        key: KEY,
        relation: z.enum([
          "blocking",
          "blocked_by",
          "duplicate",
          "relates_to",
          "start_before",
          "start_after",
          "finish_before",
          "finish_after",
        ]),
        others: KEYS,
      },
    },
    async ({ key, relation, others }) => {
      const t = await vynk.task(key);
      const ids = await Promise.all(others.map(async (k) => (await vynk.task(k)).id));
      await vynk.relate(projectIdOf(t), t.id, relation, ids);
      const list = others.map((k) => k.toUpperCase()).join(", ");
      return text(`${key.toUpperCase()} ${relation.replace("_", " ")} ${list}.`);
    }
  );

  // ======== cycles and modules ========

  tool(
    "create_cycle",
    {
      title: "Create cycle",
      description: "Create a cycle (sprint) in a project.",
      inputSchema: {
        project: z.string(),
        name: z.string().min(1),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
        description: z.string().optional(),
      },
    },
    async ({ project, name, start_date, end_date, description }) => {
      const p = await vynk.project(project);
      const me = await vynk.me();
      const c = await vynk.createCycle(p.id, {
        name,
        start_date: dayFor(start_date, now()),
        end_date: dayFor(end_date, now()),
        owned_by: me.id,
        project_id: p.id,
        ...(description ? { description } : {}),
      });
      return text(`Created cycle ${c.name} in ${p.name} (${c.start_date} → ${c.end_date}).`);
    }
  );

  tool(
    "create_module",
    {
      title: "Create module",
      description: "Create a module (a feature or area grouping tasks) in a project.",
      inputSchema: { project: z.string(), name: z.string().min(1), description: z.string().optional() },
    },
    async ({ project, name, description }) => {
      const p = await vynk.project(project);
      const m = await vynk.createModule(p.id, { name, ...(description ? { description } : {}) });
      return text(`Created module ${m.name} in ${p.name}.`);
    }
  );

  tool(
    "add_tasks_to",
    {
      title: "Add tasks to a cycle or module",
      description: "Put tasks (all from one project) into a cycle and/or a module.",
      inputSchema: {
        keys: KEYS,
        cycle: z.string().optional().describe('Cycle name or "current"'),
        module: z.string().optional(),
      },
    },
    async ({ keys, cycle, module }) => {
      if (!cycle && !module) throw new VynkError("Say which cycle or module.", 400);
      const tasks = await Promise.all(keys.map((k) => vynk.task(k)));
      const projectId = projectIdOf(tasks[0]);
      if (tasks.some((t) => projectIdOf(t) !== projectId))
        throw new VynkError("All tasks must be in the same project.", 400);
      const placed = await placeInCycleAndModule(
        projectId,
        tasks.map((t) => t.id),
        { cycle, module }
      );
      return text(`Added ${keys.map((k) => k.toUpperCase()).join(", ")} to ${placed.join(" and ")}.`);
    }
  );

  // ======== time ========

  tool(
    "log_time",
    {
      title: "Log time",
      description:
        "Log time you spent on a task. Only in projects you're a member of, at most 24h per day. Replies with your total for the week.",
      inputSchema: {
        task: KEY,
        duration: z.string().describe('How long: "1h30", "45m", "2h" or "1.5" (hours)'),
        date: z.string().optional().describe("today (default), yesterday or YYYY-MM-DD"),
        note: z.string().max(500).optional(),
      },
    },
    async ({ task, duration, date, note }) => {
      const key = task.trim().toUpperCase();
      const found = (await vynk.openTasks({ q: key, limit: 5 })).find((t) => t.key.toUpperCase() === key);
      if (!found) throw new VynkError(`No open task ${key} in a project you can log time in.`, 404);
      const spentOn = dayFor(date, now());
      await vynk.logTime({ taskId: found.id, duration, spentOn, comment: note });
      const me = await vynk.me();
      const mine = await vynk.timeEntries({ ...rangeFor("this_week", now()), userId: me.id });
      const total = mine.reduce((s, e) => s + e.minutes, 0);
      return text(
        `Logged ${duration} on ${found.key} (${found.name}) for ${spentOn}. This week: ${formatMinutes(total)}.`
      );
    }
  );

  tool(
    "my_hours",
    {
      title: "My hours",
      description: "Your logged time for a period, by project and task.",
      inputSchema: { period: PERIOD, from: DAY, to: DAY },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const r = range(args);
      const me = await vynk.me();
      return text(`Your time ${r.from} to ${r.to}\n${summarize(await vynk.timeEntries({ ...r, userId: me.id }))}`);
    }
  );

  tool(
    "team_hours",
    {
      title: "Team hours",
      description:
        "Everyone's logged time for a period, by person and by project and task. Needs a workspace admin; others see only their own time.",
      inputSchema: {
        period: PERIOD,
        from: DAY,
        to: DAY,
        project: z.string().optional().describe("Only this project"),
        person: z.string().optional().describe("Only this person (name or email)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, person, ...args }) => {
      const r = range(args);
      const p = project ? await vynk.project(project) : null;
      const userId = person && p ? (await vynk.person(p.id, person)).id : undefined;
      let entries = await vynk.timeEntries({ ...r, projectId: p?.id, userId });
      if (person && !p) {
        const needle = person.toLowerCase();
        entries = entries.filter((e) => e.user.display_name.toLowerCase().includes(needle));
      }
      return text(`Team time ${r.from} to ${r.to}\n${summarize(entries, { byPerson: true })}`);
    }
  );

  // ======== anything else ========

  tool(
    "vynk_api",
    {
      title: "Call the Vynk API",
      description: [
        "Call any Vynk (Plane) public API endpoint as yourself, for anything the other tools don't cover.",
        "path is relative to the workspace (e.g. /projects/{project_id}/work-items/{id}/activities/), or from /api/v1 when it starts with /users/ or /workspaces/.",
        "Endpoints: /projects/ · /projects/{pid}/ · /projects/{pid}/work-items/ · /projects/{pid}/work-items/{id}/(comments|links|activities|relations|attachments)/ ·",
        "/projects/{pid}/(states|labels|members|cycles|modules|estimates|intake-issues)/ · /projects/{pid}/cycles/{cid}/cycle-issues/ ·",
        "/projects/{pid}/modules/{mid}/module-issues/ · /work-items/search/?search= · /work-items/{KEY}/ · /time-entries/?from=&to=.",
        "Rich text fields are HTML (description_html, comment_html). Ask the user before DELETE.",
      ].join(" "),
      inputSchema: {
        method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
        path: z.string().startsWith("/"),
        body: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ method, path, body }) => {
      const full = /^\/(users|workspaces)\//.test(path) ? path : vynk.ws(path);
      const data = await vynk.request(method, full, method === "GET" ? undefined : (body ?? {}));
      if (method !== "GET") vynk.cache.clear();
      const out = data === null ? "OK" : JSON.stringify(data, null, 2);
      return text(out.length > 20_000 ? `${out.slice(0, 20_000)}\n… (truncated)` : out);
    }
  );

  return server;
}
