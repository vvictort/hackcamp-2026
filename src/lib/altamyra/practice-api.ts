import { apiFetch, enc } from "./api";

export type CaptureObjective = {
  objectiveId: string;
  metricType: string;
  unit: string;
};
/** Goals the caller may record against (ids, metric type, unit). Works for EAs. */
export const getCaptureObjectives = (studentId: string) =>
  apiFetch<{ objectives: CaptureObjective[] }>(
    `/students/${enc(studentId)}/capture-objectives`,
  );

export type SampleSheet = { code: string; studentId: string; checkId: string };
/** Dev demo only: 404 unless the server runs with ALTAMYRA_DEV_SEED. */
export const createSampleSheet = (studentId: string) =>
  apiFetch<SampleSheet>("/captures/sample-sheet", { body: { studentId } });

/** File key for a sample sheet; the server parses the sheet code from it and treats it as a demo. */
export const sampleFileKey = (code: string, now = Date.now()) =>
  `captures/${now}/sample-sheet-code-${code}.png`;
