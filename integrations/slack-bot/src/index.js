import bolt from "@slack/bolt";
import { Plane, PlaneError, SlackLinks } from "./plane.js";
import { parseCreateTask, parseLogTime } from "./commands.js";
import { currentWeek, formatHours, hoursError, parseHours, resolveDate, todayIn } from "./time.js";
import { connectView, escape, loggedView, menuView, tasksView, teamView, weekView } from "./views.js";

const { App, LogLevel } = bolt;

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing env ${name}`);
  return value;
};

const TZ = process.env.BOT_TIMEZONE || "Asia/Karachi";
const BASE_URL = env("PLANE_URL").replace(/\/$/, "");
const MAX_ENTRIES = 5;

// Each Slack user connects their own Vynk account and picks a workspace on Vynk; the bot then uses
// that person's API token in that workspace. The team id is filled in from auth.test at startup.
const links = new SlackLinks({ baseUrl: BASE_URL, secret: env("SLACK_BOT_SECRET") });
const urlsFor = (slug) => ({
  wp: (key) => `${BASE_URL}/${slug}/browse/${key}/`,
  project: (p) => `${BASE_URL}/${slug}/projects/${p.id}/issues/`,
});

const app = new App({
  token: env("SLACK_BOT_TOKEN"),
  appToken: env("SLACK_APP_TOKEN"),
  socketMode: true,
  logLevel: process.env.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO,
});

// ---------- helpers ----------

class UserFacingError extends Error {}
/** The Slack user hasn't connected a Vynk account (or it stopped working); carries the connect link. */
class NotConnectedError extends UserFacingError {
  constructor(url) {
    super("Connect your Vynk account to use the bot.");
    this.url = url;
  }
}

const plain = (text) => ({ type: "plain_text", text, emoji: true });
const errorText = (err) => {
  if (err instanceof UserFacingError) return `:warning: ${err.message}`;
  if (err instanceof PlaneError) return `:x: Vynk said: ${escape(err.message)}`;
  return ":x: Something went wrong. Please try again.";
};
/** An error as a Slack message; not being connected comes with a "Connect Vynk account" button. */
const errorReply = (err) => (err instanceof NotConnectedError ? connectView(err.url) : { text: errorText(err) });
// Slack's chat.postMessage, not window.postMessage.
const dmUser = (client, channel, message) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  client.chat.postMessage({ channel, ...(typeof message === "string" ? { text: message } : message) });
const send = (respond, reply) => respond(typeof reply === "string" ? { text: reply } : reply);

const linkCache = new Map(); // slack user id -> { link, expires }; only connected users are cached
const clients = new Map(); // "token|slug" -> Plane, so each client's member cache is reused
const planeFor = (link) => {
  const key = `${link.api_token}|${link.workspace.slug}`;
  if (!clients.has(key))
    clients.set(key, new Plane({ baseUrl: BASE_URL, workspace: link.workspace.slug, apiKey: link.api_token }));
  return clients.get(key);
};

/**
 * The Vynk person behind a Slack user: { id, email, name, admin, workspace, plane, urls }.
 * Throws NotConnectedError (with a fresh connect link) when they haven't connected an account.
 */
async function vynkUser(_client, slackUserId) {
  let link = linkCache.get(slackUserId)?.expires > Date.now() ? linkCache.get(slackUserId).link : null;
  if (!link) {
    link = await links.find(slackUserId);
    if (!link) throw new NotConnectedError(await links.connectUrl(slackUserId));
    linkCache.set(slackUserId, { link, expires: Date.now() + 30_000 });
  }
  // Vynk only returns working links (active token, still a member), so no member lookup is needed;
  // listing members needs a workspace admin anyway.
  const { user } = link;
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    admin: Boolean(user.admin),
    workspace: link.workspace,
    plane: planeFor(link),
    urls: urlsFor(link.workspace.slug),
  };
}

/** A request failed because the person's token or membership is gone: drop the cached link. */
const forgetLink = (slackUserId, err) => {
  if (err instanceof PlaneError && [401, 403].includes(err.status)) linkCache.delete(slackUserId);
};

async function requireAdmin(client, slackUserId) {
  const user = await vynkUser(client, slackUserId);
  if (!user.admin) throw new UserFacingError("Only Vynk admins can do that.");
  return user;
}

function command(name, handler) {
  app.command(name, async ({ ack, command: cmd, client, respond, logger }) => {
    await ack();
    try {
      const reply = await handler({ cmd, client, text: (cmd.text ?? "").trim() });
      if (reply != null) await send(respond, { response_type: "ephemeral", ...asMessage(reply) });
    } catch (err) {
      forgetLink(cmd.user_id, err);
      if (!(err instanceof UserFacingError)) logger.error(`${name} failed`, err);
      await respond({ response_type: "ephemeral", ...errorReply(err) });
    }
  });
}
const asMessage = (reply) => (typeof reply === "string" ? { text: reply } : reply);

const asWp = (t) => ({ id: t.key, subject: t.name, _links: { project: { title: t.project.name } } });

// ---------- logging time ----------

async function weekTotal(user) {
  const week = currentWeek(TZ);
  const entries = await user.plane.timeEntries({ from: week.from, to: week.to, userId: user.id });
  return entries.reduce((sum, e) => sum + e.hours, 0);
}

/** entries: [{ hours, task, spentOn, comment }] -> a Slack message. The server enforces membership and the 24h/day cap. */
async function logEntries(user, entries) {
  const results = [];
  const failed = [];
  for (const e of entries) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- in order, so the 24h/day cap sees each entry
      await user.plane.logTime({
        userId: user.id,
        issueId: e.task.id,
        hours: e.hours,
        spentOn: e.spentOn,
        comment: e.comment,
      });
      results.push({ hours: e.hours, spentOn: e.spentOn, wp: asWp(e.task), created: [], activityName: null });
    } catch (err) {
      failed.push(`${e.task.key}: ${err instanceof PlaneError ? err.message : "couldn't be logged"}`);
    }
  }
  const warning = failed.length ? `\n:warning: Not logged — ${failed.map(escape).join("; ")}` : "";
  if (!results.length) return { text: `:x: Nothing was logged.${warning}` };
  const view = loggedView({ results, weekLabel: "This week", weekTotal: await weekTotal(user), urls: user.urls });
  return failed.length
    ? { ...view, blocks: [...view.blocks, { type: "context", elements: [{ type: "mrkdwn", text: warning.trim() }] }] }
    : view;
}

const taskOption = (t) => ({
  text: plain(`${t.key} · ${t.name}`.slice(0, 75)),
  value: `${t.id}|${t.key}|${t.project.name.slice(0, 60)}`,
});

const stateOf = (values = {}) => {
  const out = {};
  for (const [block, actions] of Object.entries(values)) {
    const a = Object.values(actions)[0] ?? {};
    out[block] = { text: a.value, date: a.selected_date, option: a.selected_option };
  }
  return out;
};

function entryBlocks(n, prev, today) {
  const p = (k) => prev[`e${n}_${k}`] ?? {};
  return [
    {
      type: "input",
      block_id: `e${n}_task`,
      label: plain("Task"),
      element: {
        type: "external_select",
        action_id: "lt_task",
        min_query_length: 0,
        placeholder: plain("Search any task, or type a key like ABC-12"),
        ...(p("task").option ? { initial_option: p("task").option } : {}),
      },
    },
    {
      type: "input",
      block_id: `e${n}_hours`,
      label: plain("Time"),
      element: {
        type: "plain_text_input",
        action_id: "hours",
        placeholder: plain("1h30m, 45m or 1.5"),
        ...(p("hours").text ? { initial_value: p("hours").text } : {}),
      },
    },
    {
      type: "input",
      block_id: `e${n}_date`,
      label: plain("Date"),
      element: { type: "datepicker", action_id: "date", initial_date: p("date").date ?? today },
    },
    {
      type: "input",
      optional: true,
      block_id: `e${n}_notes`,
      label: plain("Note"),
      element: {
        type: "plain_text_input",
        action_id: "notes",
        ...(p("notes").text ? { initial_value: p("notes").text } : {}),
      },
    },
  ];
}

function logTimeModal(count, prev = {}) {
  const today = todayIn(TZ);
  const blocks = [];
  for (let n = 1; n <= count; n++) {
    if (n > 1) blocks.push({ type: "divider" });
    if (count > 1) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Entry ${n}*` } });
    blocks.push(...entryBlocks(n, prev, today));
  }
  const buttons = [];
  if (count < MAX_ENTRIES)
    buttons.push({ type: "button", action_id: "lt_add", text: plain("+ Add another entry"), value: "add" });
  if (count > 1) buttons.push({ type: "button", action_id: "lt_remove", text: plain("Remove last"), value: "remove" });
  if (buttons.length) blocks.push({ type: "divider" }, { type: "actions", block_id: "entries", elements: buttons });
  return {
    type: "modal",
    callback_id: "log_time",
    private_metadata: JSON.stringify({ count }),
    title: plain("Log time"),
    submit: plain("Log time"),
    close: plain("Cancel"),
    blocks,
  };
}

