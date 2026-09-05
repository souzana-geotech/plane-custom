/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";

type Props = {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function WorkspaceDashboardWidgetCard(props: Props) {
  const { title, actions, children, className } = props;
  return (
    <div className={cn("flex h-full flex-col rounded-lg border border-subtle bg-surface-1 p-5", className)}>
      {(title || actions) && (
        <div className="mb-5 flex items-center justify-between gap-2">
          {title && <h3 className="text-16 font-medium text-primary">{title}</h3>}
          {actions}
        </div>
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}
