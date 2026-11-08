import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, FileUp } from "lucide-react";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { GoalCard } from "@/components/students/GoalCard";
import { IepImportDialog } from "@/components/students/IepImportDialog";
import { PlanTab } from "@/components/students/PlanTab";
import { TicketPanel } from "@/components/students/TicketPanel";
import { Timeline } from "@/components/students/Timeline";
import { WhatWorks } from "@/components/students/WhatWorks";
import { fmtDate } from "@/components/students/text";
import { LoadError, useLoad } from "@/lib/useLoad";
import { RoleGate } from "@/lib/altamyra/RoleGate";
import { useAltamyraMe, visibleStudents } from "@/lib/altamyra/role";
import {
  getObjectives,
  getProfile,
  getTimeline,
} from "@/lib/altamyra/students-api";
import { useLang } from "@/i18n";

function List({ items }: { items: string[] }) {
  const { t } = useLang();
  return items.length === 0 ? (
    <p className="text-small text-muted-foreground">{t("students.none")}</p>
  ) : (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => (
        <li key={x}>
          <Badge variant="secondary" className="whitespace-normal">
            {x}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function StudentProfileBody() {
  const { t } = useLang();
  const { id = "" } = useParams();
  const [rev, setRev] = useState(0);
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "plan" ? "plan" : "iep";
  const setTab = (v: "iep" | "plan") =>
    setParams(v === "plan" ? { tab: "plan" } : {}, { replace: true });
  const bump = () => setRev((n) => n + 1);

  const { me } = useAltamyraMe();
  const profile = useLoad(() => getProfile(id), `${id}:${rev}`);
  const full = profile.status === "ready" && profile.data.view === "full";
  const objectives = useLoad(
    () => getObjectives(id),
    full ? `${id}:${rev}` : null,
  );
  const timeline = useLoad(
    () => getTimeline(id),
    profile.status === "ready" ? `${id}:${rev}` : null,
  );

  const roles = visibleStudents(me).find((x) => x.id === id)?.roles ?? [];
  const isCm = roles.includes("case_manager");
  const isTeacher = roles.includes("teacher");
  const canRate = isCm || roles.includes("teacher") || roles.includes("ea");

  if (profile.status === "loading")
    return (
      <p role="status" className="text-muted-foreground">
        {t("students.loading")}
      </p>
    );
  if (profile.status === "error")
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{profile.error.message}</p>
        <Button
          variant="outline"
          className="self-start"
          onClick={profile.reload}
        >
          {t("students.retry")}
        </Button>
      </div>
    );

  const p = profile.data;
  const back = (
    <Link
      to="/students"
      className="inline-flex min-h-11 items-center gap-1 self-start rounded-full text-label font-semibold"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("students.back")}
    </Link>
  );

  if (p.view === "supports") {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-6">
        {back}
        <PageHeader
          title={p.firstName ?? t("students.student")}
          description={t("students.supportsView")}
        />
        <Card title={t("students.supports")}>
          <List items={p.supports} />
        </Card>
        <WhatWorks studentId={id} />
      </div>
    );
  }

  const objs = objectives.status === "ready" ? objectives.data.objectives : [];
  const sec = p.sections;
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      {back}
      <PageHeader
        title={sec?.student.preferredName || sec?.student.firstName || p.displayToken}
        description={t("students.profile.summary", {
          grade: p.grade,
          version: p.iepVersion ?? "-",
          review: fmtDate(sec?.reviewDate) || "-",
        })}
        actions={
          isCm && !sec && (
            <Button onClick={() => setImporting(true)}>
              <FileUp aria-hidden />
              {t("students.import.open")}
            </Button>
          )
        }
      />
      {roles.length > 0 && (
        <p className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <Badge key={r} variant="outline">
              {r.replace("_", " ")}
            </Badge>
          ))}
        </p>
      )}

      <div role="tablist" aria-label={p.displayToken} className="flex gap-2">
        {(["iep", "plan"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-full px-5 text-label font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${tab === k ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          >
            {t(k === "iep" ? "students.tab.iep" : "students.tab.plan")}
          </button>
        ))}
      </div>

      {tab === "plan" ? (
        <div role="tabpanel" id="panel-plan" aria-labelledby="tab-plan">
          <PlanTab studentId={id} canEdit={isTeacher} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="panel-iep"
          aria-labelledby="tab-iep"
          className="flex flex-col gap-6 lg:gap-8"
        >
          {!sec ? (
            <Card title={t("students.noIep")}>
              <p className="text-body text-muted-foreground">
                {t(isCm ? "students.noIepCm" : "students.noIepOther")}
              </p>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <Card title={t("students.strengths")}>
                <List items={sec.profile.strengths} />
              </Card>
              <Card title={t("students.accommodations")}>
                <List items={sec.accommodations} />
              </Card>
              <Card title={t("students.supports")}>
                <List items={sec.supports} />
              </Card>
              <Card title={t("students.modifications")}>
                {sec.modifications.length === 0 ? (
                  <p className="text-small text-muted-foreground">
                    {t("students.none")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-body">
                    {sec.modifications.map((m) => (
                      <li key={m.subject}>
                        <strong>{m.subject}</strong>: {m.description}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {p.goals.length > 0 && (
            <section aria-labelledby="goals-h" className="flex flex-col gap-4">
              <h2 id="goals-h" className="text-h2 font-extrabold">
                {t("students.goals")}
              </h2>
              {objectives.status === "error" && (
                <LoadError error={objectives.error} />
              )}
              {p.goals.map((g) => (
                <GoalCard
                  key={g.id}
                  studentId={id}
                  goal={g}
                  objectives={objs.filter((o) => o.goalId === g.id)}
                  canConfirm={isCm}
                  canRate={canRate}
                  onChanged={bump}
                />
              ))}
            </section>
          )}

          {timeline.status === "ready" ? (
            <Timeline
              studentId={id}
              dataPoints={timeline.data.dataPoints}
              decisions={timeline.data.decisions}
              goals={p.goals}
              objectives={objs}
            />
          ) : timeline.status === "error" ? (
            <Card title={t("students.timeline")}>
              <LoadError error={timeline.error} />
            </Card>
          ) : null}

          <WhatWorks studentId={id} />

          {isCm && sec && (
            <TicketPanel
              studentId={id}
              targets={[
                ...p.goals.map((g) => ({
                  value: `goal:${g.id}`,
                  label: g.area,
                })),
                ...[
                  ["strengths", "students.strengths"],
                  ["accommodations", "students.accommodations"],
                  ["supports", "students.supports"],
                ].map(([v, k]) => ({
                  value: `section:${v}`,
                  label: t("ticket.section", {
                    name: t(k as "students.strengths"),
                  }),
                })),
              ]}
            />
          )}
        </div>
      )}

      <IepImportDialog
        studentId={id}
        open={importing}
        onOpenChange={setImporting}
        onConfirmed={bump}
      />
    </div>
  );
}

export default function StudentProfilePage() {
  return (
    <RoleGate path="/students">
      <StudentProfileBody />
    </RoleGate>
  );
}
