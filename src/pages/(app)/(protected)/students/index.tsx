import { RoleGate } from "@/lib/altamira/RoleGate";
import { Link, useNavigate } from "react-router-dom";
import { UsersRound } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { RoleBadge } from "@/components/students/badges";
import { s } from "@/components/students/text";
import { useLoad } from "@/components/students/useLoad";
import { getMe } from "@/lib/altamira/students-api";
import { getTodayPlans, missingPlan } from "@/lib/altamira/plans-api";
import type { StudentSummary } from "@/server/altamira/contract/api";

function StudentsPageBody() {
  const navigate = useNavigate();
  const me = useLoad(getMe, "me");
  const list: StudentSummary[] =
    me.status === "ready"
      ? [
          ...new Map(
            [...me.data.caseload, ...me.data.students].map((x) => [x.id, x]),
          ).values(),
        ]
      : [];
  const isTeacher =
    me.status === "ready" &&
    me.data.students.some((x) => x.roles.includes("teacher"));
  const today = useLoad(getTodayPlans, isTeacher ? "today" : null);
  const missing = missingPlan(today.status === "ready" ? today.data : null);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      <PageHeader
        title={s("students.list.title")}
        description={s("students.list.description")}
      />
      {me.status === "loading" && (
        <p role="status" className="text-muted-foreground">
          {s("students.loading")}
        </p>
      )}
      {me.status === "error" && <p role="alert">{me.error.message}</p>}
      {me.status === "ready" && list.length === 0 && (
        <Card>
          <EmptyState
            icon={<UsersRound aria-hidden />}
            title={s("students.list.empty")}
            description={s("students.list.emptyHelp")}
          />
        </Card>
      )}
      <ul className="stagger-rise grid gap-4 sm:grid-cols-2">
        {list.map((st) => (
          <li key={st.id}>
            <Card className="h-full transition-shadow hover:shadow-lift">
              <Link
                to={`/students/${encodeURIComponent(st.id)}`}
                className="flex flex-col gap-1 rounded-lg"
              >
                <span className="text-h2 font-extrabold">
                  {st.firstName ?? st.displayToken}
                </span>
                <span className="text-small text-muted-foreground">
                  {s("students.grade", { grade: st.grade })}
                </span>
                <span className="flex flex-wrap gap-2">
                  {st.roles.map((r) => (
                    <RoleBadge key={r} role={r} />
                  ))}
                </span>
              </Link>
              {isTeacher &&
                st.roles.includes("teacher") &&
                today.status === "ready" &&
                (missing.has(st.id) ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="warning">
                      {s("students.list.noPlan")}
                    </StatusBadge>
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/students/${encodeURIComponent(st.id)}?tab=plan`,
                        )
                      }
                    >
                      {s("students.list.addPlan")}
                    </Button>
                  </span>
                ) : (
                  <StatusBadge tone="success">
                    {s("students.list.hasPlan")}
                  </StatusBadge>
                ))}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StudentsPage() {
  return (
    <RoleGate path="/students">
      <StudentsPageBody />
    </RoleGate>
  );
}
