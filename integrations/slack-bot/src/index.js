import bolt from "@slack/bolt";
import { Plane, PlaneError } from "./plane.js";
import { parseCreateTask, parseLogTime } from "./commands.js";
import { currentWeek, formatHours, hoursError, parseHours, resolveDate, todayIn } from "./time.js";
import { escape, loggedView, menuView, tasksView, teamView, weekView } from "./views.js";

const { App, LogLevel } = bolt;

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing env ${name}`);
  return value;
};

const TZ = process.env.BOT_TIMEZONE || "Asia/Karachi";
const BASE_URL = env("PLANE_URL").replace(/\/$/, "");
const WORKSPACE = env("PLANE_WORKSPACE_SLUG");
const MAX_ENTRIES = 5;

// One workspace admin's API key; it logs time *as* each person (matched by email).
const plane = new Plane({ baseUrl: BASE_URL, workspace: WORKSPACE, apiKey: env("PLANE_API_KEY") });
const urls = {
  wp: (key) => `${BASE_URL}/${WORKSPACE}/browse/${key}/`,
  project: (p) => `${BASE_URL}/${WORKSPACE}/projects/${p.id}/issues/`,
};

const app = new App({
  token: env("SLACK_BOT_TOKEN"),
  appToken: env("SLACK_APP_TOKEN"),
  socketMode: true,
  logLevel: process.env.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO,
});

// ---------- helpers ----------

class UserFacingError extends Error {}

const plain = (text) => ({ type: "plain_text", text, emoji: true });
const errorText = (err) => {
  if (err instanceof UserFacingError) return `:warning: ${err.message}`;
  if (err instanceof PlaneError) return `:x: Vynk said: ${escape(err.message)}`;
  return ":x: Something went wrong. Please try again.";
};
// Slack's chat.postMessage, not window.postMessage.
const dmUser = (client, channel, message) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  client.chat.postMessage({ channel, ...(typeof message === "string" ? { text: message } : message) });
const send = (respond, reply) => respond(typeof reply === "string" ? { text: reply } : reply);

const slackEmails = new Map();
/** The Vynk person behind a Slack user (matched by email). */
async function vynkUser(client, slackUserId) {
  let email = slackEmails.get(slackUserId);
  if (!email) {
    const info = await client.users.info({ user: slackUserId });
    email = info.user?.profile?.email?.toLowerCase();
    if (!email)
      throw new UserFacingError("I can't see your Slack email address, so I can't match you to a Vynk account.");
    slackEmails.set(slackUserId, email);
  }
  const person = await plane.userByEmail(email);
  if (!person)
    throw new UserFacingError(`There's no Vynk account for ${email}. Ask an admin to invite you, then try again.`);
  return person;
}

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
      if (!(err instanceof UserFacingError)) logger.error(`${name} failed`, err);
      await respond({ response_type: "ephemeral", text: errorText(err) });
    }
  });
}
const asMessage = (reply) => (typeof reply === "string" ? { text: reply } : reply);

const asWp = (t) => ({ id: t.key, subject: t.name, _links: { project: { title: t.project.name } } });

// ---------- logging time ----------

async function weekTotal(userId) {
  const week = currentWeek(TZ);
  const entries = await plane.timeEntries({ from: week.from, to: week.to, userId });
  return entries.reduce((sum, e) => sum + e.hours, 0);
}

/** entries: [{ hours, task, spentOn, comment }] -> a Slack message. The server enforces membership and the 24h/day cap. */
async function logEntries(user, entries) {
  const results = [];
  const failed = [];
  for (const e of entries) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- in order, so the 24h/day cap sees each entry
      await plane.logTime({
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
  const view = loggedView({ results, weekLabel: "This week", weekTotal: await weekTotal(user.id), urls });
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
    let tasks = await plane.tasksFor(user.id, { q, assigned: !q, limit: 100 });
    if (!q && !tasks.length) tasks = await plane.tasksFor(user.id, { limit: 100 });
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
    await dm(errorText(err));
  }
});

