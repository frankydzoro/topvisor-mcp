// Topvisor API v2 client.
// Transport: POST https://api.topvisor.com/v2/json/{operator}/{service}/{method}
// Auth: headers User-Id + Authorization: bearer <key>
// Error detection: result===null && errors.length > 0 (NOT HTTP status — all responses are HTTP 200)

export interface TopvisorError {
  code: number;
  string: string;
  detail?: unknown;
}

export interface TopvisorSuccess {
  ok: true;
  result: unknown;
  limitedBy?: number;
  total?: number;
}

export interface TopvisorFailure {
  ok: false;
  errors: TopvisorError[];
}

export type TopvisorResult = TopvisorSuccess | TopvisorFailure;

export class TopvisorApiClient {
  private baseUrl: string;
  private userId: string;
  private apiKey: string;
  private httpTimeoutMs: number;

  constructor() {
    this.baseUrl = (process.env.TOPVISOR_API_URL || "https://api.topvisor.com/v2/json").replace(/\/$/, "");
    this.userId = process.env.TOPVISOR_USER_ID || "";
    this.apiKey = process.env.TOPVISOR_API_KEY || "";
    this.httpTimeoutMs = parseInt(process.env.TOPVISOR_HTTP_TIMEOUT_MS || "30000", 10);
  }

  assertCreds(): void {
    if (!this.userId || !this.apiKey) {
      throw new Error("TOPVISOR_USER_ID and TOPVISOR_API_KEY must be set in the environment");
    }
  }

  async request(
    operator: string,
    service: string,
    method: string,
    body: Record<string, unknown> = {}
  ): Promise<TopvisorResult> {
    this.assertCreds();

    const url = `${this.baseUrl}/${operator}/${service}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Id": this.userId,
          "Authorization": `bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request timed out after ${this.httpTimeoutMs}ms`);
      }
      throw err;
    }
    clearTimeout(timer);

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} on ${operator}/${service}/${method}`);
      }
      throw new Error(`Failed to parse JSON response from ${operator}/${service}/${method}`);
    }

    // Canonical Topvisor error detection: result===null AND errors[] present
    // All API responses come as HTTP 200 — do NOT use HTTP status for error detection
    const d = data as Record<string, unknown>;
    if (d?.result === null && Array.isArray(d?.errors) && d.errors.length > 0) {
      return { ok: false, errors: d.errors as TopvisorError[] };
    }

    return {
      ok: true,
      result: d?.result !== undefined ? d.result : data,
      ...(d?.limitedBy !== undefined ? { limitedBy: d.limitedBy as number } : {}),
      ...(d?.total !== undefined ? { total: d.total as number } : {}),
    };
  }
}
