export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `Request failed (${status})`,
    );
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export type MeResponse = {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    mfa: { enabled: boolean; note: string };
  };
  organizations: Array<{ id: string; name: string; role: string }>;
  practices: Array<{ id: string; name: string; orgId: string; role: string }>;
  active: {
    orgId: string;
    orgName: string;
    practiceId: string;
    practiceName: string;
    role: string;
  } | null;
};

export type Patient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  condition: string | null;
  status: string;
};
