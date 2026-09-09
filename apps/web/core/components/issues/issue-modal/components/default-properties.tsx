/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import type { Control, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import { ETabIndices, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { ChevronDownOutline, ParentOutline } from "@makeplane/propel/icons";
// types
import type { ISearchIssueResponse, TIssue } from "@plane/types";
// ui
import { CustomMenu } from "@plane/ui";
import { cn, getDate, getTabIndex } from "@plane/utils";
// components
import { CycleDropdown } from "@/components/dropdowns/cycle";
import { DateDropdown } from "@/components/dropdowns/date";
import { EstimateDropdown } from "@/components/dropdowns/estimate";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { ParentIssuesListModal } from "@/components/issues/parent-issues-list-modal";
import { IssueLabelSelect } from "@/components/issues/select";
import { WorkingDaysInput } from "@/components/issues/working-days-input";
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
// hooks
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
import type { TWorkItemDatesUpdate } from "@/hooks/use-work-item-working-days";
import { useWorkItemWorkingDays } from "@/hooks/use-work-item-working-days";

type TIssueDefaultPropertiesProps = {
  control: Control<TIssue>;
  setValue: UseFormSetValue<TIssue>;
  id: string | undefined;
  projectId: string | null;
  workspaceSlug: string;
  selectedParentIssue: ISearchIssueResponse | null;
  startDate: string | null;
  targetDate: string | null;
  parentId: string | null;
  isDraft: boolean;
  handleFormChange: () => void;
  setSelectedParentIssue: (issue: ISearchIssueResponse) => void;
};

/**
 * A primary property. The caption names the field and the control below it always reads as a
 * value — "Backlog", "Unassigned", "No due date". Without the caption these controls are
 * ambiguous: some would show a value and some a field name, so nothing tells you which are set.
 */
function PropertyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="px-0.5 text-caption-sm-regular text-placeholder">{label}</span>
      <div className="h-7">{children}</div>
    </div>
  );
}

