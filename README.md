# @scom82/topvisor-mcp

[![npm version](https://img.shields.io/npm/v/@scom82/topvisor-mcp.svg)](https://www.npmjs.com/package/@scom82/topvisor-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Unofficial.** This is an unofficial MCP server and is not affiliated with or endorsed by Topvisor.

An MCP (Model Context Protocol) server for the [Topvisor API v2](https://topvisor.com/api/v2/). Provides 17 tools for Yandex/Google rank tracking: projects, keywords, searchers and regions, position check submission, history, summary charts, SERP snapshots, and account balance. Implements the stateful Topvisor project model — set up project → add searchers/regions → import keywords → submit check (async) → read history.

## Installation

### Via npx (recommended — through MCP config)

No local install needed. Configure your MCP client and npx handles the rest:

```json
{
  "mcpServers": {
    "topvisor": {
      "command": "npx",
      "args": ["-y", "@scom82/topvisor-mcp"],
      "env": {
        "TOPVISOR_USER_ID": "your_user_id",
        "TOPVISOR_API_KEY": "your_api_key"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/SCom-82/topvisor-mcp.git
cd topvisor-mcp
npm install
npm run build
node dist/index.js
```

## Configuration

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `TOPVISOR_USER_ID` | **yes** | — | Your Topvisor User ID (found in account settings) |
| `TOPVISOR_API_KEY` | **yes** | — | Your Topvisor API key (generate in account settings) |
| `TOPVISOR_API_URL` | no | `https://api.topvisor.com/v2/json` | Override base URL |
| `TOPVISOR_HTTP_TIMEOUT_MS` | no | `30000` | HTTP request timeout in milliseconds |

The server starts without credentials — `tools/list` and `topvisor_services` work without them. Credentials are validated lazily on the first real API call.

## Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "topvisor": {
      "command": "npx",
      "args": ["-y", "@scom82/topvisor-mcp"],
      "env": {
        "TOPVISOR_USER_ID": "your_user_id",
        "TOPVISOR_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Tools

| Tool | Service | Description |
|---|---|---|
| `topvisor_services` | — | List all API services, searcher_key reference, filter operators. Works without credentials. |
| `topvisor_request` | any | Generic escape hatch: call any Topvisor API v2 method directly. |
| `topvisor_balance` | bank_2 | Get account balance (balance_all, personal, bonus, plan, tariff). |
| `topvisor_bank_history` | bank_2 | Get transaction history (deposits, charges, bonuses). |
| `topvisor_list_projects` | projects_2 | List projects with filtering, ordering, optional searchers/regions. |
| `topvisor_add_project` | projects_2 | Create a new project by URL. |
| `topvisor_add_searcher` | positions_2 | Add a search engine (Yandex/Google/etc.) to a project. |
| `topvisor_add_region` | positions_2 | Add a region to a searcher. See **region_key vs region_index** below. |
| `topvisor_list_regions` | positions_2 | List configured regions and get their `region_index` values. |
| `topvisor_list_keywords` | keywords_2 | List keywords in a project. |
| `topvisor_import_keywords` | keywords_2 | Import keywords via CSV (bulk, with group assignment). |
| `topvisor_check_price` | positions_2 | Preview cost of a position check without running it. |
| `topvisor_check_positions` | positions_2 | **ASYNC** submit a position check job. See **checker/go is async** below. |
| `topvisor_get_history` | positions_2 | Read position history for a project and regions. |
| `topvisor_get_summary` | positions_2 | Get position summary comparing two dates. |
| `topvisor_get_summary_chart` | positions_2 | Get chart data for position distribution over time. |
| `topvisor_get_snapshots` | snapshots_2 | Get SERP snapshots collected during a position check. |

## Stateful project model

Topvisor uses a stateful hierarchy — unlike stateless rank-check APIs, you first configure a project, then submit checks, then read results:

```
1. topvisor_add_project { url: "https://example.com" }
   → project_id

2. topvisor_add_searcher { project_id, searcher_key: 0 }
   # 0 = Yandex; 1 = Google

3. topvisor_add_region { project_id, searcher_key: 0, region_key: <catalog_key>, region_depth: 1 }
   # region_key is the Topvisor catalog key, NOT region_index

4. topvisor_list_regions { project_id }
   → region_index (use this, not region_key, in all subsequent calls)

5. topvisor_import_keywords { project_id, group_name: "main", keywords: "name\nкупить окна\nокна цены" }

6. topvisor_check_price { project_id, regions_indexes: [<region_index>] }
   # Preview cost before spending balance

7. topvisor_check_positions { project_id, regions_indexes: [<region_index>] }
   # Async submit — returns projectsIds, does NOT wait for results

8. (poll) topvisor_list_projects { filters: [{name:"id",operator:"EQUALS",values:[project_id]}], fields: ["id","status_positions","positions_percent"] }
   # Wait until status_positions indicates completion

9. topvisor_get_history { project_id, regions_indexes: [<region_index>], date1: "2026-06-01", date2: "2026-06-22" }
   → keywords[] with positionsData
```

## region_key vs region_index

⚠️ **These are different values.** A common source of errors:

- **`region_key`** — the catalog identifier used *when adding* a region (`topvisor_add_region`). Comes from the Topvisor regions catalog and differs per search engine.
- **`region_index`** — the sequential index *assigned by Topvisor* after a region is added to your project. This is what `topvisor_get_history`, `topvisor_check_price`, `topvisor_check_positions`, and `topvisor_get_snapshots` expect.

**Always call `topvisor_list_regions` after adding a region** to retrieve the assigned `region_index`. Do not assume `region_key === region_index`.

## checker/go is async

`topvisor_check_positions` submits a job to the Topvisor queue and returns immediately with `projectsIds`. The actual position collection happens in the background — typically minutes to hours depending on the queue and number of keywords/regions.

**How to wait for results:**
1. Call `topvisor_check_positions` → get `projectsIds`.
2. Poll `topvisor_list_projects` with `fields: ["id","status_positions","positions_percent"]` until the status indicates completion.
3. Then call `topvisor_get_history` to read the collected positions.

There is no built-in wait/poll in this MCP tool (v1). This is intentional — position checks can take hours, which would exceed MCP client timeouts.

## Error format

Topvisor API always returns HTTP 200. Errors are indicated in the response body:

```json
{
  "result": null,
  "errors": [
    {
      "code": 53,
      "string": "Authorisation error",
      "detail": { "header": "Authorization" }
    }
  ]
}
```

Known error codes: `53` = authorization error (wrong/missing credentials); `1002` = parameter value mismatch.

When a tool encounters a Topvisor error, it returns:
```json
{
  "isError": true,
  "errors": [{ "code": 53, "string": "Authorisation error", "detail": {...} }]
}
```

## Known limitations

- **Rate limits**: Topvisor API rate limits are not documented. This server does not implement automatic retries or backoff in v1. If you hit rate limit errors, add delays between calls manually.
- **Async checker**: `topvisor_check_positions` does not poll for completion. You must poll `topvisor_list_projects` yourself.
- **Undocumented methods**: Several edit/delete methods (`edit/projects_2/projects/*`, `del/keywords_2/keywords`, etc.) have undocumented parameters and are not available as typed tools. Use `topvisor_request` as an escape hatch.
- **`region_key` for specific cities**: The Topvisor region catalog uses its own identifiers per search engine. Use `topvisor_request` with `get/positions_2/searchers_regions` to browse available regions.

## License

MIT © 2026 SCom-82
