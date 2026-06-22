import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TopvisorApiClient } from "../api-client.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

function apiError(errors: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ isError: true, errors }, null, 2) }],
    isError: true as const,
  };
}

function validationError(msg: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ isError: true, error: msg }, null, 2) }],
    isError: true as const,
  };
}

// ─── Shared zod fragments ─────────────────────────────────────────────────────

const Filter = z.object({
  name: z.string(),
  operator: z.enum([
    "EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "GREATER_THAN",
    "GREATER_THAN_EQUALS", "LESS_THAN", "LESS_THAN_EQUALS", "BETWEEN",
    "STARTS_WITH", "CONTAINS", "DOES_NOT_CONTAIN", "REGEXP", "NOT_REGEXP",
    "IS_NULL", "IS_NOT_NULL",
  ]),
  values: z.array(z.union([z.string(), z.number()])),
});

const Order = z.object({ name: z.string(), direction: z.enum(["ASC", "DESC"]) });
const limitSchema = z.union([z.number().int(), z.string()]).optional();

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerCoreTools(server: McpServer, client: TopvisorApiClient): void {

  // ── Служебные ───────────────────────────────────────────────────────────────

  server.tool(
    "topvisor_services",
    "List all Topvisor API v2 services, operators, methods, searcher_key reference, filter operators, and all 18 tools in this MCP server. Works without credentials.",
    {},
    async () => {
      return json({
        note: "This information is static — no API call is made. Works without credentials.",
        services: {
          bank_2: {
            operators: ["get"],
            methods: ["info (→ topvisor_balance)", "history (→ topvisor_bank_history)"],
          },
          projects_2: {
            operators: ["get", "add", "edit", "del"],
            methods: [
              "projects (→ topvisor_list_projects, topvisor_add_project)",
              "competitors (⏸ use topvisor_request)",
            ],
          },
          keywords_2: {
            operators: ["get", "add", "edit", "del"],
            methods: [
              "keywords (→ topvisor_list_keywords)",
              "keywords/import (→ topvisor_import_keywords)",
              "keywords/export (🟡 use topvisor_request)",
            ],
          },
          positions_2: {
            operators: ["get", "add", "edit", "del"],
            methods: [
              "searchers (→ topvisor_add_searcher)",
              "searchers_regions (→ topvisor_add_region)",
              "searchers_regions/export (→ topvisor_list_regions)",
              "checker/price (→ topvisor_check_price)",
              "checker/go (→ topvisor_check_positions, ASYNC submit)",
              "history (→ topvisor_get_history)",
              "summary (→ topvisor_get_summary)",
              "summary_chart (→ topvisor_get_summary_chart)",
            ],
          },
          snapshots_2: {
            operators: ["get"],
            methods: ["history (→ topvisor_get_snapshots)"],
          },
        },
        searcher_keys: {
          0: "Yandex",
          1: "Google",
          4: "YouTube",
          5: "Bing",
          7: "Seznam",
          8: "AppStore",
          9: "GooglePlay",
          20: "Yandex.com",
          21: "Yandex.com.tr",
        },
        filter_operators: [
          "EQUALS", "NOT_EQUALS", "IN", "NOT_IN",
          "GREATER_THAN", "GREATER_THAN_EQUALS", "LESS_THAN", "LESS_THAN_EQUALS",
          "BETWEEN", "STARTS_WITH", "CONTAINS", "DOES_NOT_CONTAIN",
          "REGEXP", "NOT_REGEXP", "IS_NULL", "IS_NOT_NULL",
        ],
        important_note: "region_key (used when adding a region) is NOT the same as region_index (used in history/checker queries). Always call topvisor_list_regions after adding a region to get the assigned region_index.",
        all_tools: [
          "topvisor_services",
          "topvisor_request",
          "topvisor_balance",
          "topvisor_bank_history",
          "topvisor_list_projects",
          "topvisor_add_project",
          "topvisor_add_searcher",
          "topvisor_add_region",
          "topvisor_list_regions",
          "topvisor_list_keywords",
          "topvisor_import_keywords",
          "topvisor_check_price",
          "topvisor_check_positions",
          "topvisor_get_history",
          "topvisor_get_summary",
          "topvisor_get_summary_chart",
          "topvisor_get_snapshots",
        ],
      });
    }
  );

  server.tool(
    "topvisor_request",
    "Generic escape hatch: call any Topvisor API v2 method directly. Covers all API methods including undocumented ones not yet available as typed tools. Use operator/service/method path and pass body verbatim.",
    {
      operator: z.enum(["get", "add", "edit", "del"]),
      service: z.string().describe("e.g. projects_2, keywords_2, positions_2, snapshots_2, bank_2"),
      method: z.string().describe('Method path, e.g. "projects", "checker/go", "searchers_regions/export"'),
      body: z.record(z.any()).default({}).describe("Request body, passed verbatim as JSON"),
    },
    async ({ operator, service, method, body }) => {
      const result = await client.request(operator, service, method, body as Record<string, unknown>);
      if (!result.ok) return apiError(result.errors);
      return json(result);
    }
  );

  // ── bank_2 ───────────────────────────────────────────────────────────────────

  server.tool(
    "topvisor_balance",
    "Get account balance information including balance_all, personal, bonus, plan amounts and current tariff.",
    {},
    async () => {
      const result = await client.request("get", "bank_2", "info", {});
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_bank_history",
    "Get account transaction history (deposits, charges, bonuses).",
    {
      fields: z.array(z.string()).default(["date", "info", "sum"]).describe("Fields to return"),
      orders: z.array(Order).optional(),
      limit: limitSchema,
      offset: z.number().int().optional(),
    },
    async ({ fields, orders, limit, offset }) => {
      const body: Record<string, unknown> = { fields };
      if (orders) body.orders = orders;
      if (limit !== undefined) body.limit = limit;
      if (offset !== undefined) body.offset = offset;
      const result = await client.request("get", "bank_2", "history", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  // ── projects_2 ───────────────────────────────────────────────────────────────

  server.tool(
    "topvisor_list_projects",
    "List all projects in the account. Use fields, filters, orders for precise queries. show_searchers_and_regions=1 includes configured search engines and regions.",
    {
      fields: z.array(z.string()).default(["id", "name", "site"]).describe("Fields to return"),
      filters: z.array(Filter).optional(),
      orders: z.array(Order).optional(),
      limit: limitSchema,
      offset: z.number().int().optional(),
      show_site_stat: z.boolean().optional(),
      show_searchers_and_regions: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe("0=none, 1=searchers+regions, 2=full details"),
    },
    async ({ fields, filters, orders, limit, offset, show_site_stat, show_searchers_and_regions }) => {
      const body: Record<string, unknown> = { fields };
      if (filters) body.filters = filters;
      if (orders) body.orders = orders;
      if (limit !== undefined) body.limit = limit;
      if (offset !== undefined) body.offset = offset;
      if (show_site_stat !== undefined) body.show_site_stat = show_site_stat;
      if (show_searchers_and_regions !== undefined) body.show_searchers_and_regions = show_searchers_and_regions;
      const result = await client.request("get", "projects_2", "projects", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_add_project",
    "Create a new project in Topvisor. Returns the new project object. ⚠️ Exact response shape not fully documented — raw result is returned.",
    {
      url: z.string().describe("Project URL, e.g. https://example.com"),
      name: z.string().optional().describe("Project display name (defaults to domain)"),
      tags: z.array(z.number().int()).optional().describe("Tag IDs (1–10)"),
    },
    async ({ url, name, tags }) => {
      const body: Record<string, unknown> = { url };
      if (name) body.name = name;
      if (tags) body.tags = tags;
      const result = await client.request("add", "projects_2", "projects", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  // ── positions_2 setup ────────────────────────────────────────────────────────

  server.tool(
    "topvisor_add_searcher",
    "Add a search engine (searcher) to a project. Must be done before adding regions.",
    {
      project_id: z.number().int(),
      searcher_key: z.number().int().describe("Search engine: 0=Yandex, 1=Google, 4=YouTube, 5=Bing, 7=Seznam, 8=AppStore, 9=GooglePlay, 20=Yandex.com, 21=Yandex.com.tr"),
    },
    async ({ project_id, searcher_key }) => {
      const result = await client.request("add", "positions_2", "searchers", { project_id, searcher_key });
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_add_region",
    "Add a region to a searcher for a project. After adding, call topvisor_list_regions to get the assigned region_index — region_key (add-time catalog key) is NOT the same as region_index (query-time index used in history/checker calls).",
    {
      project_id: z.number().int(),
      searcher_key: z.number().int().describe("Search engine key (0=Yandex, 1=Google, etc.)"),
      region_key: z.number().int().describe("Region key from Topvisor catalog. IMPORTANT: region_key is NOT the same as region_index. After adding a region, read region_index back via topvisor_list_regions."),
      region_lang: z.string().optional().describe("Language code, e.g. 'ru'"),
      region_device: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe("0=desktop, 1=tablet, 2=phone"),
      region_depth: z.number().int().min(1).max(5).optional().describe("Search depth pages (1–5)"),
    },
    async ({ project_id, searcher_key, region_key, region_lang, region_device, region_depth }) => {
      const body: Record<string, unknown> = { project_id, searcher_key, region_key };
      if (region_lang) body.region_lang = region_lang;
      if (region_device !== undefined) body.region_device = region_device;
      if (region_depth !== undefined) body.region_depth = region_depth;
      const result = await client.request("add", "positions_2", "searchers_regions", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_list_regions",
    "List configured searchers and regions for a project. Returns region_index for each region — use this index (NOT region_key) in topvisor_get_history, topvisor_check_price, topvisor_check_positions. This is a critical tool: always call after adding regions to get assigned region_index values.",
    {
      project_id: z.number().int().describe("Project ID to list configured regions for"),
      extra_body: z.record(z.any()).default({}).describe("Additional params passed verbatim (API params not fully documented — ⚠️ use topvisor_request if needed)"),
    },
    async ({ project_id, extra_body }) => {
      const body: Record<string, unknown> = { project_id, ...extra_body };
      const result = await client.request("get", "positions_2", "searchers_regions/export", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  // ── keywords_2 ───────────────────────────────────────────────────────────────

  server.tool(
    "topvisor_list_keywords",
    "List keywords for a project. Supports filtering, ordering, pagination.",
    {
      project_id: z.number().int(),
      fields: z.array(z.string()).default(["id", "name"]).describe("Fields to return"),
      filters: z.array(Filter).optional(),
      orders: z.array(Order).optional(),
      limit: limitSchema,
      offset: z.number().int().optional(),
      currency: z.enum(["RUB", "USD"]).optional(),
      show_trash: z.boolean().optional().describe("Include deleted keywords"),
    },
    async ({ project_id, fields, filters, orders, limit, offset, currency, show_trash }) => {
      const body: Record<string, unknown> = { project_id, fields };
      if (filters) body.filters = filters;
      if (orders) body.orders = orders;
      if (limit !== undefined) body.limit = limit;
      if (offset !== undefined) body.offset = offset;
      if (currency) body.currency = currency;
      if (show_trash !== undefined) body.show_trash = show_trash;
      const result = await client.request("get", "keywords_2", "keywords", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_import_keywords",
    "Import keywords into a project via CSV. Returns {countSended, countDuplicated, countAdded, countChanged}. To assign keywords to a group, set group_name or include group_name column in CSV headers.",
    {
      project_id: z.number().int(),
      keywords: z.string().describe("CSV data: first row = field names (name is mandatory; optional: tags, target, group_folder_path, group_name); subsequent rows = keyword values. Example: 'name\\nкупить окна\\nокна цены'"),
      folder_id: z.number().int().optional(),
      group_id: z.number().int().optional(),
      group_name: z.string().optional().describe("Assign keywords to this group name (creates if not exists)"),
      move_duplicate: z.boolean().optional(),
      move_duplicate_folder_id: z.number().int().optional(),
      move_duplicate_group_id: z.number().int().optional(),
      move_duplicate_group_name: z.string().optional(),
    },
    async ({ project_id, keywords, folder_id, group_id, group_name, move_duplicate, move_duplicate_folder_id, move_duplicate_group_id, move_duplicate_group_name }) => {
      const body: Record<string, unknown> = { project_id, keywords };
      if (folder_id !== undefined) body.folder_id = folder_id;
      if (group_id !== undefined) body.group_id = group_id;
      if (group_name) body.group_name = group_name;
      if (move_duplicate !== undefined) body.move_duplicate = move_duplicate;
      if (move_duplicate_folder_id !== undefined) body.move_duplicate_folder_id = move_duplicate_folder_id;
      if (move_duplicate_group_id !== undefined) body.move_duplicate_group_id = move_duplicate_group_id;
      if (move_duplicate_group_name) body.move_duplicate_group_name = move_duplicate_group_name;
      const result = await client.request("add", "keywords_2", "keywords/import", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  // ── positions_2 action/read ──────────────────────────────────────────────────

  server.tool(
    "topvisor_check_price",
    "Preview the cost of a position check without actually running it. Returns pricesByUsers.<userId>={projectsIds, price}. Use this before topvisor_check_positions to estimate cost.",
    {
      project_id: z.number().int().describe("Project ID (converted to filter internally)"),
      regions_indexes: z.array(z.number().int()).optional().describe("Region indexes to check (from topvisor_list_regions)"),
      folders_ids: z.array(z.number().int()).optional(),
      folders_ids_depth: z.boolean().optional(),
      groups_ids: z.array(z.number().int()).optional(),
      do_snapshots: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = also collect SERP snapshots"),
      apply_discount: z.boolean().optional(),
    },
    async ({ project_id, regions_indexes, folders_ids, folders_ids_depth, groups_ids, do_snapshots, apply_discount }) => {
      const body: Record<string, unknown> = {
        filters: [{ name: "id", operator: "EQUALS", values: [project_id] }],
      };
      if (regions_indexes) body.regions_indexes = regions_indexes;
      if (folders_ids) body.folders_ids = folders_ids;
      if (folders_ids_depth !== undefined) body.folders_ids_depth = folders_ids_depth;
      if (groups_ids) body.groups_ids = groups_ids;
      if (do_snapshots !== undefined) body.do_snapshots = do_snapshots;
      if (apply_discount !== undefined) body.apply_discount = apply_discount;
      const result = await client.request("get", "positions_2", "checker/price", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_check_positions",
    "ASYNC: Submit a position check job to the Topvisor queue. Returns projectsIds immediately — actual data collection runs in the background (minutes to hours depending on queue). To monitor progress, poll topvisor_list_projects for status_positions/positions_percent fields. Read results later via topvisor_get_history once collection is complete. To preview cost first use topvisor_check_price.",
    {
      project_id: z.number().int().describe("Project ID (converted to filter internally)"),
      regions_indexes: z.array(z.number().int()).optional().describe("Region indexes to check (from topvisor_list_regions)"),
      folders_ids: z.array(z.number().int()).optional(),
      folders_ids_depth: z.boolean().optional(),
      groups_ids: z.array(z.number().int()).optional(),
      do_snapshots: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = also collect SERP snapshots (accessible via topvisor_get_snapshots)"),
      keyword_id: z.number().int().optional().describe("Check a single keyword only (requires regions_indexes; ignores groups_ids, do_snapshots)"),
    },
    async ({ project_id, regions_indexes, folders_ids, folders_ids_depth, groups_ids, do_snapshots, keyword_id }) => {
      const body: Record<string, unknown> = {
        filters: [{ name: "id", operator: "EQUALS", values: [project_id] }],
      };
      if (regions_indexes) body.regions_indexes = regions_indexes;
      if (folders_ids) body.folders_ids = folders_ids;
      if (folders_ids_depth !== undefined) body.folders_ids_depth = folders_ids_depth;
      if (groups_ids) body.groups_ids = groups_ids;
      if (do_snapshots !== undefined) body.do_snapshots = do_snapshots;
      if (keyword_id !== undefined) body.keyword_id = keyword_id;
      const result = await client.request("edit", "positions_2", "checker/go", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_get_history",
    "Get position history for a project and regions. Requires either 'dates' array OR both 'date1' and 'date2'. Returns keywords[] with positionsData.",
    {
      project_id: z.number().int(),
      regions_indexes: z.array(z.number().int()).describe("Region indexes (from topvisor_list_regions, NOT region_key)"),
      date1: z.string().optional().describe("YYYY-MM-DD start date (use with date2)"),
      date2: z.string().optional().describe("YYYY-MM-DD end date (use with date1)"),
      dates: z.array(z.string()).optional().describe("Array of specific YYYY-MM-DD dates. Use either dates OR date1+date2 pair — both cannot be absent."),
      fields: z.array(z.string()).optional(),
      competitors_ids: z.array(z.number().int()).optional(),
      type_range: z.number().int().optional().describe("Date range type: 0=all, 1=today, 2=last N days (default), etc."),
      count_dates: z.number().int().max(31).optional(),
      only_exists_first_date: z.boolean().optional(),
      show_headers: z.boolean().optional(),
      show_exists_dates: z.boolean().optional(),
      show_visitors: z.boolean().optional(),
      show_top_by_depth: z.number().int().optional(),
      positions_fields: z.array(z.enum(["position", "snippet", "relevant_url", "visitors"])).optional(),
    },
    async (args) => {
      // Client-side guard: must have dates OR (date1 AND date2)
      if (!args.dates && !(args.date1 && args.date2)) {
        return validationError("Either 'dates' array or both 'date1' and 'date2' must be provided");
      }
      const body: Record<string, unknown> = {
        project_id: args.project_id,
        regions_indexes: args.regions_indexes,
      };
      if (args.date1) body.date1 = args.date1;
      if (args.date2) body.date2 = args.date2;
      if (args.dates) body.dates = args.dates;
      if (args.fields) body.fields = args.fields;
      if (args.competitors_ids) body.competitors_ids = args.competitors_ids;
      if (args.type_range !== undefined) body.type_range = args.type_range;
      if (args.count_dates !== undefined) body.count_dates = args.count_dates;
      if (args.only_exists_first_date !== undefined) body.only_exists_first_date = args.only_exists_first_date;
      if (args.show_headers !== undefined) body.show_headers = args.show_headers;
      if (args.show_exists_dates !== undefined) body.show_exists_dates = args.show_exists_dates;
      if (args.show_visitors !== undefined) body.show_visitors = args.show_visitors;
      if (args.show_top_by_depth !== undefined) body.show_top_by_depth = args.show_top_by_depth;
      if (args.positions_fields) body.positions_fields = args.positions_fields;
      const result = await client.request("get", "positions_2", "history", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_get_summary",
    "Get a positions summary comparing two dates for a project and single region. Returns keyword distribution across top positions with optional dynamics, tops, averages, and visibility metrics.",
    {
      project_id: z.number().int(),
      region_index: z.number().int().describe("Single region index (from topvisor_list_regions)"),
      dates: z.array(z.string()).length(2).describe("Exactly 2 dates [YYYY-MM-DD, YYYY-MM-DD] for comparison"),
      competitor_id: z.number().int().optional(),
      only_exists_first_date: z.boolean().optional(),
      show_dynamics: z.boolean().optional(),
      show_tops: z.boolean().optional(),
      show_avg: z.boolean().optional(),
      show_visibility: z.boolean().optional(),
    },
    async ({ project_id, region_index, dates, competitor_id, only_exists_first_date, show_dynamics, show_tops, show_avg, show_visibility }) => {
      const body: Record<string, unknown> = { project_id, region_index, dates };
      if (competitor_id !== undefined) body.competitor_id = competitor_id;
      if (only_exists_first_date !== undefined) body.only_exists_first_date = only_exists_first_date;
      if (show_dynamics !== undefined) body.show_dynamics = show_dynamics;
      if (show_tops !== undefined) body.show_tops = show_tops;
      if (show_avg !== undefined) body.show_avg = show_avg;
      if (show_visibility !== undefined) body.show_visibility = show_visibility;
      const result = await client.request("get", "positions_2", "summary", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  server.tool(
    "topvisor_get_summary_chart",
    "Get chart data showing position distribution over time for a project and single region. Returns dates array and seriesByProjectsId for chart rendering.",
    {
      project_id: z.number().int(),
      region_index: z.number().int().describe("Single region index (from topvisor_list_regions)"),
      date1: z.string().optional().describe("YYYY-MM-DD start date (use with date2)"),
      date2: z.string().optional().describe("YYYY-MM-DD end date (use with date1)"),
      dates: z.array(z.string()).optional().describe("Array of specific dates. Use either dates OR date1+date2"),
      competitor_id: z.array(z.number().int()).optional(),
      type_range: z.number().int().optional().describe("Date range type (default 2)"),
      only_exists_first_date: z.boolean().optional(),
      show_tops: z.boolean().optional(),
      show_avg: z.boolean().optional(),
      show_visibility: z.boolean().optional(),
    },
    async ({ project_id, region_index, date1, date2, dates, competitor_id, type_range, only_exists_first_date, show_tops, show_avg, show_visibility }) => {
      const body: Record<string, unknown> = { project_id, region_index };
      if (date1) body.date1 = date1;
      if (date2) body.date2 = date2;
      if (dates) body.dates = dates;
      if (competitor_id) body.competitor_id = competitor_id;
      if (type_range !== undefined) body.type_range = type_range;
      if (only_exists_first_date !== undefined) body.only_exists_first_date = only_exists_first_date;
      if (show_tops !== undefined) body.show_tops = show_tops;
      if (show_avg !== undefined) body.show_avg = show_avg;
      if (show_visibility !== undefined) body.show_visibility = show_visibility;
      const result = await client.request("get", "positions_2", "summary_chart", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );

  // ── snapshots_2 ──────────────────────────────────────────────────────────────

  server.tool(
    "topvisor_get_snapshots",
    "Get SERP snapshots for a project and region. Snapshots are collected when do_snapshots=1 is set in topvisor_check_positions. Returns snapshotsData per keyword. Requires either 'dates' array OR both 'date1' and 'date2'.",
    {
      project_id: z.number().int(),
      region_index: z.number().int().describe("Region index (from topvisor_list_regions, NOT region_key)"),
      date1: z.string().optional().describe("YYYY-MM-DD start date (use with date2)"),
      date2: z.string().optional().describe("YYYY-MM-DD end date (use with date1)"),
      dates: z.array(z.string()).optional().describe("Array of specific YYYY-MM-DD dates. Use either dates OR date1+date2 — both cannot be absent."),
      filters: z.array(Filter).optional().describe("Keyword filters, max 100 per request"),
      type_range: z.number().int().optional().describe("Date range type (default 3)"),
      count_dates: z.number().int().max(31).optional(),
      show_exists_dates: z.boolean().optional(),
      show_ams: z.boolean().optional(),
      positions_fields: z.array(z.enum(["url", "domain", "snippet_title", "snippet_body"])).optional(),
    },
    async (args) => {
      // Client-side guard: must have dates OR (date1 AND date2)
      if (!args.dates && !(args.date1 && args.date2)) {
        return validationError("Either 'dates' array or both 'date1' and 'date2' must be provided");
      }
      const body: Record<string, unknown> = {
        project_id: args.project_id,
        region_index: args.region_index,
      };
      if (args.date1) body.date1 = args.date1;
      if (args.date2) body.date2 = args.date2;
      if (args.dates) body.dates = args.dates;
      if (args.filters) body.filters = args.filters;
      if (args.type_range !== undefined) body.type_range = args.type_range;
      if (args.count_dates !== undefined) body.count_dates = args.count_dates;
      if (args.show_exists_dates !== undefined) body.show_exists_dates = args.show_exists_dates;
      if (args.show_ams !== undefined) body.show_ams = args.show_ams;
      if (args.positions_fields) body.positions_fields = args.positions_fields;
      const result = await client.request("get", "snapshots_2", "history", body);
      if (!result.ok) return apiError(result.errors);
      return json(result.result);
    }
  );
}