async function openLogTimeModal(client, triggerId, prefill = {}) {
  const prev = {
    ...(prefill.hours ? { e1_hours: { text: String(prefill.hours) } } : {}),
    ...(prefill.comment ? { e1_notes: { text: prefill.comment } } : {}),
    ...(prefill.task ? { e1_task: { option: taskOption(prefill.task) } } : {}),
  };
  await client.views.open({ trigger_id: triggerId, view: logTimeModal(1, prev) });
}

// live task search: your assigned tasks first, anything you can log on as you type
app.options("lt_task", async ({ ack, body, client, logger }) => {
  try {
    const user = await vynkUser(client, body.user.id);
    const q = (body.value ?? "").trim();
    let tasks = await user.plane.tasksFor(user.id, { q, assigned: !q, limit: 100 });
    if (!q && !tasks.length) tasks = await user.plane.tasksFor(user.id, { limit: 100 });
    await ack({ options: tasks.slice(0, 100).map(taskOption) });
  } catch (err) {
    logger.error("task search failed", err);
    await ack({ options: [] });
  }
});

async function refreshLogTime({ body, client, logger }, delta) {
  try {
    const count = JSON.parse(body.view.private_metadata || "{}").count ?? 1;
    const next = Math.min(Math.max(count + delta, 1), MAX_ENTRIES);
    await client.views.update({ view_id: body.view.id, view: logTimeModal(next, stateOf(body.view.state?.values)) });
  } catch (err) {
    logger.error("log time refresh failed", err);
  }
}
app.action("lt_add", async (args) => {
  await args.ack();
  await refreshLogTime(args, 1);
});
app.action("lt_remove", async (args) => {
  await args.ack();
  await refreshLogTime(args, -1);
});

