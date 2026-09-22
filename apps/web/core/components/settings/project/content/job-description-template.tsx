/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { TextArea } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";

// The Job description is a plain textarea, so a template is plain text. The cap
// keeps it from bloating the workspace-wide project list payload, which carries
// this field for every container.
const MAX_TEMPLATE_LENGTH = 2000;

const PLACEHOLDER = `SCOPE OF WORK
-------------


SITE / LOCATION
---------------


DELIVERABLES
------------
`;

type Props = {
  disabled?: boolean;
  projectId: string;
  workspaceSlug: string;
};

/**
 * Geotech3D: the starting text every new Job in this container gets in its
 * description field. It is a starting point, never a rule - whoever creates the
 * Job can edit or clear it, and saving a new template never touches a Job that
 * already exists.
 */
export const JobDescriptionTemplateSetting = observer(function JobDescriptionTemplateSetting(props: Props) {
  const { disabled = false, projectId, workspaceSlug } = props;
  // store hooks
  const { getProjectById, updateProject } = useProject();
  // derived values
  const savedTemplate = getProjectById(projectId)?.job_description_template ?? "";
  // local state
  const [template, setTemplate] = useState(savedTemplate);
  const [isSaving, setIsSaving] = useState(false);

  // Follow the stored value: on first load, when the settings page switches
  // container, and after a save lands. An in-progress edit is left alone -
  // `savedTemplate` does not change while the user types.
  useEffect(() => {
    setTemplate(savedTemplate);
  }, [savedTemplate]);

  const isDirty = template !== savedTemplate;

  const handleSave = async () => {
    if (!workspaceSlug || !projectId || isSaving) return;

    setIsSaving(true);
    try {
      await updateProject(workspaceSlug, projectId, { job_description_template: template });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success!",
        message: "Job description template saved.",
      });
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: "Something went wrong while saving the template. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-subtle bg-layer-2 px-4 py-3">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-body-sm-medium text-primary">Job description template</h4>
        <p className="text-caption-md-regular text-tertiary">
          Every new Job in this container starts with this text in its description. Plain text only - whoever creates
          the Job can change or delete it, and existing Jobs are never touched.
        </p>
      </div>
      <TextArea
        id="job_description_template"
        name="job_description_template"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        placeholder={PLACEHOLDER}
        maxLength={MAX_TEMPLATE_LENGTH}
        className="font-mono min-h-40 w-full resize-y text-13"
        disabled={disabled}
        aria-label="Job description template"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption-md-regular text-tertiary">
          {template.length}/{MAX_TEMPLATE_LENGTH}
        </span>
        <Button variant="primary" size="sm" onClick={handleSave} loading={isSaving} disabled={disabled || !isDirty}>
          {isSaving ? "Saving" : "Save template"}
        </Button>
      </div>
    </div>
  );
});
