/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { WhatsNewService } from "@plane/services";
import type { TWhatsNew, TWhatsNewItem } from "@plane/types";
// components
import { WhatsNewCard } from "@/components/whats-new/whats-new-card";
import { TOAST_TYPE, setToast } from "@/providers/toast";
// hooks
import { useUser } from "@/hooks/store";
// local
import { WhatsNewIconPicker } from "./icon-picker";
import { SimpleModal } from "./simple-modal";

const whatsNewService = new WhatsNewService();

const MAX_ITEMS = 8;
const EMPTY_ITEM: TWhatsNewItem = { title: "", text: "", icon: "sparkles" };

type TErrors = { headline?: string; items?: string | Record<string, string>; error?: string };

type Props = {
  note: TWhatsNew | null;
  onDone: () => void;
};

// Geotech3D: write a What's new note, preview it as the team will see it, then send it
export function WhatsNewNoteEditor(props: Props) {
  const { note, onDone } = props;
  const { currentUser } = useUser();
  const isSent = !!note?.sent_at;

  const [headline, setHeadline] = useState(note?.headline ?? "Guess what's new");
  const [items, setItems] = useState<TWhatsNewItem[]>(note?.items.length ? note.items : [{ ...EMPTY_ITEM }]);
  const [errors, setErrors] = useState<TErrors>({});
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const filledItems = items.filter((item) => item.title.trim() || item.text.trim());
  const itemError = (index: number) => (typeof errors.items === "object" ? errors.items[String(index)] : undefined);

  const updateItem = (index: number, change: Partial<TWhatsNewItem>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));

  const save = async (): Promise<TWhatsNew | null> => {
    setErrors({});
    const payload = { headline, items };
    try {
      return note ? await whatsNewService.update(note.id, payload) : await whatsNewService.create(payload);
    } catch (error) {
      setErrors((error as TErrors) ?? { error: "Couldn't save. Try again." });
      return null;
    }
  };

  const handleSave = async () => {
    setBusy("save");
    const saved = await save();
    setBusy(null);
    if (!saved) return;
    setToast({ type: TOAST_TYPE.SUCCESS, title: isSent ? "Changes saved" : "Draft saved" });
    onDone();
  };

  const handleSend = async () => {
    setIsConfirmOpen(false);
    setBusy("send");
    const saved = await save();
    if (!saved) {
      setBusy(null);
      return;
    }
    try {
      await whatsNewService.send(saved.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Sent to everyone",
        message: "Everyone sees it the next time they open the task manager.",
      });
      onDone();
    } catch (error) {
      setErrors((error as TErrors) ?? { error: "Couldn't send. Try again." });
    } finally {
      setBusy(null);
    }
  };

  const generalError = errors.error || (typeof errors.items === "string" ? errors.items : undefined);

  return (
    <div className="flex max-w-2xl flex-col gap-6 px-1">
      <button
        type="button"
        onClick={onDone}
        className="flex w-fit items-center gap-1.5 text-body-xs-medium text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All notes
      </button>

      {isSent && (
        <div className="rounded-md border border-subtle bg-layer-1 px-4 py-3 text-body-xs-regular text-secondary">
          This note was already sent. You can fix it here, but people who already saw it won't see it again.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="whats-new-headline" className="text-body-xs-medium text-secondary">
          Headline
        </label>
        <InputGroup size="lg">
          <Input
            id="whats-new-headline"
            size="lg"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Guess what's new"
            maxLength={120}
            aria-invalid={!!errors.headline}
          />
        </InputGroup>
        {errors.headline && <p className="text-caption-sm-regular text-danger-primary">{errors.headline}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-body-xs-medium text-secondary">What happened</p>
        {items.map((item, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- rows have no ids; they are only added and removed
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <WhatsNewIconPicker value={item.icon} onChange={(icon) => updateItem(index, { icon })} />
              <div className="w-48 shrink-0">
                <InputGroup size="lg">
                  <Input
                    size="lg"
                    value={item.title}
                    onChange={(e) => updateItem(index, { title: e.target.value })}
                    placeholder="Duplicate a Job"
                    maxLength={80}
                    aria-label="Title"
                    aria-invalid={!!itemError(index)}
                  />
                </InputGroup>
              </div>
              <div className="min-w-0 flex-1">
                <InputGroup size="lg">
                  <Input
                    size="lg"
                    value={item.text}
                    onChange={(e) => updateItem(index, { text: e.target.value })}
                    placeholder="Same tasks, fresh start. Find it in the Job's menu."
                    maxLength={240}
                    aria-label="Text"
                  />
                </InputGroup>
              </div>
              <button
                type="button"
                aria-label="Remove this item"
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                disabled={items.length === 1}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-1-hover hover:text-danger-primary disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            {itemError(index) && (
              <p className="pl-11 text-caption-sm-regular text-danger-primary">{itemError(index)}</p>
            )}
          </div>
        ))}
        {items.length < MAX_ITEMS && (
          <button
            type="button"
            onClick={() => setItems((current) => [...current, { ...EMPTY_ITEM }])}
            className="flex w-fit items-center gap-1.5 py-1 text-body-xs-medium text-accent-primary hover:text-accent-secondary"
          >
            <Plus className="size-3.5" aria-hidden />
            Add another
          </button>
        )}
      </div>

      {generalError && <p className="text-body-xs-regular text-danger-primary">{generalError}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-4">
        <Button
          variant="secondary"
          size="lg"
          stretch="auto"
          label="Preview"
          onClick={() => setIsPreviewOpen(true)}
          disabled={!filledItems.length}
        />
        <Button
          variant={isSent ? "primary" : "secondary"}
          size="lg"
          stretch="auto"
          label={isSent ? "Save changes" : "Save draft"}
          onClick={handleSave}
          loading={busy === "save"}
          disabled={busy !== null && busy !== "save"}
        />
        {!isSent && (
          <Button
            variant="primary"
            size="lg"
            stretch="auto"
            label="Send to everyone"
            onClick={() => setIsConfirmOpen(true)}
            loading={busy === "send"}
            disabled={!filledItems.length || (busy !== null && busy !== "send")}
          />
        )}
      </div>

      <SimpleModal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} className="max-w-md">
        <WhatsNewCard
          hello={`Hey ${currentUser?.first_name || currentUser?.display_name || "there"}`}
          headline={headline.trim() || "Guess what's new"}
          items={filledItems}
          buttonLabel="Nice, got it"
          onDismiss={() => setIsPreviewOpen(false)}
        />
      </SimpleModal>

      <SimpleModal isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)} className="max-w-md">
        <div className="p-6">
          <h3 className="text-h6-medium text-primary">Send to everyone?</h3>
          <p className="mt-2 text-body-sm-regular text-secondary">
            Everyone sees it once, the next time they open the task manager. You can't unsend it.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="secondary"
              size="lg"
              stretch="auto"
              label="Not yet"
              onClick={() => setIsConfirmOpen(false)}
            />
            <Button variant="primary" size="lg" stretch="auto" label="Send" onClick={handleSend} />
          </div>
        </div>
      </SimpleModal>
    </div>
  );
}
