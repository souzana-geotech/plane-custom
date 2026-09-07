/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { CheckCircle2, ChevronRight } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// local imports
import { useWorkspaceDashboard } from "../data/context";
import { SEVERITY_STYLES, WidgetLoader, getWidgetDomId, scrollToWidget } from "../helpers";
import { WorkspaceDashboardWidgetCard } from "../widget-card";
import type { TWorkspaceDashboardWidgetProps } from "../widget-registry";

export const ManagementExceptionsWidget = observer(function ManagementExceptionsWidget(
  _props: TWorkspaceDashboardWidgetProps
) {
  const { t } = useTranslation();
  const { isLoading, metrics } = useWorkspaceDashboard();
  const { exceptions } = metrics;

  return (
    <WorkspaceDashboardWidgetCard
      id={getWidgetDomId("management_exceptions")}
      title={t("workspace_dashboard.exceptions.title")}
      description={t("workspace_dashboard.exceptions.description")}
      actions={
        !isLoading && exceptions.length > 0 ? (
          <span className="rounded-full bg-layer-1 px-2 py-0.5 text-12 font-medium text-secondary">
            {exceptions.length}
          </span>
        ) : undefined
      }
    >
      {isLoading ? (
        <WidgetLoader rows={3} />
      ) : exceptions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-success-subtle bg-success-subtle px-3 py-2.5 text-13 text-success-primary">
          <CheckCircle2 className="size-4 flex-shrink-0" />
          {t("workspace_dashboard.exceptions.none")}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {exceptions.map((exception) => {
            const styles = SEVERITY_STYLES[exception.severity];
            return (
              <li key={exception.key}>
                <button
                  type="button"
                  onClick={() => scrollToWidget(exception.targetWidget)}
                  className="flex w-full items-center gap-3 rounded-md border border-subtle px-3 py-2 text-left transition-colors hover:bg-layer-transparent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
                >
                  <span className={cn("size-2 flex-shrink-0 rounded-full", styles.dot)} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 font-medium text-primary">
                      {t(`workspace_dashboard.exceptions.${exception.key}`, {
                        count: exception.count,
                      })}
                    </span>
                    <span className={cn("block text-11 tracking-wide uppercase", styles.text)}>
                      {t(`workspace_dashboard.severity.${exception.severity}`)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 flex-shrink-0 text-tertiary" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </WorkspaceDashboardWidgetCard>
  );
});
