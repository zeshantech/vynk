// Minimal clients for the Vynk (Plane) public API.
// `Plane` talks to one workspace with one person's API key (made when they connect Slack).
// `SlackLinks` asks Vynk which account and workspace a Slack user connected, using the shared bot secret.

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

/** Which Vynk account and workspace each Slack user connected (see /slack/connect/<code> in Vynk). */
export class SlackLinks {
  constructor({ baseUrl, secret, teamId = null }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secret = secret;
    this.teamId = teamId;
  }

  async request(method, path, body) {
    const res = await fetch(`${this.baseUrl}/api/v1/slack${path}`, {
      method,
      headers: { "X-Slack-Bot-Secret": this.secret, "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (res.status === 404 && data?.error === "not_connected") return null;
    if (!res.ok) {
      const hint = res.status === 403 ? " (check SLACK_BOT_SECRET matches on the bot and the API)" : "";
      throw new PlaneError(`${data?.error ?? data?.detail ?? `${res.status} ${res.statusText}`}${hint}`, res.status);
    }
    return data;
  }

  /** The page where this Slack user signs in to Vynk and picks a workspace. */
  async connectUrl(slackUserId) {
    const { code } = await this.request("POST", "/connect-code/", { team_id: this.teamId, user_id: slackUserId });
    return `${this.baseUrl}/slack/connect/${encodeURIComponent(code)}`;
  }

  /** { user: { id, email, display_name }, workspace: { slug, name }, api_token } or null when not connected. */
  find(slackUserId) {
    const q = new URLSearchParams({ team_id: this.teamId, user_id: slackUserId });
    return this.request("GET", `/link/?${q}`);
  }

  /** Every connected Slack user (for the weekly reminder). */
  all() {
    return this.request("GET", "/links/");
  }
}