export const IssueDefaultProperties = observer(function IssueDefaultProperties(props: TIssueDefaultPropertiesProps) {
  const {
    control,
    setValue,
    id,
    projectId,
    workspaceSlug,
    selectedParentIssue,
    startDate,
    targetDate,
    parentId,
    isDraft,
    handleFormChange,
    setSelectedParentIssue,
  } = props;
  // states
  const [parentIssueListModalOpen, setParentIssueListModalOpen] = useState(false);
  const [areMoreOptionsVisible, setAreMoreOptionsVisible] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const { areEstimateEnabledByProjectId } = useProjectEstimates();
  const { getProjectById } = useProject();
  const { isMobile } = usePlatformOS();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const projectDetails = getProjectById(projectId);

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  const canCreateLabel =
    projectId && allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);

  const handleDatesChange = useCallback(
    (update: TWorkItemDatesUpdate) => {
      if (update.start_date !== undefined) setValue("start_date", update.start_date, { shouldDirty: true });
      if (update.target_date !== undefined) setValue("target_date", update.target_date, { shouldDirty: true });
      handleFormChange();
    },
    [setValue, handleFormChange]
  );

  const { workingDays, isDurationDriven, handleStartDateChange, handleTargetDateChange, handleWorkingDaysChange } =
    useWorkItemWorkingDays({ startDate, targetDate, onDatesChange: handleDatesChange, resetKey: id });

  // the secondary properties stay collapsed so a routine task is title + save, but they must never
  // hide data that is already there — editing a work item or applying a template fills these in
  const watchedLabelIds = useWatch({ control, name: "label_ids" });
  const watchedCycleId = useWatch({ control, name: "cycle_id" });
  const watchedModuleIds = useWatch({ control, name: "module_ids" });
  const watchedEstimatePoint = useWatch({ control, name: "estimate_point" });

  const hasSecondaryValues = Boolean(
    watchedLabelIds?.length ||
    watchedCycleId ||
    watchedModuleIds?.length ||
    watchedEstimatePoint ||
    parentId ||
    startDate
  );

  useEffect(() => {
    if (hasSecondaryValues) setAreMoreOptionsVisible(true);
  }, [hasSecondaryValues]);

  const minDate = getDate(startDate);
  minDate?.setDate(minDate.getDate());

  const maxDate = getDate(targetDate);
  maxDate?.setDate(maxDate.getDate());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <PropertyField label={t("state")}>
          <Controller
            control={control}
            name="state_id"
            render={({ field: { value, onChange } }) => (
              <StateDropdown
                value={value}
                onChange={(stateId) => {
                  onChange(stateId);
                  handleFormChange();
                }}
                projectId={projectId ?? undefined}
                buttonVariant="border-with-text"
                tabIndex={getIndex("state_id")}
                isForWorkItemCreation={!id}
              />
            )}
          />
        </PropertyField>
        <PropertyField label={t("priority")}>
          <Controller
            control={control}
            name="priority"
            render={({ field: { value, onChange } }) => (
              <PriorityDropdown
                value={value}
                onChange={(priority) => {
                  onChange(priority);
                  handleFormChange();
                }}
                buttonVariant="border-with-text"
                tabIndex={getIndex("priority")}
              />
            )}
          />
        </PropertyField>
        <PropertyField label={t("assignees")}>
          <Controller
            control={control}
            name="assignee_ids"
            render={({ field: { value, onChange } }) => (
              <MemberDropdown
                projectId={projectId ?? undefined}
                value={value}
                onChange={(assigneeIds) => {
                  onChange(assigneeIds);
                  handleFormChange();
                }}
                buttonVariant="border-with-text"
                placeholder={t("unassigned")}
                multiple
                tabIndex={getIndex("assignee_ids")}
              />
            )}
          />
        </PropertyField>
        <PropertyField label={t("due_date")}>
          <Controller
            control={control}
            name="target_date"
            render={({ field: { value } }) => (
              <DateDropdown
                value={value}
                onChange={handleTargetDateChange}
                buttonVariant="border-with-text"
                minDate={minDate ?? undefined}
                placeholder={t("issue.form.no_due_date")}
                tabIndex={getIndex("target_date")}
              />
            )}
          />
        </PropertyField>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAreMoreOptionsVisible((prev) => !prev)}
          aria-expanded={areMoreOptionsVisible}
          className="-mx-1 flex items-center gap-1 rounded-sm px-1 py-1 text-caption-sm-regular text-placeholder transition-colors hover:text-secondary"
        >
          <ChevronDownOutline
            className={cn("h-3 w-3 flex-shrink-0 transition-transform", areMoreOptionsVisible && "rotate-180")}
            aria-hidden="true"
          />
          <span>{areMoreOptionsVisible ? t("issue.form.fewer_options") : t("issue.form.more_options")}</span>
        </button>
      </div>

      {areMoreOptionsVisible && (
        <div className="flex flex-wrap items-center gap-2">
          <Controller
            control={control}
            name="label_ids"
            render={({ field: { value, onChange } }) => (
              <div className="h-7">
                <IssueLabelSelect
                  value={value}
                  onChange={(labelIds) => {
                    onChange(labelIds);
                    handleFormChange();
                  }}
                  projectId={projectId ?? undefined}
                  tabIndex={getIndex("label_ids")}
                  createLabelEnabled={!!canCreateLabel}
                />
              </div>
            )}
          />
          <Controller
            control={control}
            name="start_date"
            render={({ field: { value } }) => (
              <div className="h-7">
                <DateDropdown
                  value={value}
                  onChange={handleStartDateChange}
                  buttonVariant="border-with-text"
                  maxDate={isDurationDriven ? undefined : (maxDate ?? undefined)}
                  placeholder={t("start_date")}
                  tabIndex={getIndex("start_date")}
                />
              </div>
            )}
          />
          <div className="h-7 w-[7.5rem]">
            <WorkingDaysInput
              value={workingDays}
              onChange={handleWorkingDaysChange}
              buttonVariant="border-with-text"
              placeholder={t("working_days")}
              tabIndex={getIndex("working_days")}
            />
          </div>
          {projectDetails?.cycle_view && (
            <Controller
              control={control}
              name="cycle_id"
              render={({ field: { value, onChange } }) => (
                <div className="h-7">
                  <CycleDropdown
                    projectId={projectId ?? undefined}
                    onChange={(cycleId) => {
                      onChange(cycleId);
                      handleFormChange();
                    }}
                    placeholder={t("cycle.label", { count: 1 })}
                    value={value}
                    buttonVariant="border-with-text"
                    tabIndex={getIndex("cycle_id")}
                  />
                </div>
              )}
            />
          )}
          {projectDetails?.module_view && workspaceSlug && (
            <Controller
              control={control}
              name="module_ids"
              render={({ field: { value, onChange } }) => (
                <div className="h-7">
                  <ModuleDropdown
                    projectId={projectId ?? undefined}
                    value={value ?? []}
                    onChange={(moduleIds) => {
                      onChange(moduleIds);
                      handleFormChange();
                    }}
                    placeholder={t("modules")}
                    buttonVariant="border-with-text"
                    tabIndex={getIndex("module_ids")}
                    multiple
                    showCount
                  />
                </div>
              )}
            />
          )}
          {projectId && areEstimateEnabledByProjectId(projectId) && (
            <Controller
              control={control}
              name="estimate_point"
              render={({ field: { value, onChange } }) => (
                <div className="h-7">
                  <EstimateDropdown
                    value={value || undefined}
                    onChange={(estimatePoint) => {
                      onChange(estimatePoint);
                      handleFormChange();
                    }}
                    projectId={projectId}
                    buttonVariant="border-with-text"
                    tabIndex={getIndex("estimate_point")}
                    placeholder={t("estimate")}
                  />
                </div>
              )}
            />
          )}
          <div className="h-7">
            {parentId ? (
              <CustomMenu
                customButton={
                  <button
                    type="button"
                    className="flex h-full cursor-pointer items-center justify-between gap-1 rounded-sm border-[0.5px] border-strong px-2 py-0.5 text-caption-sm-regular hover:bg-layer-1"
                  >
                    {selectedParentIssue?.project_id && (
                      <IssueIdentifier
                        projectId={selectedParentIssue.project_id}
                        issueTypeId={selectedParentIssue.type_id}
                        projectIdentifier={selectedParentIssue?.project__identifier}
                        issueSequenceId={selectedParentIssue.sequence_id}
                        size="xs"
                      />
                    )}
                  </button>
                }
                placement="bottom-start"
                className="h-full w-full"
                customButtonClassName="h-full"
                tabIndex={getIndex("parent_id")}
              >
                <>
                  <CustomMenu.MenuItem className="!p-1" onClick={() => setParentIssueListModalOpen(true)}>
                    {t("change_parent_issue")}
                  </CustomMenu.MenuItem>
                  <Controller
                    control={control}
                    name="parent_id"
                    render={({ field: { onChange } }) => (
                      <CustomMenu.MenuItem
                        className="!p-1"
                        onClick={() => {
                          onChange(null);
                          handleFormChange();
                        }}
                      >
                        {t("remove_parent_issue")}
                      </CustomMenu.MenuItem>
                    )}
                  />
                </>
              </CustomMenu>
            ) : (
              <button
                type="button"
                className="flex h-full cursor-pointer items-center justify-between gap-1 rounded-sm border-[0.5px] border-strong px-2 py-0.5 text-caption-sm-regular hover:bg-layer-1"
                onClick={() => setParentIssueListModalOpen(true)}
              >
                <ParentOutline className="h-3 w-3 flex-shrink-0" />
                <span className="whitespace-nowrap">{t("add_parent")}</span>
              </button>
            )}
          </div>
        </div>
      )}

      <Controller
        control={control}
        name="parent_id"
        render={({ field: { onChange } }) => (
          <ParentIssuesListModal
            isOpen={parentIssueListModalOpen}
            handleClose={() => setParentIssueListModalOpen(false)}
            onChange={(issue) => {
              onChange(issue.id);
              handleFormChange();
              setSelectedParentIssue(issue);
            }}
            projectId={projectId ?? undefined}
            issueId={isDraft ? undefined : id}
          />
        )}
      />
    </div>
  );
});
