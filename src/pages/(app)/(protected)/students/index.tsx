import { RoleGate } from "@/lib/altamyra/RoleGate";
import { Link, useNavigate } from "react-router";
import { UsersRound } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { useLoad } from "@/lib/useLoad";
import { getTodayPlans, missingPlan } from "@/lib/altamyra/plans-api";
import { useAltamyraMe, visibleStudents } from "@/lib/altamyra/role";
import { studentLabel } from "@/components/capture/StudentSelect";
import { useLang } from "@/i18n";

function StudentsPageBody() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { me } = useAltamyraMe();
  const list = visibleStudents(me);
  const isTeacher = list.some((x) => x.roles.includes("teacher"));
  const today = useLoad(getTodayPlans, isTeacher ? "today" : null);
  const missing = missingPlan(today.status === "ready" ? today.data : null);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      <PageHeader
        title={t("students.list.title")}
        description={t("students.list.description")}
      />
      {list.length === 0 && (
        <Card>
          <EmptyState
            icon={<UsersRound aria-hidden />}
            title={t("students.list.empty")}
            description={t("students.list.emptyHelp")}
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
                  {studentLabel(st, t)}
                </span>
                <span className="text-small text-muted-foreground">
                  {t("students.grade", { grade: st.grade })}
                </span>
              </Link>
              {isTeacher &&
                st.roles.includes("teacher") &&
                today.status === "ready" &&
                (missing.has(st.id) ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="warning">
                      {t("students.list.noPlan")}
                    </StatusBadge>
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/students/${encodeURIComponent(st.id)}?tab=plan`,
                        )
                      }
                    >
                      {t("students.list.addPlan")}
                    </Button>
                  </span>
                ) : (
                  <StatusBadge tone="success">
                    {t("students.list.hasPlan")}
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
