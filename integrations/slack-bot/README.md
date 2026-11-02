# Vynk Slack bot (Plane)

Slash commands for Vynk over Slack Socket Mode — no public URL needed. Same commands as the OpenProject-era bot.

| Command                                                | What it does                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `/vynk` (or `@Vynk`)                                   | Menu                                                                             |
| `/log-time 2h ABC-12 note [yesterday\|YYYY-MM-DD]`     | Log time on a task (no text opens a form with live task search, up to 5 entries) |
| `/week-hours [last]`, `/time-week-logged-times [last]` | Your hours, per day and per task                                                 |
| `/my-tasks`                                            | Your open tasks                                                                  |
| `/create-task project \| title`                        | Create a task assigned to you (no text opens a form)                             |
| `/projects`                                            | Your projects and this week's hours                                              |
| `/create-project Name`                                 | Create a project, you become its admin _(Vynk admin)_                            |
| `/team-hours [last]`                                   | Everyone's hours _(Vynk admin)_                                                  |

Slack users are matched to Vynk users by email. Time is logged as that person, and only in projects they're a member of (not as a guest). A person can't log more than 24 hours on one day (the server enforces it). Tasks are identified by their Vynk key, e.g. `ABC-12`.

## Setup

1. https://api.slack.com/apps → **Create New App → From a manifest** → paste `slack-manifest.yml` → Install to the workspace.
2. Copy the **Bot User OAuth Token** (`xoxb-…`) and create an **App-Level Token** with `connections:write` (`xapp-…`).
3. In Vynk as a **workspace admin**: avatar → **Profile settings → Personal access tokens → Add** (`PLANE_API_KEY`). The key lets the bot look up people and log time on their behalf, so keep it secret.
4. Set: `PLANE_URL` (e.g. `https://vynk.robustcraft.dpdns.org`; it is also used to build the task links the bot posts), `PLANE_WORKSPACE_SLUG`, `PLANE_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`.

Optional: `BOT_TIMEZONE` (default `Asia/Karachi`); weekly DM reminder with `REMINDER_DAY=fri`, `REMINDER_TIME=17:00`, `REMINDER_MIN_HOURS=40`.

Run only **one** bot per Slack app. Socket Mode splits traffic between every connected copy, so a second copy (a local test, or the old OpenProject bot) would steal half of the commands. Use a separate Slack app for testing.

Production: the bot ships as the `slack-bot` service in `deployments/vynk/docker-compose.yml` and is built/deployed by the same workflow. Put `PLANE_WORKSPACE_SLUG`, `PLANE_API_KEY`, `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in Infisical (the compose file sets `PLANE_URL` from `WEB_URL`); without them the container just restarts until they exist.

Local run: `npm install && PLANE_URL=… PLANE_WORKSPACE_SLUG=… PLANE_API_KEY=… SLACK_BOT_TOKEN=… SLACK_APP_TOKEN=… npm start`. Tests: `npm test`.

## What's different from the OpenProject bot

Not carried over: the per-person OAuth sign-in (the admin key acts for people instead), time-entry activities and the Client field (Vynk has neither), editing a project's members and roles from Slack, and the EOD report reader. Manage members and roles in the Vynk app.
