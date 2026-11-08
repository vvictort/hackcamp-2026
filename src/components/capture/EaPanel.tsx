import { useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Mic,
  Minus,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { Button, Card, StatusBadge, useToast } from "@/components/ui";
import {
  PROMPT_LEVELS,
  type PromptLevel,
} from "@/server/altamyra/contract/enums";
import {
  captureErrorKind,
  getCaptureConsent,
  recordEvent,
  sendVoiceNote,
} from "@/lib/altamyra/capture-api";
import { getCaptureObjectives } from "@/lib/altamyra/practice-api";
import { useLoad } from "@/lib/useLoad";
import { useLang } from "@/i18n";
import type { MessageKey } from "@/i18n/en";
import { goalName } from "./NoteCapture";

type Goal = { objective: { id: string }; label: string; metricType: string };
type Kind = "prompt_level" | "counter" | "timer";
const KINDS: Record<string, readonly Kind[]> = {
  prompt_level: ["prompt_level"],
  frequency: ["counter"],
  accuracy: ["counter"],
  rate: ["counter"],
  rubric: ["counter"],
  duration: ["timer"],
  latency: ["timer"],
};
/** Which controls feed a goal: the server accepts an event only when its kind fits the goal's metric. */
export const eventKindsFor = (metricType: string): readonly Kind[] =>
  KINDS[metricType] ?? [];
const BIG = "min-h-14 min-w-14 text-body";

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function EaPanel({ studentId }: { studentId: string }) {
  const { t } = useLang();
  const loaded = useLoad(() => getCaptureObjectives(studentId), studentId);
  const goals: Goal[] | null =
    loaded.status === "ready"
      ? loaded.data.objectives.map((o, i) => ({
          objective: { id: o.objectiveId },
          metricType: o.metricType,
          label: goalName(o, i, t),
        }))
      : null;

  if (loaded.status === "error")
    return (
      <Card>
        <p role="alert">{t("capture.common.loadFailed")}</p>
        <div>
          <Button size="lg" onClick={loaded.reload}>
            {t("capture.common.retry")}
          </Button>
        </div>
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      {goals === null && <p role="status">{t("capture.common.loading")}</p>}
      {goals?.length === 0 && <p>{t("capture.ea.noGoals")}</p>}
      {goals?.map((g) => (
        <GoalCard key={g.objective.id} studentId={studentId} goal={g} />
      ))}
      <VoiceNote studentId={studentId} />
    </div>
  );
}

type Saved = { ok: boolean; text: string } | null;

function SavedStatus({ saved }: { saved: Saved }) {
  if (!saved) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-small font-semibold"
    >
      {saved.ok ? (
        <CircleCheck aria-hidden className="size-5" />
      ) : (
        <CircleX aria-hidden className="size-5" />
      )}
      {saved.text}
    </p>
  );
}

