/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Geotech3D: a Job's documents (PDF, TXT, Word). A header button with the count
// opens a modal where members upload, open and remove them.
import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";
import useSWR from "swr";
import { FileText, FolderOpen } from "lucide-react";
import { DeleteOutline, DownloadOutline, FileOutline, UploadOutline } from "@makeplane/propel/icons";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalWidth, ModalCore } from "@plane/ui";
import { cn, convertBytesToSize, getFileExtension, getFileURL, renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useFileSize } from "@/hooks/use-file-size";
// services
import type { TModuleDocument } from "@/services/module_attachment.service";
import { ModuleAttachmentService } from "@/services/module_attachment.service";

const moduleAttachmentService = new ModuleAttachmentService();

/** Kept in step with DOCUMENT_TYPES in apps/api/plane/app/views/module/attachment.py */
export const JOB_DOCUMENT_ACCEPT = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  moduleId: string;
};

const swrKey = (moduleId: string) => `JOB_DOCUMENTS_${moduleId}`;

export const useJobDocuments = (workspaceSlug: string, projectId: string, moduleId: string, enabled = true) =>
  useSWR(enabled ? swrKey(moduleId) : null, () => moduleAttachmentService.list(workspaceSlug, projectId, moduleId), {
    revalidateOnFocus: false,
  });

export const JobDocumentsButton = observer(function JobDocumentsButton(props: Props) {
  const { workspaceSlug, projectId, moduleId } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { data: documents } = useJobDocuments(workspaceSlug, projectId, moduleId);
  const count = documents?.length ?? 0;

  return (
    <>
      <Button variant="secondary" size="lg" className="hidden md:flex" onClick={() => setIsOpen(true)}>
        <FileOutline className="size-3.5" />
        <span className="hidden @4xl:flex">{t("job_documents.title")}</span>
        {count > 0 && (
          <span className="rounded-sm bg-layer-3 px-1.5 text-11 font-medium text-secondary tabular-nums">{count}</span>
        )}
      </Button>
      <JobDocumentsModal {...props} isOpen={isOpen} handleClose={() => setIsOpen(false)} />
    </>
  );
});

type ModalProps = Props & { isOpen: boolean; handleClose: () => void };

// A Job document can be at most 5 MB, even when the instance allows bigger uploads
const JOB_DOCUMENT_MAX_SIZE = 5 * 1024 * 1024;

// Same little dots as the What's new popup header: [position, size, color]
const HEADER_DOTS: [string, string, string][] = [
  ["top-4 left-8", "size-2", "bg-warning-primary"],
  ["top-10 left-16", "size-1.5", "bg-accent-primary"],
  ["top-5 right-11", "size-2", "bg-success-primary"],
  ["top-14 right-20", "size-1.5", "bg-accent-primary"],
];

// One tint per kind of document, like the What's new item tiles
const DOCUMENT_TINTS: Record<string, string> = {
  pdf: "bg-warning-subtle text-warning-primary",
  doc: "bg-accent-subtle text-accent-primary",
  docx: "bg-accent-subtle text-accent-primary",
  txt: "bg-geo-grey-subtle text-geo-grey",
};

function DocumentIcon({ name }: { name: string }) {
  const extension = getFileExtension(name).toLowerCase();
  return (
    <span
      className={cn(
        "relative flex size-9 flex-shrink-0 items-center justify-center rounded-lg",
        DOCUMENT_TINTS[extension] ?? DOCUMENT_TINTS.txt
      )}
    >
      <FileText className="size-[18px]" aria-hidden />
      <span className="absolute -bottom-1 rounded-sm bg-surface-1 px-1 text-[9px] leading-3 font-medium uppercase">
        {extension || "?"}
      </span>
    </span>
  );
}

