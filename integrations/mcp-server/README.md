# Vynk MCP server

Lets an AI assistant (Claude Desktop, Claude Code, Cursor, any MCP client) work in Vynk **as you**. Ask things like _"create an urgent bug in Acme for Ali, due Friday, in the current sprint"_, _"what's blocked in ACM?"_, _"log 2h on ACM-12 for yesterday"_ or _"what did the team log last week?"_.

| Area     | Tools                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You      | `whoami`                                                                                                                                                                    |
| Projects | `list_projects`, `project_overview` (statuses, labels, members, cycles, modules), `create_project`                                                                          |
| Find     | `search_tasks` (words or key, open or closed), `list_tasks` (filter by status, assignee, priority, label, due date), `get_task` (with description, links, comments)         |
| Change   | `create_task` and `update_task` with every field: title, description, status, priority, start/due date, assignees, labels (missing ones are created), parent, cycle, module |
| More     | `add_comment`, `add_link`, `relate_tasks` (blocking, blocked by, duplicate, relates to…), `delete_task`                                                                     |
| Planning | `create_cycle`, `create_module`, `add_tasks_to` (cycle or module; `"current"` = the running cycle)                                                                          |
| Time     | `log_time`, `my_hours`, `team_hours` (this/last week or month, or any range; by person, project and task)                                                                   |
| Anything | `vynk_api`: any Vynk API endpoint (activity, attachments, estimates, intake…) as you                                                                                        |

People, statuses, labels, cycles and modules are given by name (`"Ali"`, `"me"`, `"In Progress"`, `"bug"`, `"Sprint 4"`); when a name doesn't match, the tool lists the choices so the assistant can correct itself.

Everything runs with your own permissions: you only see projects you're a member of, admin-only actions need an admin, and the 24h-per-day time limit applies. Most clients ask before running a tool that changes something; `delete_task` and `vynk_api` are marked as destructive.

## Setup

1. In Vynk: avatar → **Profile settings → Personal access tokens → Add**. Copy the token. It acts as you, so keep it private.
2. Install once (needs Node 22+): `cd integrations/mcp-server && npm ci`
3. Add the server to your client with these settings:
   - `VYNK_WORKSPACE`: your workspace slug, the first part of the URL after you log in (`vynk.robustcraft.com/<slug>/`)
   - `VYNK_API_KEY`: the token from step 1
   - `VYNK_URL` (optional): defaults to `https://vynk.robustcraft.com`

**Claude Code**

```bash
claude mcp add vynk -e VYNK_WORKSPACE=robustcraft -e VYNK_API_KEY=<token> -- node /path/to/vynk/integrations/mcp-server/src/index.js
```

**Claude Desktop / Cursor** (`claude_desktop_config.json`, `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "vynk": {
      "command": "node",
      "args": ["/path/to/vynk/integrations/mcp-server/src/index.js"],
      "env": { "VYNK_WORKSPACE": "robustcraft", "VYNK_API_KEY": "<token>" }
    }
  }
}
```

Then ask the assistant to run `whoami` to check it's connected. For several workspaces, add the server once per workspace with a different name (`vynk-acme`, …).

## Development

`npm test` runs the tools through a real MCP client against a fake Vynk API. The server talks MCP over stdio, so it logs to stderr only.