app.view("log_time", async ({ ack, body, view, client, logger }) => {
  const prev = stateOf(view.state.values);
  const count = JSON.parse(view.private_metadata || "{}").count ?? 1;
  const errors = {};
  const entries = [];
  for (let n = 1; n <= count; n++) {
    const option = prev[`e${n}_task`]?.option;
    const hoursText = prev[`e${n}_hours`]?.text ?? "";
    const bad = hoursError(hoursText);
    if (bad) errors[`e${n}_hours`] = bad;
    if (!option) errors[`e${n}_task`] = "Pick a task.";
    if (bad || !option) continue;
    const [id, key, project] = option.value.split("|");
    entries.push({
      hours: parseHours(hoursText),
      task: { id, key, name: option.text.text.replace(/^[^·]*·\s*/, ""), project: { name: project } },
      spentOn: prev[`e${n}_date`]?.date,
      comment: prev[`e${n}_notes`]?.text ?? "",
    });
  }
  if (Object.keys(errors).length) return ack({ response_action: "errors", errors });
  await ack();
  const dm = (message) => dmUser(client, body.user.id, message);
  try {
    await dm(await logEntries(await vynkUser(client, body.user.id), entries));
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("log_time submit failed", err);
    await dm(errorReply(err));
  }
});

app.command("/log-time", async ({ ack, command: cmd, client, respond, logger }) => {
  await ack();
  try {
    const parsed = parseLogTime(cmd.text);
    if (parsed.hours === null || parsed.taskKey === null) {
      const user = await vynkUser(client, cmd.user_id);
      const task = parsed.taskKey ? await user.plane.taskByKey(user.id, parsed.taskKey) : null;
      return await openLogTimeModal(client, cmd.trigger_id, { ...parsed, task });
    }
    const hoursProblem = hoursError(String(parsed.hours));
    if (hoursProblem) throw new UserFacingError(hoursProblem);
    const user = await vynkUser(client, cmd.user_id);
    const spentOn = resolveDate(parsed.date, TZ);
    if (!spentOn) throw new UserFacingError("Date must be `today`, `yesterday` or `YYYY-MM-DD`.");
    const task = await user.plane.taskByKey(user.id, parsed.taskKey);
    if (!task)
      throw new UserFacingError(`I can't find an open task ${parsed.taskKey} in a project you can log time on.`);
    await send(respond, {
      response_type: "ephemeral",
      ...asMessage(await logEntries(user, [{ hours: parsed.hours, task, spentOn, comment: parsed.comment }])),
    });
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("/log-time failed", err);
    await respond({ response_type: "ephemeral", ...errorReply(err) });
  }
});

