/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Loader } from "@plane/ui";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { EmployeeGanttLegend } from "./chart/legend";
import { EmployeeGanttChart } from "./chart/root";
import { EmployeeGanttContext } from "./data/context";
import { useEmployeeGanttData } from "./data/use-employee-gantt-data";
import { EmployeeGanttSummary } from "./summary";
import { EmployeeGanttToolbar } from "./toolbar";

type Props = {
  workspaceSlug: string;
};

function ChartLoader() {
  return (
    <Loader className="flex flex-col gap-2 p-4">
      {Array.from({ length: 8 }).map((_, index) => (
        // oxlint-disable-next-line react/no-array-index-key
        <Loader.Item key={index} height="46px" />
      ))}
    </Loader>
  );
}

const EmployeeGanttContent = observer(function EmployeeGanttContent(props: Props) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const employeeGantt = useEmployeeGanttData(workspaceSlug);
  const { isLoading, error, retry, schedules, isEmpty, hasActiveFilters, clearFilters, filters } = employeeGantt;
  // employees are on screen but every bar was filtered away, so the chart would be a blank grid
  const isFilteredEmpty = schedules.length > 0 && schedules.every((schedule) => schedule.assignments.length === 0);
  // the "today only" case deserves its own wording: nothing today is a finding, not a dead end
  const filteredEmptyKey = filters.todayOnly ? "employee_gantt.empty_today" : "employee_gantt.empty_filtered";

  return (
    <EmployeeGanttContext.Provider value={employeeGantt}>
      <div className="flex h-full w-full flex-col gap-3 overflow-hidden px-4 py-3 md:px-6">
        {/* the breadcrumb already names the page, so the header goes straight to the numbers */}
        <header className="flex flex-col gap-2">
          <EmployeeGanttSummary />
          <EmployeeGanttToolbar />
        </header>

        {error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-subtle bg-danger-subtle px-6 py-10 text-center">
            <AlertTriangle className="size-6 text-danger-primary" />
            <p className="text-14 font-medium text-primary">{t("employee_gantt.error.title")}</p>
            <p className="max-w-md text-13 text-secondary">{t("employee_gantt.error.description")}</p>
            <Button variant="secondary" size="sm" onClick={retry} prependIcon={<RefreshCw className="size-3.5" />}>
              {t("employee_gantt.error.retry")}
            </Button>
          </div>
        ) : isLoading ? (
          <ChartLoader />
        ) : isEmpty ? (
          <div className="rounded-lg border border-subtle bg-surface-1 px-6 py-10 text-center">
            <p className="text-14 font-medium text-primary">{t("employee_gantt.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-lg text-13 text-secondary">{t("employee_gantt.empty.description")}</p>
          </div>
        ) : schedules.length === 0 ? (
          <div className="rounded-lg border border-subtle bg-surface-1 px-6 py-10 text-center">
            <p className="text-14 font-medium text-primary">{t("employee_gantt.no_matches.title")}</p>
            <p className="mx-auto mt-1 max-w-lg text-13 text-secondary">{t("employee_gantt.no_matches.description")}</p>
            {hasActiveFilters && (
              <Button variant="secondary" size="sm" onClick={clearFilters} className="mt-3">
                {t("employee_gantt.filters.clear")}
              </Button>
            )}
          </div>
        ) : isFilteredEmpty ? (
          <div className="rounded-lg border border-subtle bg-surface-1 px-6 py-10 text-center">
            <p className="text-14 font-medium text-primary">{t(`${filteredEmptyKey}.title`)}</p>
            <p className="mx-auto mt-1 max-w-lg text-13 text-secondary">{t(`${filteredEmptyKey}.description`)}</p>
            <Button variant="secondary" size="sm" onClick={clearFilters} className="mt-3">
              {t("employee_gantt.filters.clear")}
            </Button>
          </div>
        ) : (
          <>
            {/*
              No `flex-1`: the card sizes to its rows and only shrinks (and scrolls) once they
              outgrow the viewport, so a small team does not sit above a large empty panel.
            */}
            <div className="min-h-0 overflow-hidden rounded-lg border border-subtle bg-surface-1">
              <EmployeeGanttChart />
            </div>
            <EmployeeGanttLegend />
          </>
        )}
      </div>
    </EmployeeGanttContext.Provider>
  );
});

/**
 * Employee resource gantt.
 *
 * A standalone, read-only management view of who is working on what across every project. It
 * shares no state, store, route or component with the project gantt in `components/gantt-chart`.
 */
export const EmployeeGanttRoot = observer(function EmployeeGanttRoot(props: Props) {
  const { workspaceSlug } = props;
  const { allowPermissions } = useUserPermissions();

  // the cross-project work item endpoint is admin/member only in practice, and the roll-up is a
  // management view, so guests never see it
  const canViewEmployeeGantt = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  if (!canViewEmployeeGantt) return <NotAuthorizedView />;

  return <EmployeeGanttContent workspaceSlug={workspaceSlug} />;
});