app.command("/log-time", async ({ ack, command: cmd, client, respond, logger }) => {
  await ack();
  try {
    const parsed = parseLogTime(cmd.text);
    if (parsed.hours === null || parsed.taskKey === null) {
      const user = await vynkUser(client, cmd.user_id);
      const task = parsed.taskKey ? await plane.taskByKey(user.id, parsed.taskKey) : null;
      return await openLogTimeModal(client, cmd.trigger_id, { ...parsed, task });
    }
    const hoursProblem = hoursError(String(parsed.hours));
    if (hoursProblem) throw new UserFacingError(hoursProblem);
    const user = await vynkUser(client, cmd.user_id);
    const spentOn = resolveDate(parsed.date, TZ);
    if (!spentOn) throw new UserFacingError("Date must be `today`, `yesterday` or `YYYY-MM-DD`.");
    const task = await plane.taskByKey(user.id, parsed.taskKey);
    if (!task)
      throw new UserFacingError(`I can't find an open task ${parsed.taskKey} in a project you can log time on.`);
    await send(respond, {
      response_type: "ephemeral",
      ...asMessage(await logEntries(user, [{ hours: parsed.hours, task, spentOn, comment: parsed.comment }])),
    });
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("/log-time failed", err);
    await respond({ response_type: "ephemeral", text: errorText(err) });
  }
});

// ---------- hours, tasks, projects ----------

async function weekHours({ cmd, client, text }) {
  const user = await vynkUser(client, cmd.user_id);
  const weeksBack = /^last/i.test(text) ? 1 : 0;
  const week = currentWeek(TZ, weeksBack);
  const entries = await plane.timeEntries({ from: week.from, to: week.to, userId: user.id });
  return weekView({
    label: weeksBack ? "Last week" : "This week",
    week,
    entries,
    urls,
    otherWeekLabel: weeksBack ? "This week" : "Last week",
    otherWeekValue: weeksBack ? "this" : "last",
  });
}
command("/week-hours", weekHours);
command("/time-week-logged-times", weekHours);

async function teamHours({ cmd, client, text }) {
  await requireAdmin(client, cmd.user_id);
  const weeksBack = /^last/i.test(text) ? 1 : 0;
  const week = currentWeek(TZ, weeksBack);
  const [entries, users] = await Promise.all([plane.timeEntries({ from: week.from, to: week.to }), plane.people()]);
  return teamView({ label: weeksBack ? "Last week" : "This week", week, users, entries, urls });
}
command("/team-hours", teamHours);

async function myTasks({ cmd, client }) {
  const user = await vynkUser(client, cmd.user_id);
  const tasks = await plane.tasksFor(user.id, { assigned: true, limit: 30 });
  return tasksView({ tasks: tasks.map(asWp), urls });
}
command("/my-tasks", myTasks);

async function projectsReply({ cmd, client }) {
  const user = await vynkUser(client, cmd.user_id);
  const week = currentWeek(TZ);
  const [projects, entries] = await Promise.all([
    plane.projectsFor(user.id),
    plane.timeEntries({ from: week.from, to: week.to, userId: user.id }),
  ]);
  if (!projects.length) return "You're not a member of any project yet.";
  const mine = new Map();
  for (const e of entries) mine.set(e.projectId, (mine.get(e.projectId) ?? 0) + e.hours);
  const lines = projects.map((p) => {
    const hours = mine.get(p.id);
    return `• <${urls.project(p)}|${escape(p.name)}> \`${escape(p.identifier)}\`${hours ? `  —  ${formatHours(hours)} this week` : ""}`;
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
  const projects = await plane.projectsFor(user.id);
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
    const task = await plane.createTask({ projectId, name, assigneeId: user.id });
    const key = (await plane.projectsFor(user.id)).find((p) => p.id === projectId)?.identifier;
    await dm(
      `:white_check_mark: Created <${urls.wp(`${key}-${task.sequence_id}`)}|${escape(name)}> and assigned it to you.`
    );
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("create_task failed", err);
    await dm(errorText(err));
  }
});

