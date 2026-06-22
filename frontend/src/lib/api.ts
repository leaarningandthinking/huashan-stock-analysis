/**
 * 后端 API 调用封装。Next.js rewrites 会把 /api/* 代理到 FastAPI。
 */

const BASE = ""; // 走 Next 同源代理

export async function apiGet<T>(path: string): Promise<T> {
  return requestJson<T>(
    path,
    "GET",
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(
    path,
    "POST",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

async function requestJson<T>(
  path: string,
  method: "GET" | "POST",
  init: RequestInit,
  retry = true,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    if (retry) {
      await wait(450);
      return requestJson<T>(path, method, init, false);
    }
    throw error;
  }

  if (!res.ok) {
    if (retry && res.status >= 500) {
      await wait(450);
      return requestJson<T>(path, method, init, false);
    }
    throw new Error(await formatApiError(res, `${method} ${path}`));
  }
  return res.json() as Promise<T>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  tags?: string[];
  bio?: string;
}
