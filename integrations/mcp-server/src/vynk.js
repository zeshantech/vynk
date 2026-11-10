// Client for the Vynk (Plane) public API, acting as the person whose API key it holds.
// Besides raw calls it resolves the names people use ("ACM", "Sam", "Done", "bug", "Sprint 4") to ids.

export class VynkError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const query = (params) => {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
  );
  return q.size ? `?${q}` : "";
};

const TASK_KEY = /^([A-Za-z0-9]+)-(\d+)$/;
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();
const rows = (data) => (Array.isArray(data) ? data : (data?.results ?? []));

/** Exact match on any of the names, else a single partial match; otherwise an error listing the choices. */
export function pick(list, ref, { what, names, show }) {
  const needle = norm(ref);
  const exact = list.find((item) => item.id === ref || names(item).some((n) => norm(n) === needle));
  if (exact) return exact;
  const partial = list.filter((item) => names(item).some((n) => norm(n).includes(needle)));
  if (needle && partial.length === 1) return partial[0];
  const choices = list.map(show).join(", ") || "none";
  const why = partial.length > 1 ? `"${ref}" matches more than one ${what}` : `No ${what} matches "${ref}"`;
  throw new VynkError(`${why}. Choices: ${choices}.`, 404);
}

export const personName = (u) =>
  u.display_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || u.id;

export class Vynk {
  constructor({ baseUrl, workspace, apiKey, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.workspace = workspace;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  link(path) {
    return `${this.baseUrl}/${this.workspace}${path}`;
  }

  /** path: below /api/v1 (e.g. "/users/me/"). */
  async request(method, path, body) {
    const res = await this.fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: { "X-API-Key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text.slice(0, 300) };
    }
    if (!res.ok) {
      const detail =
        data?.error ??
        data?.detail ??
        (data && typeof data === "object"
          ? Object.entries(data)
              .map(([k, v]) => `${k}: ${[v].flat().join(" ")}`)
              .join("; ")
          : "");
      const hint = res.status === 401 ? " (check VYNK_API_KEY)" : "";
      throw new VynkError(`${detail || `${res.status} ${res.statusText}`}${hint}`, res.status);
    }
    return data;
  }

  ws(path) {
    return `/workspaces/${this.workspace}${path}`;
  }

  /** Every page of a paginated list (up to `max` items). */
  async all(path, max = 500) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 20 && out.length < max; page++) {
      const sep = path.includes("?") ? "&" : "?";
      // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor
      const data = await this.request("GET", `${path}${sep}per_page=100${cursor ? `&cursor=${cursor}` : ""}`);
      out.push(...rows(data));
      if (Array.isArray(data) || !data?.next_page_results) break;
      cursor = data.next_cursor;
    }
    return out.slice(0, max);
  }

  /** Cached for the life of the process (a minute), for lookups that rarely change. */
  async cached(key, load) {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await load();
    this.cache.set(key, { value, expires: Date.now() + 60_000 });
    return value;
  }