app.command("/create-task", async ({ ack, command: cmd, client, respond, logger }) => {
  await ack();
  try {
    const { project: projectName, subject } = parseCreateTask(cmd.text);
    if (!projectName || !subject) return await openCreateTaskModal(client, cmd.trigger_id, cmd.user_id);
    const user = await vynkUser(client, cmd.user_id);
    const needle = projectName.toLowerCase();
    const projects = await plane.projectsFor(user.id);
    const project =
      projects.find((p) => p.identifier.toLowerCase() === needle || p.name.toLowerCase() === needle) ??
      projects.find((p) => p.name.toLowerCase().includes(needle));
    if (!project)
      throw new UserFacingError(`I can't find a project like "${projectName}" that you belong to. Try \`/projects\`.`);
    const task = await plane.createTask({ projectId: project.id, name: subject, assigneeId: user.id });
    await respond({
      response_type: "ephemeral",
      text: `:white_check_mark: Created <${urls.wp(`${project.identifier}-${task.sequence_id}`)}|${escape(subject)}> in ${escape(project.name)}.`,
    });
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("/create-task failed", err);
    await respond({ response_type: "ephemeral", text: errorText(err) });
  }
});

async function createProjectFor(admin, name) {
  const project = await plane.createProject({ name, leadId: admin.id });
  return `:white_check_mark: Created project <${urls.project(project)}|${escape(project.name)}> (\`${escape(project.identifier)}\`). You're its admin.`;
}

app.view("create_project", async ({ ack, body, view, client, logger }) => {
  await ack();
  const dm = (text) => dmUser(client, body.user.id, text);
  try {
    await dm(await createProjectFor(await requireAdmin(client, body.user.id), view.state.values.name.v.value.trim()));
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("create_project failed", err);
    await dm(errorText(err));
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

command("/vynk", async ({ cmd, client }) => {
  const user = await vynkUser(client, cmd.user_id);
  return menuView(MENU, user.admin ? ADMIN_MENU : [], user.name);
});

app.event("app_mention", async ({ event, client, logger }) => {
  try {
    const user = await vynkUser(client, event.user);
    await client.chat.postEphemeral({
      channel: event.channel,
      user: event.user,
      ...menuView(MENU, user.admin ? ADMIN_MENU : [], user.name),
    });
  } catch (err) {
    logger.error("mention failed", err);
    await client.chat
      .postEphemeral({ channel: event.channel, user: event.user, text: errorText(err) })
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
      case "team_hours":
        return await reply(await teamHours({ cmd, client, text: "" }));
    }
  } catch (err) {
    if (!(err instanceof UserFacingError)) logger.error("menu failed", err);
    await reply(errorText(err));
  }
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
    await respond({ response_type: "ephemeral", replace_original: false, text: errorText(err) });
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
  const [entries, people] = await Promise.all([plane.timeEntries({ from: week.from, to: week.to }), plane.people()]);
  for (const person of people) {
    const hours = entries.filter((e) => e.userId === person.id).reduce((s, e) => s + e.hours, 0);
    if (hours >= REMINDER_MIN_HOURS) continue;
    try {
      // oxlint-disable-next-line no-await-in-loop -- one person at a time stays inside Slack's rate limits
      const slackUser = (await app.client.users.lookupByEmail({ email: person.email })).user;
      // oxlint-disable-next-line no-await-in-loop -- same reason
      await dmUser(
        app.client,
        slackUser.id,
        `You've logged ${formatHours(hours)} this week (target ${REMINDER_MIN_HOURS}h). Type /log-time to add the rest.`
      );
    } catch {
      // not in Slack: nothing to do
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

await app.start();
console.log(`Vynk Slack bot running (Plane workspace "${WORKSPACE}").`);