function GoalCard({ studentId, goal }: { studentId: string; goal: Goal }) {
  const { t } = useLang();
  const objectiveId = goal.objective.id;
  const [saved, setSaved] = useState<Saved>(null);
  const [level, setLevel] = useState<PromptLevel | null>(null);
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setElapsed((Date.now() - startedAt.current) / 1000),
      500,
    );
    return () => clearInterval(id);
  }, [running]);

  async function save(
    event: Parameters<typeof recordEvent>[1],
    okText: string,
  ) {
    try {
      await recordEvent(studentId, event);
      setSaved({ ok: true, text: okText });
      return true;
    } catch {
      setSaved({ ok: false, text: t("capture.ea.saveFailed") });
      return false;
    }
  }

  const kinds = eventKindsFor(goal.metricType);
  const levelName = (l: PromptLevel) =>
    t(`capture.ea.level.${l}` as MessageKey);

  return (
    <Card title={goal.label}>
      {kinds.length === 0 && (
        <p className="text-muted-foreground">{t("capture.ea.noControls")}</p>
      )}
      {kinds.length > 0 && kinds.length < 3 && (
        <p className="text-muted-foreground">
          {t("capture.ea.goalUses", {
            kind: t(`capture.ea.kind.${kinds[0]}` as MessageKey),
          })}
        </p>
      )}
      {kinds.includes("prompt_level") && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">
            {t("capture.ea.promptLevel")}
          </legend>
          <div className="flex flex-wrap gap-3">
            {[...PROMPT_LEVELS].reverse().map((l) => (
              <Button
                key={l}
                variant={level === l ? "default" : "outline"}
                aria-pressed={level === l}
                className={BIG}
                onClick={async () => {
                  setLevel(l);
                  await save(
                    {
                      kind: "prompt_level",
                      objectiveId,
                      promptLevel: l,
                      classId: null,
                      lessonId: null,
                    },
                    t("capture.ea.savedLevel", { level: levelName(l) }),
                  );
                }}
              >
                {levelName(l)}
              </Button>
            ))}
          </div>
        </fieldset>
      )}

      {kinds.includes("counter") && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">{t("capture.ea.counter")}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className={BIG}
              aria-label={t("capture.ea.minus")}
              onClick={() => setCount((n) => Math.max(0, n - 1))}
            >
              <Minus aria-hidden />
            </Button>
            <span
              aria-live="polite"
              className="min-w-24 text-center text-h2 font-extrabold"
            >
              {t("capture.ea.count", { n: count })}
            </span>
            <Button
              variant="outline"
              className={BIG}
              aria-label={t("capture.ea.plus")}
              onClick={() => setCount((n) => n + 1)}
            >
              <Plus aria-hidden />
            </Button>
            <Button
              className={BIG}
              onClick={() =>
                save(
                  {
                    kind: "counter",
                    objectiveId,
                    count,
                    classId: null,
                    lessonId: null,
                  },
                  t("capture.ea.savedCount", { n: count }),
                )
              }
            >
              {t("capture.ea.saveCount")}
            </Button>
          </div>
        </div>
      )}

      {kinds.includes("timer") && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">{t("capture.ea.timer")}</h3>
          <div className="flex flex-wrap items-center gap-3">
            {!running ? (
              <Button
                className={BIG}
                onClick={() => {
                  startedAt.current = Date.now();
                  setElapsed(0);
                  setRunning(true);
                }}
              >
                <Play aria-hidden />
                {t("capture.ea.start")}
              </Button>
            ) : (
              <Button
                variant="destructive"
                className={BIG}
                onClick={async () => {
                  const seconds = Math.round(
                    (Date.now() - startedAt.current) / 1000,
                  );
                  setRunning(false);
                  setElapsed(seconds);
                  await save(
                    {
                      kind: "timer",
                      objectiveId,
                      durationSeconds: seconds,
                      classId: null,
                      lessonId: null,
                    },
                    t("capture.ea.savedTime", { seconds }),
                  );
                }}
              >
                <Square aria-hidden />
                {t("capture.ea.stop")}
              </Button>
            )}
            <span className="text-h2 font-extrabold tabular-nums">
              {t("capture.ea.elapsed", { time: formatClock(elapsed) })}
            </span>
            {running && (
              <StatusBadge tone="info">{t("capture.ea.running")}</StatusBadge>
            )}
          </div>
        </div>
      )}
      <SavedStatus saved={saved} />
    </Card>
  );
}

function VoiceNote({ studentId }: { studentId: string }) {
  const { t } = useLang();
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<Saved>(null);
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const consent = useLoad(() => getCaptureConsent(studentId), studentId);

  async function send(blob: Blob) {
    setBusy(true);
    try {
      const r = await sendVoiceNote(studentId, blob);
      const msg = t("capture.ea.voiceSent", { n: r.dataPoints.length });
      setStatus({ ok: true, text: msg });
      toast.success(msg);
    } catch (err) {
      setStatus({
        ok: false,
        text: t(
          captureErrorKind(err) === "consent"
            ? "capture.ea.voiceNoConsent"
            : "capture.ea.voiceFailed",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return setStatus({ ok: false, text: t("capture.ea.voiceUnsupported") });
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void send(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
      };
      rec.current = r;
      r.start();
      setRecording(true);
      setStatus(null);
    } catch {
      setStatus({ ok: false, text: t("capture.ea.voiceDenied") });
    }
  }

  function stop() {
    rec.current?.stop();
    setRecording(false);
  }

  return (
    <Card title={t("capture.ea.voice")}>
      <p className="text-muted-foreground">{t("capture.ea.voiceHint")}</p>
      {consent.data?.voiceNote === false ? (
        <StatusBadge tone="warning">
          {t("capture.ea.voiceNeedsConsent")}
        </StatusBadge>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {!recording ? (
            <Button className={BIG} onClick={start} loading={busy}>
              <Mic aria-hidden />
              {t("capture.ea.record")}
            </Button>
          ) : (
            <Button variant="destructive" className={BIG} onClick={stop}>
              <Square aria-hidden />
              {t("capture.ea.stopRecording")}
            </Button>
          )}
          {recording && (
            <StatusBadge tone="info">{t("capture.ea.recording")}</StatusBadge>
          )}
        </div>
      )}
      <SavedStatus saved={status} />
    </Card>
  );
}
