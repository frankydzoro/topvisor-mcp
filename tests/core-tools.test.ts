import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TopvisorApiClient } from "../src/api-client.js";
import { registerCoreTools } from "../src/tools/core.js";

type Handler = (input: string, init?: RequestInit) => Response | Promise<Response>;

// Route fetch by URL substring. Routes are checked in order; first match wins.
function routeFetch(routes: Array<[string, Handler]>) {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    for (const [sub, h] of routes) {
      if (input.includes(sub)) return h(input, init);
    }
    throw new Error(`Unmocked URL: ${input}`);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const json200 = (obj: unknown) => () => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

async function makeClient(): Promise<Client> {
  const client = new TopvisorApiClient();
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCoreTools(server, client);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
  await mcpClient.connect(clientT);
  return mcpClient;
}

const call = async (mcp: Client, name: string, args: Record<string, unknown>) => {
  const res = await mcp.callTool({ name, arguments: args });
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return content?.map((c) => c.text ?? "").join("") ?? "";
};

describe("registerCoreTools (via MCP protocol)", () => {
  beforeEach(() => {
    process.env.TOPVISOR_USER_ID = "12534";
    process.env.TOPVISOR_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).fetch;
    delete process.env.TOPVISOR_RETRIES;
  });

  it("list_groups returns groups (read-only path)", async () => {
    const fetchFn = routeFetch([["keywords_2/groups", json200({ result: [{ id: 1, name: "Блог" }], total: 1 })]]);
    const mcp = await makeClient();
    const text = await call(mcp, "topvisor_list_groups", { project_id: 5458300 });
    expect(text).toContain("Блог");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("list_groups with include_meta wraps pagination metadata (B4)", async () => {
    routeFetch([["keywords_2/groups", json200({ result: [{ id: 1 }], total: 1, limitedBy: 1 })]]);
    const mcp = await makeClient();
    const text = await call(mcp, "topvisor_list_groups", { project_id: 5458300, include_meta: true });
    expect(text).toContain('"result"');
    expect(text).toContain('"total": 1');
    expect(text).toContain('"limitedBy": 1');
  });

  it("check_positions wait=true polls until done and returns completed status (B1)", async () => {
    let polls = 0;
    const fetchFn = routeFetch([
      // 1. submit checker/go
      ["checker/go", json200({ result: { projectsIds: [111] } })],
      // 2. poll get projects — first poll returns done immediately (no sleep)
      ["/projects_2/projects", () => {
        polls++;
        return json200({ result: [{ id: 111, status_positions: "0", positions_percent: 100 }] })();
      }],
      // 3. history
      ["/history", json200({ result: { keywords: [{ id: 1, name: "тест", positionsData: {} }] } })],
    ]);

    process.env.TOPVISOR_RETRIES = "2";
    const mcp = await makeClient();
    const text = await call(mcp, "topvisor_check_positions", {
      project_id: 5458300,
      regions_indexes: [1],
      wait: true,
      poll_interval_seconds: 5,
      history_dates: ["2026-08-13"],
    });
    expect(text).toContain('"completed": true');
    expect(text).toContain('"waited": true');
    expect(text).toContain('"keywords"');
    // submit + 1 poll + history
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("delete_groups rejects when neither ids nor filters given (validation)", async () => {
    const mcp = await makeClient();
    const text = await call(mcp, "topvisor_delete_groups", { project_id: 1 });
    expect(text).toContain("ids");
  });

  it("delete_groups with ids builds an IN filter", async () => {
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.filters).toEqual([{ name: "id", operator: "IN", values: [7, 8] }]);
      return new Response(JSON.stringify({ result: 1 }), { status: 200 });
    }) as never;
    const mcp = await makeClient();
    const text = await call(mcp, "topvisor_delete_groups", { project_id: 1, ids: [7, 8] });
    // del returns the count of removed object(s) — a bare number
    expect(text.trim()).toBe("1");
  });
});