export const JobDocumentsModal = observer(function JobDocumentsModal(props: ModalProps) {
  const { workspaceSlug, projectId, moduleId, isOpen, handleClose } = props;
  const { t } = useTranslation();
  const { maxFileSize: instanceMaxFileSize } = useFileSize();
  const maxFileSize = Math.min(JOB_DOCUMENT_MAX_SIZE, instanceMaxFileSize);
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { getUserDetails } = useMember();
  const { data: documents, isLoading, mutate } = useJobDocuments(workspaceSlug, projectId, moduleId);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [toDelete, setToDelete] = useState<TModuleDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const canDelete = (doc: TModuleDocument) => isAdmin || doc.created_by === currentUser?.id;

  const onDrop = useCallback(
    async (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const tooBig = rejected.some((r) => r.errors.some((e) => e.code === "file-too-large"));
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("error"),
          message: tooBig
            ? t("attachment.file_size_limit", { size: maxFileSize / 1024 / 1024 })
            : t("job_documents.only_types"),
        });
      }
      if (accepted.length === 0) return;
      setUploadingNames((names) => [...names, ...accepted.map((file) => file.name)]);
      await Promise.all(
        accepted.map(async (file) => {
          try {
            await moduleAttachmentService.upload(workspaceSlug, projectId, moduleId, file);
          } catch (error) {
            const message = (error as { error?: string } | undefined)?.error;
            setToast({
              type: TOAST_TYPE.ERROR,
              title: t("error"),
              message: message ?? t("job_documents.upload_failed", { name: file.name }),
            });
          } finally {
            setUploadingNames((names) => names.filter((name) => name !== file.name));
          }
        })
      );
      await mutate();
    },
    [workspaceSlug, projectId, moduleId, maxFileSize, mutate, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: JOB_DOCUMENT_ACCEPT,
    maxSize: maxFileSize,
  });

  const handleDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await moduleAttachmentService.remove(workspaceSlug, projectId, moduleId, toDelete.id);
      await mutate((docs) => docs?.filter((doc) => doc.id !== toDelete.id), { revalidate: false });
      setToDelete(null);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("error"), message: t("job_documents.delete_failed") });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} width={EModalWidth.XL}>
      <div className="w-full overflow-hidden rounded-xl bg-surface-1">
        {/* Header in the same look as the What's new popup */}
        <div className="relative bg-accent-subtle px-6 pt-6 pb-5 text-center">
          {HEADER_DOTS.map(([position, size, color]) => (
            <span key={position} aria-hidden className={cn("absolute rounded-full", position, size, color)} />
          ))}
          <div className="relative mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-surface-1">
            <FolderOpen className="size-6 text-accent-primary" aria-hidden />
          </div>
          <h3 className="relative text-h5-medium text-primary">{t("job_documents.title")}</h3>
          <p className="relative mt-1 text-body-xs-regular text-secondary">{t("job_documents.description")}</p>
        </div>

        <div className="flex flex-col gap-4 px-6 pt-5">
          <div
            {...getRootProps()}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-strong px-4 py-4 transition-colors hover:bg-layer-1",
              { "border-accent-strong bg-accent-subtle": isDragActive }
            )}
          >
            <input {...getInputProps()} />
            <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-primary">
              <UploadOutline className="size-[18px]" />
            </span>
            <div className="min-w-0 text-left">
              <p className="text-body-sm-medium text-primary">{t("job_documents.drop")}</p>
              <p className="mt-0.5 text-body-xs-regular text-secondary">
                {t("job_documents.types_hint", { size: maxFileSize / 1024 / 1024 })}
              </p>
            </div>
          </div>

          <ul className="vertical-scrollbar scrollbar-sm flex max-h-80 flex-col overflow-y-auto">
            {uploadingNames.map((name) => (
              <li key={`uploading-${name}`} className="flex items-center gap-3 py-3">
                <DocumentIcon name={name} />
                <span className="min-w-0 flex-1 truncate text-body-sm-medium text-tertiary">{name}</span>
                <span className="flex-shrink-0 text-body-xs-regular text-tertiary">{t("job_documents.uploading")}</span>
              </li>
            ))}
            {isLoading && !documents ? (
              <li className="py-3 text-body-xs-regular text-tertiary">{t("loading")}</li>
            ) : documents && documents.length > 0 ? (
              documents.map((doc, index) => {
                const uploader = getUserDetails(doc.created_by)?.display_name;
                const url = getFileURL(doc.asset_url);
                const rowClass = cn("flex items-center gap-3 py-3", {
                  "border-t border-subtle": index > 0 || uploadingNames.length > 0,
                });
                // Confirming inline: a second dialog on top of this one closes both.
                if (toDelete?.id === doc.id)
                  return (
                    <li key={doc.id} className={rowClass}>
                      <span
                        className="min-w-0 flex-1 truncate text-body-xs-regular text-secondary"
                        title={doc.attributes.name}
                      >
                        {t("job_documents.delete_content", { name: doc.attributes.name })}
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => setToDelete(null)} disabled={isDeleting}>
                        {t("cancel")}
                      </Button>
                      <Button variant="error-fill" size="sm" onClick={handleDelete} loading={isDeleting}>
                        {isDeleting ? t("deleting") : t("delete")}
                      </Button>
                    </li>
                  );
                return (
                  <li key={doc.id} className={cn(rowClass, "group")}>
                    <DocumentIcon name={doc.attributes.name} />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-body-sm-medium text-primary hover:underline"
                        title={doc.attributes.name}
                        onClick={() => url && window.open(url, "_blank")}
                      >
                        {doc.attributes.name}
                      </button>
                      <p className="mt-0.5 truncate text-body-xs-regular text-secondary">
                        {[convertBytesToSize(doc.attributes.size), uploader, renderFormattedDate(doc.created_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t("job_documents.download")}
                      title={t("job_documents.download")}
                      className="flex size-8 flex-shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-1 hover:text-primary"
                      onClick={() => url && window.open(url, "_blank")}
                    >
                      <DownloadOutline className="size-4" />
                    </button>
                    {canDelete(doc) && (
                      <button
                        type="button"
                        aria-label={t("job_documents.delete_title")}
                        title={t("job_documents.delete_title")}
                        className="flex size-8 flex-shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-layer-1 hover:text-danger-primary"
                        onClick={() => setToDelete(doc)}
                      >
                        <DeleteOutline className="size-4" />
                      </button>
                    )}
                  </li>
                );
              })
            ) : (
              uploadingNames.length === 0 && (
                <li className="py-3 text-center text-body-xs-regular text-tertiary">{t("job_documents.empty")}</li>
              )
            )}
          </ul>
        </div>

        <div className="px-6 pt-2 pb-6">
          <button
            type="button"
            onClick={handleClose}
            className="h-10 w-full rounded-lg bg-accent-primary text-body-sm-medium text-on-color transition-colors hover:bg-accent-primary-hover"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </ModalCore>
  );
});
