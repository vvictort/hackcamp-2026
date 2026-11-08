import { getAuthToken } from "deepspace";
/**
 * Client calls for capture goals and the demo sample sheet, over the
 * Altamira /api/v1 routes. Calls carry the DeepSpace bearer token.
 */
const BASE = "/api/v1";

export class PracticeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PracticeApiError";
  }
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = await getAuthToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new PracticeApiError(
      res.status,
      err?.code ?? "error",
      err?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

// ---------- EA ----------

export type CaptureObjective = {
  objectiveId: string;
  metricType: string;
  unit: string;
};
/** Goals the caller may record against (ids, metric type, unit). Works for EAs. */
export const getCaptureObjectives = (studentId: string) =>
  call<{ objectives: CaptureObjective[] }>(
    "GET",
    `/students/${enc(studentId)}/capture-objectives`,
  );

// ---------- demo sample sheet ----------

export type SampleSheet = { code: string; studentId: string; checkId: string };
/** Dev demo only: 404 unless the server runs with ALTAMIRA_DEV_SEED. */
export const createSampleSheet = (studentId: string) =>
  call<SampleSheet>("POST", "/captures/sample-sheet", { studentId });

/** File key for a sample sheet; the server parses the sheet code from it and treats it as a demo. */
export const sampleFileKey = (code: string, now = Date.now()) =>
  `captures/${now}/sample-sheet-code-${code}.png`;
