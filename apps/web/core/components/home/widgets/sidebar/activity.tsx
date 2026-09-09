/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ArrowNarrowRightOutline } from "@makeplane/propel/icons";
import type { IIssueActivity } from "@plane/types";
import { Loader } from "@plane/ui";
import { calculateTimeAgoShort, renderFormattedDateWithoutYear } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser } from "@/hooks/store/user";
// services
import { UserService } from "@/services/user.service";
// local imports
import { SectionLabel } from "../my-work/section";

const userService = new UserService();
const MAX_ITEMS = 8;

/**
 * Turns a raw activity record into one plain-language event. Only the fields the backend actually
 * logs are mapped; anything else falls back to "updated" rather than inventing detail.
 */
const useActivityMessage = () => {
  const { t } = useTranslation();
  const { getStateById } = useProjectState();

  return (activity: IIssueActivity): string => {
    const { field, verb, new_value: newValue, new_identifier: newIdentifier } = activity;
    if (activity.issue_comment || field === "comment") return t("home.activity.commented");
    if (!field || field === "issue")
      return verb === "created" ? t("home.activity.created") : t("home.activity.updated");
    switch (field) {
      case "state": {
        const group = newIdentifier ? getStateById(newIdentifier)?.group : undefined;
        if (group === "completed") return t("home.activity.completed");
        return t("home.activity.state", { state: newValue ?? "" });
      }
      case "target_date":
        return newValue
          ? t("home.activity.due_date", { date: renderFormattedDateWithoutYear(newValue) })
          : t("home.activity.due_date_removed");
      case "priority":
        return t("home.activity.priority", { priority: newValue ?? "" });
      case "assignees":
        return t("home.activity.assignees");
      case "labels":
        return t("home.activity.labels");
      case "name":
        return t("home.activity.renamed");
      case "description":
        return t("home.activity.description");
      default:
        return t("home.activity.updated");
    }
  };
};

/**
 * The user's own recent actions, from the same activity feed the profile page uses. Secondary
 * context only: a flat list that reads "task → what happened → when", nothing to click except the task.
 */
export const ActivityPanel = observer(function ActivityPanel({ workspaceSlug }: { workspaceSlug: string }) {
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  const { setPeekIssue } = useIssueDetail();
  const toMessage = useActivityMessage();

  const { data, isLoading, error } = useSWR(
    workspaceSlug && currentUser ? `HOME_USER_ACTIVITY_${workspaceSlug}_${currentUser.id}` : null,
    workspaceSlug && currentUser
      ? () => userService.getUserProfileActivity(workspaceSlug, currentUser.id, { per_page: MAX_ITEMS })
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  const activities = (data?.results ?? []).filter((activity) => activity.issue_detail?.name).slice(0, MAX_ITEMS);
  const activityHref = currentUser ? `/${workspaceSlug}/profile/${currentUser.id}/activity` : undefined;

  return (
    <section aria-labelledby="my-work-activity" className="flex flex-col gap-3">
      <SectionLabel>
        <span id="my-work-activity">{t("home.activity.title")}</span>
      </SectionLabel>

      {isLoading ? (
        <Loader className="flex flex-col gap-3">
          {["a", "b", "c", "d"].map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Loader.Item height="12px" width="70%" />
              <Loader.Item height="10px" width="40%" />
            </div>
          ))}
        </Loader>
      ) : error ? (
        <p className="text-12 text-geo-grey">{t("home.activity.error")}</p>
      ) : activities.length === 0 ? (
        <p className="text-12 text-geo-grey">{t("home.activity.empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {activities.map((activity) => (
            <li
              key={activity.id}
              className="flex items-start gap-3 border-b border-subtle py-2.5 first:pt-0 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!activity.issue || !activity.project) return;
                    setPeekIssue({ workspaceSlug, projectId: activity.project, issueId: activity.issue });
                  }}
                  className="truncate text-left text-13 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
                >
                  {activity.issue_detail?.name}
                </button>
                <span className="truncate text-12 text-secondary">{toMessage(activity)}</span>
              </div>
              <time
                dateTime={String(activity.created_at)}
                className="flex-shrink-0 pt-0.5 text-11 text-geo-grey tabular-nums"
              >
                {calculateTimeAgoShort(activity.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}

      {activityHref && (
        <Link
          href={activityHref}
          className="flex items-center gap-1 self-start text-12 font-medium text-secondary transition-colors hover:text-primary"
        >
          {t("home.recents.view_all")}
          <ArrowNarrowRightOutline className="size-3.5" />
        </Link>
      )}
    </section>
  );
});
