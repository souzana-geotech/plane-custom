/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
// plane imports
import { Field } from "@makeplane/propel/components/field";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IModule } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// components
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
// hooks
import { useModule } from "@/hooks/store/use-module";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { ModuleService } from "@/services/module.service";

const moduleService = new ModuleService();

// Copied tasks have not started yet, so they can only start in a not-yet-started state
const STARTING_STATE_GROUPS = new Set(["backlog", "unstarted"]);

type Props = {
  isOpen: boolean;
  onClose: () => void;
  moduleDetails: IModule;
  workspaceSlug: string;
  projectId: string;
};

type TFormValues = {
  name: string;
  module_code: string;
  task_state_id: string | null;
};

type TDuplicateError = { error?: string; name?: string[]; module_code?: string[] | string };

/**
 * Geotech3D: duplicate a Job that repeats. The new Job gets the same tasks (titles,
 * descriptions, task tree and order) and nothing that belongs to one run of it:
 * no dates, assignees, labels or priority. Every task starts in the chosen state.
 */
export const DuplicateModuleModal = observer(function DuplicateModuleModal(props: Props) {
  const { isOpen, onClose, moduleDetails, workspaceSlug, projectId } = props;
  // router
  const router = useAppRouter();
  // translation
  const { t } = useTranslation();
  // store hooks
  const { fetchModules } = useModule();
  const { fetchProjectStates, getProjectStates } = useProjectState();
  // states
  const [isSubmitting, setIsSubmitting] = useState(false);
  // derived values
  const projectStates = getProjectStates(projectId);
  const startingStates = useMemo(
    () => (projectStates ?? []).filter((state) => STARTING_STATE_GROUPS.has(state.group)),
    [projectStates]
  );
  const defaultStateId = (startingStates.find((state) => state.default) ?? startingStates[0])?.id ?? null;
  // form
  const {
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<TFormValues>({
    defaultValues: { name: "", module_code: "", task_state_id: null },
  });

  // start from a fresh form every time the modal opens
  useEffect(() => {
    if (!isOpen) return;
    reset({
      name: t("module.duplicate.default_name", { name: moduleDetails.name }),
      module_code: "",
      task_state_id: defaultStateId,
    });
    if (!projectStates) void fetchProjectStates(workspaceSlug, projectId);
    // only on open: reset must not wipe what the user typed when states load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // states can arrive after the modal opened
  useEffect(() => {
    if (isOpen && !getValues("task_state_id") && defaultStateId) setValue("task_state_id", defaultStateId);
  }, [isOpen, defaultStateId, getValues, setValue]);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const onSubmit = async (values: TFormValues) => {
    setIsSubmitting(true);
    try {
      const response = await moduleService.duplicateModule(workspaceSlug, projectId, moduleDetails.id, {
        name: values.name.trim(),
        module_code: values.module_code.trim(),
        task_state_id: values.task_state_id,
      });
      await fetchModules(workspaceSlug, projectId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("module.duplicate.success_title"),
        message: t("module.duplicate.success_message", { count: response.task_count }),
      });
      setIsSubmitting(false);
      onClose();
      router.push(`/${workspaceSlug}/projects/${projectId}/modules/${response.id}`);
    } catch (error) {
      setIsSubmitting(false);
      const data = (error ?? {}) as TDuplicateError;
      if (data.module_code) {
        setError("module_code", { message: t("module.duplicate.code_taken") });
        return;
      }
      if (data.name || (typeof data.error === "string" && data.error.toLowerCase().includes("name"))) {
        setError("name", { message: t("module.duplicate.name_taken") });
        return;
      }
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("module.duplicate.error"),
      });
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.XL}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-5">
        <div className="space-y-1">
          <h3 className="text-18 font-medium text-secondary">
            {t("module.duplicate.title", { name: moduleDetails.name })}
          </h3>
          <p className="text-13 text-tertiary">{t("module.duplicate.description")}</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Controller
              control={control}
              name="name"
              rules={{
                validate: (value) => value.trim().length > 0 || t("title_is_required"),
                maxLength: { value: 255, message: t("title_should_be_less_than_255_characters") },
              }}
              render={({ field: { value, onChange } }) => (
                <Field name="name" invalid={Boolean(errors?.name)}>
                  <InputGroup size="lg">
                    <Input
                      size="lg"
                      id="duplicate_module_name"
                      name="name"
                      type="text"
                      value={value}
                      onChange={onChange}
                      placeholder={t("title")}
                      // oxlint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                    />
                  </InputGroup>
                </Field>
              )}
            />
            <span className="text-11 text-danger-primary">{errors?.name?.message}</span>
          </div>
          <div className="space-y-1">
            <Controller
              control={control}
              name="module_code"
              rules={{ maxLength: { value: 50, message: t("module.code.max_length") } }}
              render={({ field: { value, onChange } }) => (
                <Field name="module_code" invalid={Boolean(errors?.module_code)}>
                  <InputGroup size="lg">
                    <Input
                      size="lg"
                      id="duplicate_module_code"
                      name="module_code"
                      type="text"
                      value={value}
                      onChange={onChange}
                      placeholder={t("module.code.placeholder")}
                    />
                  </InputGroup>
                </Field>
              )}
            />
            <span className="text-11 text-danger-primary">{errors?.module_code?.message}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-13 text-secondary">{t("module.duplicate.task_state")}</span>
            <Controller
              control={control}
              name="task_state_id"
              render={({ field: { value, onChange } }) => (
                <div className="h-7">
                  <StateDropdown
                    projectId={projectId}
                    stateIds={startingStates.map((state) => state.id)}
                    value={value}
                    onChange={onChange}
                    buttonVariant="border-with-text"
                    showDefaultState={false}
                  />
                </div>
              )}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-subtle pt-5">
          <Button variant="secondary" size="lg" onClick={handleClose} disabled={isSubmitting}>
            {t("cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
            {isSubmitting ? t("module.duplicate.submitting") : t("module.duplicate.submit")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