// ---------- hours, tasks, projects ----------

async function weekHours({ cmd, client, text }) {
  const user = await vynkUser(client, cmd.user_id);
  const weeksBack = /^last/i.test(text) ? 1 : 0;
  const week = currentWeek(TZ, weeksBack);
  const entries = await user.plane.timeEntries({ from: week.from, to: week.to, userId: user.id });
  return weekView({
    label: weeksBack ? "Last week" : "This week",
    week,
    entries,
    urls: user.urls,
    otherWeekLabel: weeksBack ? "This week" : "Last week",
    otherWeekValue: weeksBack ? "this" : "last",
  });
}
command("/week-hours", weekHours);
command("/time-week-logged-times", weekHours);

async function teamHours({ cmd, client, text }) {
  const admin = await requireAdmin(client, cmd.user_id);
  const weeksBack = /^last/i.test(text) ? 1 : 0;
  const week = currentWeek(TZ, weeksBack);
  const [entries, users] = await Promise.all([
    admin.plane.timeEntries({ from: week.from, to: week.to }),
    admin.plane.people(),
  ]);
  return teamView({ label: weeksBack ? "Last week" : "This week", week, users, entries, urls: admin.urls });
}
command("/team-hours", teamHours);

async function myTasks({ cmd, client }) {
  const user = await vynkUser(client, cmd.user_id);
  const tasks = await user.plane.tasksFor(user.id, { assigned: true, limit: 30 });
  return tasksView({ tasks: tasks.map(asWp), urls: user.urls });
}
command("/my-tasks", myTasks);

async function projectsReply({ cmd, client }) {
  const user = await vynkUser(client, cmd.user_id);
  const week = currentWeek(TZ);
  const [projects, entries] = await Promise.all([
    user.plane.projectsFor(user.id),
    user.plane.timeEntries({ from: week.from, to: week.to, userId: user.id }),
  ]);
  if (!projects.length) return "You're not a member of any project yet.";
  const mine = new Map();
  for (const e of entries) mine.set(e.projectId, (mine.get(e.projectId) ?? 0) + e.hours);
  const lines = projects.map((p) => {
    const hours = mine.get(p.id);
    return `• <${user.urls.project(p)}|${escape(p.name)}> \`${escape(p.identifier)}\`${hours ? `  —  ${formatHours(hours)} this week` : ""}`;
  });
  return {
    text: "Projects",
    blocks: [
      { type: "header", text: plain("Projects") },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    ],
  };
}
command("/projects", projectsReply);

// ---------- creating tasks and projects ----------

function createTaskModal(projects) {
  return {
    type: "modal",
    callback_id: "create_task",
    title: plain("New task"),
    submit: plain("Create"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "project",
        label: plain("Project"),
        element: {
          type: "static_select",
          action_id: "v",
          placeholder: plain("Choose a project"),
          options: projects.slice(0, 100).map((p) => ({ text: plain(p.name.slice(0, 75)), value: p.id })),
        },
      },
      {
        type: "input",
        block_id: "title",
        label: plain("Title"),
        element: { type: "plain_text_input", action_id: "v", max_length: 255 },
      },
    ],
  };
}

async function openCreateTaskModal(client, triggerId, slackUserId) {
  const user = await vynkUser(client, slackUserId);
  const projects = await user.plane.projectsFor(user.id);
  if (!projects.length) throw new UserFacingError("You're not a member of any project yet.");
  await client.views.open({ trigger_id: triggerId, view: createTaskModal(projects) });
}

