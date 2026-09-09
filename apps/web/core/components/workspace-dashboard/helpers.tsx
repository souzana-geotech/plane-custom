/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { useTranslation } from "@plane/i18n";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import { EPillSize, EPillVariant, Pill } from "@plane/propel/pill";
import { Loader } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
// local imports
import type { TDashboardSeverity, TJobHealth, TWorkspaceDashboardWidgetKey } from "./data/types";

/** DOM id of a widget section so exceptions and KPIs can scroll to it. */
export const getWidgetDomId = (key: TWorkspaceDashboardWidgetKey): string => `workspace-dashboard-${key}`;

export const scrollToWidget = (key: TWorkspaceDashboardWidgetKey) => {
  document.getElementById(getWidgetDomId(key))?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export const SEVERITY_STYLES: Record<TDashboardSeverity, { text: string; dot: string; surface: string }> = {
  critical: {
    text: "text-danger-primary",
    dot: "bg-danger-primary",
    surface: "bg-danger-subtle",
  },
  warning: {
    text: "text-warning-primary",
    dot: "bg-warning-primary",
    surface: "bg-warning-subtle",
  },
  info: {
    text: "text-accent-primary",
    dot: "bg-accent-primary",
    surface: "bg-accent-primary/10",
  },
  success: {
    text: "text-success-primary",
    dot: "bg-success-primary",
    surface: "bg-success-subtle",
  },
};

export const JOB_HEALTH_SEVERITY: Record<TJobHealth, TDashboardSeverity> = {
  delayed: "critical",
  blocked: "critical",
  at_risk: "warning",
  on_track: "success",
};

const JOB_HEALTH_PILL_VARIANT: Record<TJobHealth, EPillVariant> = {
  delayed: EPillVariant.ERROR,
  blocked: EPillVariant.ERROR,
  at_risk: EPillVariant.WARNING,
  on_track: EPillVariant.SUCCESS,
};

export function JobHealthPill({ health, className }: { health: TJobHealth; className?: string }) {
  const { t } = useTranslation();
  return (
    <Pill variant={JOB_HEALTH_PILL_VARIANT[health]} size={EPillSize.SM} className={className}>
      {t(`workspace_dashboard.job_health.${health}`)}
    </Pill>
  );
}

/** Avatar + display name for a workspace member; falls back to the id when the member is unknown. */
export const MemberChip = observer(function MemberChip(props: { userId: string; className?: string }) {
  const { userId, className } = props;
  const { getUserDetails } = useMember();
  const member = getUserDetails(userId);
  const name = member?.display_name ?? userId;
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar alt={name} fallback={name[0]?.toUpperCase()} src={getFileURL(member?.avatar_url ?? "")} size="sm" />
      <span className="truncate text-13 text-primary">{name}</span>
    </span>
  );
});

/** Thin proportional bar used by workload and pipeline widgets. */
export function ShareBar({
  value,
  max,
  className,
  color,
}: {
  value: number;
  max: number;
  className?: string;
  color?: string;
}) {
  const width = max > 0 ? Math.max(Math.round((value / max) * 100), value > 0 ? 4 : 0) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-layer-1", className)} aria-hidden="true">
      <div
        className={cn("h-full rounded-full", !color && "bg-accent-primary")}
        style={{
          width: `${width}%`,
          ...(color ? { backgroundColor: color } : {}),
        }}
      />
    </div>
  );
}

export function WidgetTable({ children, className }: { children: React.ReactNode; className?: string }) {
  // -mx-2 cancels the cells' px-2 so first/last column text aligns with the card title
  return (
    <div className={cn("-mx-2 overflow-x-auto", className)}>
      <table className="w-full min-w-[480px] border-separate border-spacing-0 text-13">{children}</table>
    </div>
  );
}

export function WidgetTableHeadCell({
  children,
  align = "left",
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-subtle px-2 pb-2 text-11 font-medium tracking-wide text-tertiary uppercase",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function WidgetTableCell({
  children,
  align = "left",
  className,
  emphasis,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  /** colours a numeric cell when its value is above zero */
  emphasis?: TDashboardSeverity;
}) {
  return (
    <td
      className={cn(
        "border-b border-subtle px-2 py-2 align-middle text-13 text-secondary",
        align === "right" ? "text-right tabular-nums" : "text-left",
        emphasis && SEVERITY_STYLES[emphasis].text,
        emphasis && "font-medium",
        className
      )}
    >
      {children}
    </td>
  );
}

const LOADER_ROW_KEYS = ["a", "b", "c", "d", "e", "f"];

export function WidgetLoader({ rows = 4 }: { rows?: number }) {
  return (
    <Loader className="flex flex-col gap-3">
      {LOADER_ROW_KEYS.slice(0, rows).map((key) => (
        <Loader.Item key={key} height="32px" width="100%" />
      ))}
    </Loader>
  );
}

export function WidgetEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <EmptyStateCompact
      assetKey="unknown"
      assetClassName="size-16"
      rootClassName="border border-subtle px-5 py-8"
      title={title}
      description={description}
    />
  );
}
