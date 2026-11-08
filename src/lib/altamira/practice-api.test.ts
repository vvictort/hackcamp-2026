import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("deepspace", () => ({ getAuthToken: vi.fn(async () => "tok") }));

import {
  createSampleSheet,
  getCaptureObjectives,
  PracticeApiError,
  sampleFileKey,
  optionSymbol,
  sessionRespond,
  startStudentMode,
  symbolsFor,
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
  it("sends the session header, not the bearer, for student-mode calls", async () => {
    reply({ correct: true }, 201);
    await sessionRespond(
      { sessionId: "a", token: "sess", expiresAt: "" },
      { itemId: "f/q1", response: "12" },
    );
    const h = last()[1].headers as Record<string, string>;
    expect(h["X-Altamira-Session"]).toBe("sess");
    expect(h.Authorization).toBeUndefined();
  });
  it("posts sample sheet and start requests, and surfaces errors", async () => {
    reply({ code: "AL-ABC", studentId: "s", checkId: "c" });
    expect((await createSampleSheet("s")).code).toBe("AL-ABC");
    expect(JSON.parse(last()[1].body as string)).toEqual({ studentId: "s" });
    reply({ error: { code: "forbidden", message: "no consent" } }, 403);
    await expect(startStudentMode("s")).rejects.toMatchObject({
      status: 403,
      message: "no consent",
    } satisfies Partial<PracticeApiError>);
  });
  it("names the sample file so the server reads the code", () => {
    expect(sampleFileKey("AL-X1", 7)).toBe(
      "captures/7/sample-sheet-code-AL-X1.png",
    );
  });
  it("picks symbols from the prompt", () => {
    expect(symbolsFor("How many apples? 3 + 2")).toEqual([
      "apple",
      "three",
      "two",
    ]);
    expect(symbolsFor("Explain your thinking")).toEqual([]);
  });
});

describe("option symbols", () => {
  it("maps the self-rating options to their own symbols", () => {
    expect(optionSymbol("I did it")).toBe("thumbs");
    expect(optionSymbol("I need help")).toBe("help");
  });
  it("falls back to a word in the label, else none", () => {
    expect(optionSymbol("cat")).toBe("cat");
    expect(optionSymbol("purple")).toBeNull();
  });
});