app.view("create_task", async ({ ack, body, view, client, logger }) => {
  await ack();
  const dm = (text) => dmUser(client, body.user.id, text);
  try {
    const user = await vynkUser(client, body.user.id);
    const projectId = view.state.values.project.v.selected_option.value;
    const name = view.state.values.title.v.value.trim();
    const task = await user.plane.createTask({ projectId, name, assigneeId: user.id });
    const key = (await user.plane.projectsFor(user.id)).find((p) => p.id === projectId)?.identifier;
    await dm(
      `:white_check_mark: Created <${user.urls.wp(`${key}-${task.sequence_id}`)}|${escape(name)}> and assigned it to you.`
    );
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("create_task failed", err);
    await dm(errorReply(err));
  }
});

app.command("/create-task", async ({ ack, command: cmd, client, respond, logger }) => {
  await ack();
  try {
    const { project: projectName, subject } = parseCreateTask(cmd.text);
    if (!projectName || !subject) return await openCreateTaskModal(client, cmd.trigger_id, cmd.user_id);
    const user = await vynkUser(client, cmd.user_id);
    const needle = projectName.toLowerCase();
    const projects = await user.plane.projectsFor(user.id);
    const project =
      projects.find((p) => p.identifier.toLowerCase() === needle || p.name.toLowerCase() === needle) ??
      projects.find((p) => p.name.toLowerCase().includes(needle));
    if (!project)
      throw new UserFacingError(`I can't find a project like "${projectName}" that you belong to. Try \`/projects\`.`);
    const task = await user.plane.createTask({ projectId: project.id, name: subject, assigneeId: user.id });
    await respond({
      response_type: "ephemeral",
      text: `:white_check_mark: Created <${user.urls.wp(`${project.identifier}-${task.sequence_id}`)}|${escape(subject)}> in ${escape(project.name)}.`,
    });
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("/create-task failed", err);
    await respond({ response_type: "ephemeral", ...errorReply(err) });
  }
});

async function createProjectFor(admin, name) {
  const project = await admin.plane.createProject({ name, leadId: admin.id });
  return `:white_check_mark: Created project <${admin.urls.project(project)}|${escape(project.name)}> (\`${escape(project.identifier)}\`). You're its admin.`;
}

app.view("create_project", async ({ ack, body, view, client, logger }) => {
  await ack();
  const dm = (text) => dmUser(client, body.user.id, text);
  try {
    await dm(await createProjectFor(await requireAdmin(client, body.user.id), view.state.values.name.v.value.trim()));
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("create_project failed", err);
    await dm(errorReply(err));
  }
});

command("/create-project", async ({ cmd, client, text }) => {
  const admin = await requireAdmin(client, cmd.user_id);
  if (text) return createProjectFor(admin, text);
  await client.views.open({
    trigger_id: cmd.trigger_id,
    view: {
      type: "modal",
      callback_id: "create_project",
      title: plain("New project"),
      submit: plain("Create"),
      close: plain("Cancel"),
      blocks: [
        {
          type: "input",
          block_id: "name",
          label: plain("Project name"),
          element: { type: "plain_text_input", action_id: "v", max_length: 255 },
        },
      ],
    },
  });
  return null;
});

// ---------- @Vynk menu ----------

const MENU = [
  ["log_time", "Log time"],
  ["week_hours", "My week"],
  ["my_tasks", "My tasks"],
  ["projects", "Projects"],
  ["create_task", "New task"],
];
const ADMIN_MENU = [["team_hours", "Team hours"]];
const menuFor = (user) => menuView(MENU, user.admin ? ADMIN_MENU : [], user.name, user.workspace.name);

/** The connect page again, to pick another workspace (or reconnect). */
async function switchWorkspace(slackUserId) {
  return connectView(await links.connectUrl(slackUserId), { switching: true });
}

command("/vynk", async ({ cmd, client, text }) => {
  if (/^(switch|workspace|connect)/i.test(text)) return switchWorkspace(cmd.user_id);
  const user = await vynkUser(client, cmd.user_id);
  return menuFor(user);
});

app.event("app_mention", async ({ event, client, logger }) => {
  try {
    const user = await vynkUser(client, event.user);
    await client.chat.postEphemeral({
      channel: event.channel,
      user: event.user,
      ...menuFor(user),
    });
  } catch (err) {
    logger.error("mention failed", err);
    await client.chat.postEphemeral({ channel: event.channel, user: event.user, ...errorReply(err) }).catch(() => null);
  }
});

