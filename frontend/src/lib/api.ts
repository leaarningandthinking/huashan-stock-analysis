/**
 * 后端 API 调用封装。Next.js rewrites 会把 /api/* 代理到 FastAPI。
 */

const BASE = ""; // 走 Next 同源代理

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(await formatApiError(res, `GET ${path}`));
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await formatApiError(res, `POST ${path}`));
  }
  return res.json() as Promise<T>;
}

async function formatApiError(res: Response, label: string): Promise<string> {
  try {
    const data = await res.json();
    const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data);
    return `${label} failed: ${res.status} ${detail}`;
  } catch {
    return `${label} failed: ${res.status}`;
  }
}

export interface MasterSummary {
  slug: string;
  name: string;
  tagline: string;
  school: "huaren" | "western" | "technical";
  school_label: string;
  avatar_url: string | null;
}
