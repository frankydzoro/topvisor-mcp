import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TopvisorApiClient } from "../src/api-client.js";

const URL_BASE = "https://api.topvisor.com/v2/json";

function mockFetch(handler: (input: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(handler as never);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("TopvisorApiClient", () => {
  beforeEach(() => {
    process.env.TOPVISOR_USER_ID = "12534";
    process.env.TOPVISOR_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).fetch;
  });

  it("builds the correct URL and auth headers (get)", async () => {
    const fn = mockFetch(async () => new Response(JSON.stringify({ result: [{ id: 1 }], total: 1 }), { status: 200 }));
    const client = new TopvisorApiClient();
    const res = await client.request("get", "projects_2", "projects", { fields: ["id"] });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.total).toBe(1);
    }
    const call = fn.mock.calls[0];
    expect(call[0]).toBe(`${URL_BASE}/get/projects_2/projects`);
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(headers["User-Id"]).toBe("12534");
    expect(headers["Authorization"]).toBe("bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("detects Topvisor API errors (result===null + errors[]), HTTP 200", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ result: null, errors: [{ code: 53, string: "Authorisation error", detail: {} }] }),
        { status: 200 }
      )
    );
    const client = new TopvisorApiClient();
    const res = await client.request("get", "bank_2", "history");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0].code).toBe(53);
      expect(res.errors[0].string).toContain("Authorisation");
    }
  });

  it("asserts credentials before any request", async () => {
    delete process.env.TOPVISOR_USER_ID;
    const client = new TopvisorApiClient();
    await expect(client.request("get", "bank_2", "history")).rejects.toThrow("TOPVISOR_USER_ID");
  });

  it("retries on transient Topvisor code 429 with backoff", async () => {
    const fn = mockFetch(
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ result: null, errors: [{ code: 429, string: "Too many requests" }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ result: [{ id: 7 }] }), { status: 200 })
        ) as never
    );
    process.env.TOPVISOR_RETRIES = "2";
    const client = new TopvisorApiClient();
    const res = await client.request("get", "positions_2", "history");
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    delete process.env.TOPVISOR_RETRIES;
  });

  it("does NOT retry on a non-transient error (e.g. code 1002)", async () => {
    const fn = mockFetch(async () =>
      new Response(JSON.stringify({ result: null, errors: [{ code: 1002, string: "Param mismatch" }] }), {
        status: 200,
      })
    );
    const client = new TopvisorApiClient();
    const res = await client.request("edit", "positions_2", "checker/go");
    expect(res.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP 5xx and recovers", async () => {
    const fn = mockFetch(
      vi
        .fn()
        .mockResolvedValueOnce(new Response("boom", { status: 502 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ result: [{ ok: true }] }), { status: 200 })) as never
    );
    process.env.TOPVISOR_RETRIES = "2";
    const client = new TopvisorApiClient();
    const res = await client.request("get", "bank_2", "history");
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    delete process.env.TOPVISOR_RETRIES;
  });
});