// Slack doesn't send app_mention in the app's own DM, so answer plain messages there with the menu.
app.message(async ({ message, client, logger }) => {
  if (message.channel_type !== "im" || message.subtype || message.bot_id || !message.user) return;
  try {
    const user = await vynkUser(client, message.user);
    await client.chat.postEphemeral({
      channel: message.channel,
      user: message.user,
      ...menuFor(user),
    });
  } catch (err) {
    logger.error("dm failed", err);
    await client.chat
      .postEphemeral({ channel: message.channel, user: message.user, ...errorReply(err) })
      .catch(() => null);
  }
});

app.action(/^menu_.+$/, async ({ ack, body, action, client, respond, logger }) => {
  await ack();
  const cmd = { user_id: body.user.id };
  const reply = async (r) => send(respond, { response_type: "ephemeral", replace_original: false, ...asMessage(r) });
  try {
    switch (action.value) {
      case "log_time":
        return await openLogTimeModal(client, body.trigger_id);
      case "create_task":
        return await openCreateTaskModal(client, body.trigger_id, body.user.id);
      case "week_hours":
        return await reply(await weekHours({ cmd, client, text: "" }));
      case "my_tasks":
        return await reply(await myTasks({ cmd, client }));
      case "projects":
        return await reply(await projectsReply({ cmd, client }));
      case "switch_workspace":
        return await reply(await switchWorkspace(body.user.id));
      case "team_hours":
        return await reply(await teamHours({ cmd, client, text: "" }));
    }
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("menu failed", err);
    await reply(errorReply(err));
  }
});

// The connect button is a link; Slack still sends an action, which only needs an ack.
app.action("connect_vynk", async ({ ack }) => {
  await ack();
});

app.action("open_log_time", async ({ ack, body, client }) => {
  await ack();
  await openLogTimeModal(client, body.trigger_id);
});

app.action("show_week", async ({ ack, body, action, client, respond, logger }) => {
  await ack();
  try {
    await send(respond, {
      replace_original: true,
      ...asMessage(await weekHours({ cmd: { user_id: body.user.id }, client, text: action.value })),
    });
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("show_week failed", err);
    await respond({ response_type: "ephemeral", replace_original: false, ...errorReply(err) });
  }
});

// ---------- weekly reminder ----------
// REMINDER_DAY (mon..sun) + REMINDER_TIME (HH:MM, BOT_TIMEZONE). People under REMINDER_MIN_HOURS get a DM.

const REMINDER_DAY = (process.env.REMINDER_DAY || "").toLowerCase().slice(0, 3);
const REMINDER_TIME = process.env.REMINDER_TIME || "17:00";
const REMINDER_MIN_HOURS = Number(process.env.REMINDER_MIN_HOURS || 40);
let lastReminder = null;

function nowParts() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { day: parts.weekday.toLowerCase(), time: `${parts.hour}:${parts.minute}` };
}

async function sendReminders() {
  const week = currentWeek(TZ);
  // Everyone who connected Slack, in the workspace they picked.
  for (const link of await links.all()) {
    if (link.slack_team_id !== links.teamId) continue;
    try {
      // oxlint-disable-next-line no-await-in-loop -- one person at a time stays inside Slack's rate limits
      const entries = await planeFor(link).timeEntries({ from: week.from, to: week.to, userId: link.user.id });
      const hours = entries.reduce((s, e) => s + e.hours, 0);
      if (hours >= REMINDER_MIN_HOURS) continue;
      // oxlint-disable-next-line no-await-in-loop -- same reason
      await dmUser(
        app.client,
        link.slack_user_id,
        `You've logged ${formatHours(hours)} this week in ${link.workspace.name} (target ${REMINDER_MIN_HOURS}h). Type /log-time to add the rest.`
      );
    } catch (err) {
      console.error(`reminder for ${link.slack_user_id} failed`, err);
    }
  }
}

if (REMINDER_DAY) {
  setInterval(async () => {
    const { day, time } = nowParts();
    const stamp = `${todayIn(TZ)} ${time}`;
    if (day !== REMINDER_DAY || time !== REMINDER_TIME || lastReminder === stamp) return;
    lastReminder = stamp;
    try {
      await sendReminders();
    } catch (err) {
      console.error("reminders failed", err);
    }
  }, 30_000);
}

// Know our Slack team before any event arrives: links are stored per team.
links.teamId = (await app.client.auth.test()).team_id;
await app.start();
console.log(`Vynk Slack bot running for Slack team ${links.teamId} (Vynk at ${BASE_URL}).`);
