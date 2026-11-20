/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { PartyPopper, Pencil, Trash2 } from "lucide-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { WhatsNewService } from "@plane/services";
import type { TWhatsNew } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
import { Skeleton } from "@/components/common/skeleton";
import { TOAST_TYPE, setToast } from "@/providers/toast";
// types
import type { Route } from "./+types/page";
// local
import { WhatsNewNoteEditor } from "./note-editor";
import { SimpleModal } from "./simple-modal";

const whatsNewService = new WhatsNewService();

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// Geotech3D: write "what happened with us" notes; everyone sees each one once, in a popup
const WhatsNewPage = observer(function WhatsNewPage(_props: Route.ComponentProps) {
  const { data: notes, isLoading, mutate } = useSWR("INSTANCE_WHATS_NEW", () => whatsNewService.list());
  // undefined = the list; null = a new note; a note = editing it
  const [editing, setEditing] = useState<TWhatsNew | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<TWhatsNew | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDone = () => {
    setEditing(undefined);
    void mutate();
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await whatsNewService.remove(toDelete.id);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Note deleted" });
      setToDelete(null);
      void mutate();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't delete the note", message: "Try again." });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PageWrapper
      header={{
        title: "What's new",
        description:
          "Tell everyone what happened with us. Each person sees a note once, the next time they open the task manager.",
        actions:
          editing === undefined ? (
            <Button variant="primary" size="lg" stretch="auto" label="New note" onClick={() => setEditing(null)} />
          ) : undefined,
      }}
    >
      {editing !== undefined ? (
        <WhatsNewNoteEditor key={editing?.id ?? "new"} note={editing} onDone={handleDone} />
      ) : isLoading ? (
        <Skeleton className="space-y-3">
          <Skeleton.Item height="56px" width="100%" />
          <Skeleton.Item height="56px" width="100%" />
        </Skeleton>
      ) : !notes?.length ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-accent-subtle">
            <PartyPopper className="size-6 text-accent-primary" aria-hidden />
          </div>
          <p className="text-body-sm-medium text-primary">Write your first note</p>
          <p className="max-w-sm text-body-xs-regular text-secondary">
            List what's new this week. When you send it, everyone sees it once in a popup.
          </p>
          <Button variant="secondary" size="lg" stretch="auto" label="New note" onClick={() => setEditing(null)} />
        </div>
      ) : (
        <div className="rounded-md border border-subtle">
          {notes.map((note, index) => (
            <div
              key={note.id}
              className={cn("flex items-center gap-4 px-4 py-3", index > 0 && "border-t border-subtle")}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm-medium text-primary">{note.headline}</p>
                <p className="truncate text-body-xs-regular text-tertiary">
                  {note.items.length ? note.items.map((item) => item.title).join(" · ") : "No items yet"}
                </p>
              </div>
              {note.sent_at ? (
                <span className="shrink-0 rounded-sm bg-success-subtle px-2 py-0.5 text-caption-sm-medium text-success-primary">
                  Sent {formatDate(note.sent_at)}
                </span>
              ) : (
                <span className="shrink-0 rounded-sm bg-layer-1 px-2 py-0.5 text-caption-sm-medium text-secondary">
                  Draft
                </span>
              )}
              <button
                type="button"
                aria-label="Edit this note"
                onClick={() => setEditing(note)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-1-hover hover:text-primary"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Delete this note"
                onClick={() => setToDelete(note)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      <SimpleModal isOpen={!!toDelete} onClose={() => setToDelete(null)} className="max-w-md">
        <div className="p-6">
          <h3 className="text-h6-medium text-primary">Delete this note?</h3>
          <p className="mt-2 text-body-sm-regular text-secondary">
            {toDelete?.sent_at ? "People who haven't seen it yet won't get it." : "The draft will be gone."}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" size="lg" stretch="auto" label="Keep it" onClick={() => setToDelete(null)} />
            <Button
              variant="danger"
              size="lg"
              stretch="auto"
              label="Delete"
              onClick={handleDelete}
              loading={isDeleting}
            />
          </div>
        </div>
      </SimpleModal>
    </PageWrapper>
  );
});

export const meta: Route.MetaFunction = () => [{ title: "What's New - God Mode" }];

export default WhatsNewPage;
