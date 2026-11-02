// Minimal client for the Vynk (Plane) public API, using one workspace admin's API key.
// Admin keys may act for other people (user_id), which is how Slack users log time as themselves.

export class PlaneError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return q.size ? `?${q}` : "";
};

export class Plane {
  constructor({ baseUrl, workspace, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.workspace = workspace;
    this.apiKey = apiKey;
    this.members = null;
  }

  url(path) {
    return `${this.baseUrl}${path}`;
  }

  async request(method, path, body) {
    const res = await fetch(`${this.baseUrl}/api/v1/workspaces/${this.workspace}${path}`, {
      method,
      headers: { "X-API-Key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (!res.ok) {
      const detail =
        data?.error ?? data?.detail ?? (data && typeof data === "object" ? Object.values(data).flat().join("; ") : "");
      throw new PlaneError(detail || `${res.status} ${res.statusText}`, res.status);
    }
    return data;
  }

  // ---------- people ----------
  /** Workspace members: [{ id, email, name, admin }] (cached for a few minutes). */
  async people() {
    if (this.members && this.members.expires > Date.now()) return this.members.list;
    const data = await this.request("GET", "/members/");
    const list = (Array.isArray(data) ? data : (data?.results ?? [])).map((m) => ({
      id: m.id,
      email: (m.email ?? "").toLowerCase(),
      name: m.display_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email,
      admin: m.role === 20,
    }));
    this.members = { list, expires: Date.now() + 5 * 60_000 };
    return list;
  }

  async userByEmail(email) {
    const key = String(email ?? "").toLowerCase();
    return (await this.people()).find((p) => p.email === key) ?? null;
  }

  // ---------- projects and tasks (always from the point of view of one person) ----------
  projectsFor(userId) {
    return this.request("GET", `/time-entries/projects/${query({ user_id: userId })}`);
  }

  tasksFor(userId, { q, projectId, assigned, limit } = {}) {
    return this.request(
      "GET",
      `/time-entries/tasks/${query({ user_id: userId, q, project_id: projectId, assigned: assigned ? "1" : undefined, limit })}`
    );
  }

  /** The open task with this key ("ABC-12") that the person can log time on, or null. */
  async taskByKey(userId, key) {
    const wanted = String(key).toUpperCase();
    return (await this.tasksFor(userId, { q: wanted, limit: 5 })).find((t) => t.key.toUpperCase() === wanted) ?? null;
  }

  async createTask({ projectId, name, assigneeId }) {
    const task = await this.request("POST", `/projects/${projectId}/work-items/`, {
      name,
      ...(assigneeId ? { assignees: [assigneeId], created_by: assigneeId } : {}),
    });
    return task;
  }

  async createProject({ name, leadId }) {
    const identifier = name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 5);
    const base =
      identifier.length >= 2
        ? identifier
        : name
            .replace(/[^A-Za-z0-9]/g, "")
            .toUpperCase()
            .slice(0, 5) || "PRJ";
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each attempt depends on the previous one failing
        return await this.request("POST", "/projects/", {
          name,
          identifier: attempt ? `${base.slice(0, 4)}${attempt}` : base,
          ...(leadId ? { project_lead: leadId } : {}),
        });
      } catch (err) {
        if (!/identifier/i.test(err.message)) throw err;
      }
    }
    throw new PlaneError("Couldn't find a free short key for that project name.", 409);
  }

  // ---------- time ----------
  logTime({ userId, issueId, hours, spentOn, comment }) {
    return this.request("POST", "/time-entries/", {
      user_id: userId,
      issue_id: issueId,
      minutes: Math.round(hours * 60),
      spent_on: spentOn,
      comment: comment ?? "",
    });
  }

  /** Entries in the shape the Slack views use. Without userId: everyone's (admin key). */
  async timeEntries({ from, to, userId }) {
    const data = await this.request("GET", `/time-entries/${query({ from, to, user_id: userId })}`);
    return data.map((e) => ({
      hours: e.minutes / 60,
      spentOn: e.spent_on,
      userId: e.user.id,
      userName: e.user.display_name,
      workPackageId: e.issue.key,
      workPackageTitle: e.issue.name,
      projectId: e.project.id,
      projectTitle: e.project.name,
      comment: e.comment,
    }));
  }
}
