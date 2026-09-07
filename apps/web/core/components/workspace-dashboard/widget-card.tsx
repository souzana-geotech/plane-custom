/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";

type Props = {
  id?: string;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function WorkspaceDashboardWidgetCard(props: Props) {
  const { id, title, description, actions, children, className } = props;
  return (
    <section
      id={id}
      aria-label={title}
      className={cn("flex h-full scroll-mt-4 flex-col rounded-lg border border-subtle bg-surface-1 p-5", className)}
    >
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-16 font-medium text-primary">{title}</h3>}
            {description && <p className="mt-0.5 text-12 text-tertiary">{description}</p>}
          </div>
          {actions && <div className="flex-shrink-0">{actions}</div>}
        </div>
      )}
      <div className="flex-1">{children}</div>
    </section>
  );
}
