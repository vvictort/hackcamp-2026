import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("deepspace", () => ({ getAuthToken: vi.fn(async () => "tok") }));

import type { ApiError } from "./api";
import {
  createSampleSheet,
  getCaptureObjectives,
  sampleFileKey,
} from "./practice-api";

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
const last = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("practice api", () => {
  it("sends the bearer for staff calls", async () => {
    reply({ objectives: [] });
    await getCaptureObjectives("s 1");
    const [url, init] = last();
    expect(url).toBe("/api/v1/students/s%201/capture-objectives");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });
  it("posts sample sheet requests and surfaces errors", async () => {
    reply({ code: "AL-ABC", studentId: "s", checkId: "c" });
    expect((await createSampleSheet("s")).code).toBe("AL-ABC");
    expect(JSON.parse(last()[1].body as string)).toEqual({ studentId: "s" });
    reply({ error: { code: "forbidden", message: "no consent" } }, 403);
    await expect(createSampleSheet("s")).rejects.toMatchObject({
      status: 403,
      message: "no consent",
    } satisfies Partial<ApiError>);
  });
  it("names the sample file so the server reads the code", () => {
    expect(sampleFileKey("AL-X1", 7)).toBe(
      "captures/7/sample-sheet-code-AL-X1.png",
    );
  });
});
