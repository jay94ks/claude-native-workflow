export interface Action {
  action: string;
  [key: string]: unknown;
}

export interface ActionResult {
  ok: boolean;
  data?: unknown;
  reason?: string[];
}

export interface Envelope<T> {
  notices: unknown[];
  status: string;
  result: T;
}

export interface LoginResult {
  architectId: string;
  apiKey: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class ApiClient {
  constructor(private readonly endpoint: string, private readonly apiKey?: string) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const res = await fetch(this.url("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      throw new ApiError(`login failed: ${res.status} ${await res.text()}`, res.status);
    }
    return (await res.json()) as LoginResult;
  }

  /** Sends a bulk action array to the single `/api/actions` endpoint. */
  async run(actions: Action[]): Promise<Envelope<ActionResult[]>> {
    if (!this.apiKey) {
      throw new ApiError("no apiKey configured - run \"docs auth login\" first", 401);
    }
    const res = await fetch(this.url("/api/actions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        // CLI/MCP는 항상 "클로드" 채널이다 (design-notes.md "역할 구분") -
        // 이 헤더가 없는 요청(장차 Phase 9의 WEB UI)은 서버가 architect로 간주한다.
        "X-Cnw-Channel": "agent",
      },
      body: JSON.stringify(actions),
    });
    if (!res.ok) {
      throw new ApiError(`request failed: ${res.status} ${await res.text()}`, res.status);
    }
    return (await res.json()) as Envelope<ActionResult[]>;
  }

  /** Convenience for a single action - still goes through the bulk endpoint. */
  async runOne(action: Action): Promise<ActionResult> {
    const { result } = await this.run([action]);
    return result[0];
  }

  private url(pathname: string): string {
    return new URL(pathname, this.endpoint).toString();
  }
}
