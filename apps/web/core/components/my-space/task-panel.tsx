/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { CloseOutline } from "@makeplane/propel/icons";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { IState, TIssue } from "@plane/types";
import { cn, renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
// services
import { IssueService } from "@/services/issue/issue.service";

const issueService = new IssueService();

/** Notes are plain text; the task description field stores HTML paragraphs. */
const htmlToText = (html: string | undefined | null) => {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html.replace(/<\/p>\s*<p[^>]*>/g, "\n"), "text/html");
  return (doc.body.textContent ?? "").trim();
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const textToHtml = (text: string) =>
  text.trim()
    ? text
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")
    : "<p></p>";

type Props = {
  workspaceSlug: string;
  projectId: string;
  taskId: string;
  states: IState[];
  onClose: () => void;
  /** Saves a change; the list owns the data and refreshes after. */
  onUpdate: (taskId: string, data: Partial<TIssue>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
};

/**
 * Geotech3D: one My Space task, edited in place beside the list - so My Space
 * never takes the user out of the workspace they are in.
 */
export const MySpaceTaskPanel = observer(function MySpaceTaskPanel(props: Props) {
  const { workspaceSlug, projectId, taskId, states, onClose, onUpdate, onDelete } = props;
  const { t } = useTranslation();
  const { data: task, mutate } = useSWR(`MY_SPACE_TASK_${taskId}`, () =>
    issueService.retrieve(workspaceSlug, projectId, taskId)
  );
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!task) return;
    setName(task.name);
    setNotes(htmlToText(task.description_html));
    setConfirmDelete(false);
  }, [task]);

  const save = async (data: Partial<TIssue>) => {
    await onUpdate(taskId, data);
    void mutate();
  };

  return (
    <aside
      aria-label={t("my_space.panel.label")}
      className="flex h-full w-full flex-col border-l border-subtle bg-surface-1 md:w-[380px] md:flex-shrink-0"
    >
      <div className="flex items-center justify-end border-b border-subtle px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("my_space.panel.close")}
          className="grid size-7 place-items-center rounded-md text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
        >
          <CloseOutline className="size-4" />
        </button>
      </div>

      {!task ? null : (
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed && trimmed !== task.name) void save({ name: trimmed });
              else setName(task.name);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            aria-label={t("my_space.panel.title")}
            className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-16 font-semibold text-primary hover:border-subtle focus:border-accent-strong focus:outline-none"
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-11 font-semibold tracking-wide text-geo-grey uppercase">
              {t("my_space.panel.status")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {states.map((state) => (
                <button
                  key={state.id}
                  type="button"
                  onClick={() => state.id !== task.state_id && void save({ state_id: state.id })}
                  aria-pressed={state.id === task.state_id}
                  className={cn(
                    "rounded-full border px-3 py-1 text-12 font-medium transition-colors",
                    state.id === task.state_id
                      ? "border-accent-strong bg-accent-primary/10 text-primary"
                      : "border-subtle text-secondary hover:bg-layer-transparent-hover"
                  )}
                >
                  {state.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-11 font-semibold tracking-wide text-geo-grey uppercase">
              {t("my_space.panel.due_date")}
            </span>
            <DateDropdown
              value={task.target_date ?? null}
              onChange={(date) => void save({ target_date: renderFormattedPayloadDate(date) ?? null })}
              placeholder={t("home.card.set_due_date")}
              buttonVariant="border-with-text"
              buttonClassName="h-8 text-13"
              isClearable
            />
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-11 font-semibold tracking-wide text-geo-grey uppercase">
              {t("my_space.panel.notes")}
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (notes !== htmlToText(task.description_html)) void save({ description_html: textToHtml(notes) });
              }}
              placeholder={t("my_space.panel.notes_placeholder")}
              aria-label={t("my_space.panel.notes")}
              rows={8}
              className="min-h-40 w-full flex-1 resize-none rounded-md border border-subtle bg-transparent px-3 py-2 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-2.5 py-1 text-12 font-medium text-secondary hover:bg-layer-transparent-hover"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(taskId)}
                  className="rounded-md bg-danger-primary px-2.5 py-1 text-12 font-medium text-on-color hover:opacity-90"
                >
                  {t("my_space.panel.confirm_delete")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-md px-2.5 py-1 text-12 font-medium text-danger-primary hover:bg-layer-transparent-hover"
              >
                {t("my_space.panel.delete")}
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
});
