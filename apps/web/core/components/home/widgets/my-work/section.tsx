/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";

/** Small uppercase label used for queue groups and side sections; structure, not decoration. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-11 font-semibold tracking-wide text-geo-grey uppercase", className)}>{children}</h3>;
}

type TEmptyBlockProps = {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

/** Calm empty state that sits inside the queue without a second container. */
export function EmptyBlock(props: TEmptyBlockProps) {
  const { icon, title, description, action, className } = props;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center", className)}>
      <span className="mb-1 grid size-9 place-items-center rounded-full bg-geo-grey-subtle text-geo-grey">{icon}</span>
      <p className="text-13 font-medium text-primary">{title}</p>
      {description && <p className="max-w-[36ch] text-12 text-tertiary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Skeleton matching the task row silhouette so the list doesn't jump when data lands. */
export function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <Loader className="flex flex-col">
      {Array.from({ length: count }, (_, index) => `row-${index}`).map((key) => (
        <div key={key} className="flex h-12 items-center gap-3 border-b border-subtle px-3 last:border-0">
          <Loader.Item height="16px" width="16px" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Loader.Item height="12px" width="45%" />
            <Loader.Item height="10px" width="25%" />
          </div>
          <Loader.Item height="20px" width="80px" />
          <Loader.Item height="14px" width="48px" />
        </div>
      ))}
    </Loader>
  );
}
