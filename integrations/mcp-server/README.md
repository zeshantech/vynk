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

## Use the hosted server (nothing to install)

It runs on the Vynk server at `https://vynk.robustcraft.com/mcp/<workspace-slug>`. Each person uses their own token:

1. In Vynk: avatar → **Profile settings → Personal access tokens → Add**. Copy the token. It acts as you, so keep it private.
2. Claude Code:

```bash
claude mcp add --transport http vynk https://vynk.robustcraft.com/mcp/robustcraft --header "Authorization: Bearer <token>"
```

Any client that supports remote MCP servers with a custom header works the same way (URL + `Authorization: Bearer <token>`). Claude.ai and Claude Desktop "custom connectors" sign in with OAuth, which this server doesn't offer yet; use the local setup below for Claude Desktop.

The server keeps no tokens: it passes each request's token to the Vynk API and forgets it.

## Run it locally instead

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

`npm test` runs the tools through real MCP clients (in-memory and HTTP) against a fake Vynk API. Locally the server talks MCP over stdio, so it logs to stderr only. With `MCP_HTTP_PORT` set it serves Streamable HTTP (stateless, JSON responses) at `/mcp/<workspace>` and `/mcp/health`; `VYNK_API_BASE` is where it reaches the API (`http://api:8000` in Docker), `VYNK_URL` the public address used in links. Deployed as the `mcp` service in `deployments/vynk/docker-compose.yml`, routed by Caddy (`Caddyfile.snippet`).