  forget(prefix) {
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  // ---------- me ----------
  me() {
    return this.cached("me", async () => {
      const u = await this.request("GET", "/users/me/");
      return { id: u.id, email: u.email, name: personName(u) };
    });
  }

  // ---------- projects ----------
  /** Projects you're a member of: [{ id, name, identifier }]. */
  projects() {
    return this.cached("projects", () => this.request("GET", this.ws("/time-entries/projects/")));
  }

  async project(ref) {
    return pick(await this.projects(), ref, {
      what: "project",
      names: (p) => [p.identifier, p.name],
      show: (p) => `${p.identifier} (${p.name})`,
    });
  }

  projectDetails(projectId) {
    return this.request("GET", this.ws(`/projects/${projectId}/`));
  }

  async createProject({ name, identifier, description }) {
    const base =
      identifier ||
      name
        .normalize("NFKD")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 5)
        .padEnd(2, "X");
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each attempt depends on the previous one failing
        const project = await this.request("POST", this.ws("/projects/"), {
          name,
          identifier: attempt ? `${base.slice(0, 4)}${attempt}` : base,
          ...(description ? { description } : {}),
        });
        this.forget("projects");
        return project;
      } catch (err) {
        if (identifier || !/identifier/i.test(err.message)) throw err;
      }
    }
    throw new VynkError("Couldn't find a free key for that project; pass one with identifier.", 409);
  }

  // ---------- people, statuses, labels, cycles, modules (per project) ----------
  members(projectId) {
    return this.cached(`members:${projectId}`, () => this.request("GET", this.ws(`/projects/${projectId}/members/`)));
  }

  async person(projectId, ref) {
    if (["me", "myself", "i"].includes(norm(ref))) return { id: (await this.me()).id, display_name: "you" };
    return pick(await this.members(projectId), ref, {
      what: "project member",
      names: (u) => [u.email, u.display_name, `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(), u.first_name],
      show: (u) => `${personName(u)} <${u.email}>`,
    });
  }

  states(projectId) {
    return this.cached(`states:${projectId}`, async () =>
      rows(await this.request("GET", this.ws(`/projects/${projectId}/states/`)))
    );
  }

  async state(projectId, ref) {
    return pick(await this.states(projectId), ref, {
      what: "status",
      names: (s) => [s.name, s.group],
      show: (s) => s.name,
    });
  }

  labels(projectId) {
    return this.cached(`labels:${projectId}`, () => this.all(this.ws(`/projects/${projectId}/labels/`)));
  }

  /** Label ids by name; missing labels are created when `create` is true. */
  async labelIds(projectId, names, { create = true } = {}) {
    const ids = [];
    for (const name of names) {
      // oxlint-disable-next-line no-await-in-loop -- a created label must be visible to the next lookup
      const list = await this.labels(projectId);
      const found = list.find((l) => l.id === name || norm(l.name) === norm(name));
      if (found) ids.push(found.id);
      else if (create) {
        // oxlint-disable-next-line no-await-in-loop -- same reason
        const made = await this.request("POST", this.ws(`/projects/${projectId}/labels/`), { name: name.trim() });
        this.forget(`labels:${projectId}`);
        ids.push(made.id);
      } else {
        throw new VynkError(`No label "${name}". Labels: ${list.map((l) => l.name).join(", ") || "none"}.`, 404);
      }
    }
    return ids;
  }

  cycles(projectId) {
    return this.cached(`cycles:${projectId}`, () => this.all(this.ws(`/projects/${projectId}/cycles/`)));
  }

  /** A cycle by name or id; "current" is the one running today. */
  async cycle(projectId, ref, today) {
    const list = await this.cycles(projectId);
    if (norm(ref) === "current") {
      const running = list.find((c) => c.start_date && c.end_date && c.start_date <= today && today <= c.end_date);
      if (!running) throw new VynkError("No cycle is running today in this project.", 404);
      return running;
    }
    return pick(list, ref, { what: "cycle", names: (c) => [c.name], show: (c) => c.name });
  }

  createCycle(projectId, body) {
    this.forget(`cycles:${projectId}`);
    return this.request("POST", this.ws(`/projects/${projectId}/cycles/`), body);
  }

  addToCycle(projectId, cycleId, issueIds) {
    return this.request("POST", this.ws(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/`), {
      issues: issueIds,
    });
  }

  cycleTasks(projectId, cycleId) {
    return this.all(this.ws(`/projects/${projectId}/cycles/${cycleId}/cycle-issues/`));
  }

  modules(projectId) {
    return this.cached(`modules:${projectId}`, () => this.all(this.ws(`/projects/${projectId}/modules/`)));
  }

  async module(projectId, ref) {
    return pick(await this.modules(projectId), ref, { what: "module", names: (m) => [m.name], show: (m) => m.name });
  }

  createModule(projectId, body) {
    this.forget(`modules:${projectId}`);
    return this.request("POST", this.ws(`/projects/${projectId}/modules/`), body);
  }

  addToModule(projectId, moduleId, issueIds) {
    return this.request("POST", this.ws(`/projects/${projectId}/modules/${moduleId}/module-issues/`), {
      issues: issueIds,
    });
  }

  // ---------- tasks ----------
  /** Open tasks you can log time on: [{ id, key, name, sequence_id, project: { id, name, identifier } }]. */
  openTasks({ q, projectId, assigned, limit = 50 } = {}) {
    return this.request(
      "GET",
      this.ws(`/time-entries/tasks/${query({ q, project_id: projectId, assigned: assigned ? "1" : "", limit })}`)
    );
  }

  /** Any task (open or closed) by words: [{ id, name, sequence_id, project__identifier, project_id }]. */
  async searchAll({ q, projectId, limit = 20 }) {
    const data = await this.request(
      "GET",
      this.ws(`/work-items/search/${query({ search: q, project_id: projectId, limit, workspace_search: "true" })}`)
    );
    return data?.issues ?? [];
  }

  /** Full work item by key ("ABC-12"), with state and project expanded. */
  async task(key) {
    const m = TASK_KEY.exec(String(key ?? "").trim());
    if (!m) throw new VynkError(`"${key}" isn't a task key like ABC-12.`, 400);
    try {
      return await this.request("GET", this.ws(`/work-items/${m[1].toUpperCase()}-${m[2]}/?expand=state,project`));
    } catch (err) {
      if (err.status === 404) throw new VynkError(`No task ${m[1].toUpperCase()}-${m[2]}.`, 404);
      throw err;
    }
  }

  projectTasks(projectId, max = 500) {
    return this.all(this.ws(`/projects/${projectId}/work-items/?expand=state&order_by=-updated_at`), max);
  }

  createTask(projectId, body) {
    return this.request("POST", this.ws(`/projects/${projectId}/work-items/`), body);
  }

  updateTask(projectId, taskId, changes) {
    return this.request("PATCH", this.ws(`/projects/${projectId}/work-items/${taskId}/`), changes);
  }

  deleteTask(projectId, taskId) {
    return this.request("DELETE", this.ws(`/projects/${projectId}/work-items/${taskId}/`));
  }

  comments(projectId, taskId) {
    return this.all(this.ws(`/projects/${projectId}/work-items/${taskId}/comments/?expand=actor`), 200);
  }

  comment(projectId, taskId, html) {
    return this.request("POST", this.ws(`/projects/${projectId}/work-items/${taskId}/comments/`), {
      comment_html: html,
    });
  }

  links(projectId, taskId) {
    return this.all(this.ws(`/projects/${projectId}/work-items/${taskId}/links/`), 100);
  }

  addLink(projectId, taskId, { url, title }) {
    return this.request("POST", this.ws(`/projects/${projectId}/work-items/${taskId}/links/`), {
      url,
      ...(title ? { title } : {}),
    });
  }

  relate(projectId, taskId, relationType, issueIds) {
    return this.request("POST", this.ws(`/projects/${projectId}/work-items/${taskId}/relations/`), {
      relation_type: relationType,
      issues: issueIds,
    });
  }

  // ---------- time ----------
  /** duration: "1h30", "45m", "1.5" (hours) or minutes as a number; the server validates it. */
  logTime({ taskId, duration, spentOn, comment }) {
    return this.request("POST", this.ws("/time-entries/"), {
      issue_id: taskId,
      minutes: duration,
      ...(spentOn ? { spent_on: spentOn } : {}),
      comment: comment ?? "",
    });
  }

  /** Entries between two days. Admins get everyone's unless userId is given; others get their own. */
  timeEntries({ from, to, userId, projectId }) {
    return this.request("GET", this.ws(`/time-entries/${query({ from, to, user_id: userId, project_id: projectId })}`));
  }
}
