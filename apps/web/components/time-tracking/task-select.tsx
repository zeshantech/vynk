/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { ChevronDownOutline } from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
// services
import type { TTimeTask } from "@/services/time-entry.service";
import { timeEntryService } from "@/services/time-entry.service";

type Props = {
  workspaceSlug: string;
  /** Only this project's tasks (all your projects when empty). */
  projectId?: string | null;
  value: TTimeTask | null;
  onChange: (task: TTimeTask) => void;
  className?: string;
};

/**
 * Pick an open task you can log time on, with the theme's searchable dropdown.
 * Empty search shows your assigned tasks first; typing searches every project you're in (titles or keys).
 */
export function TaskSelect({ workspaceSlug, projectId, value, onChange, className }: Props) {
  const seen = useRef(new Map<string, TTimeTask>());

  const load = async ({ search }: { search?: string }) => {
    const q = (search ?? "").trim();
    const project_id = projectId ?? undefined;
    // In a project: all its open tasks. Across projects with no search: yours first, then anything.
    let list = await timeEntryService.tasks(workspaceSlug, {
      q,
      project_id,
      assigned: q || project_id ? undefined : "1",
    });
    if (!q && !list.length && !project_id) list = await timeEntryService.tasks(workspaceSlug, {});
    for (const t of list) seen.current.set(t.id, t);
    return { results: list, next_page_results: false };
  };

  return (
    <Select<TTimeTask>
      infinite
      getValues={load}
      value={value}
      onChange={(id) => {
        const task = seen.current.get(id);
        if (task) onChange(task);
      }}
      getOptionValue={(t) => t.id}
      getOptionLabel={(t) => `${t.key} ${t.name}`}
      getOptionDescription={(t) => (projectId ? undefined : t.project.name)}
      renderOption={(t) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-caption-sm-medium text-tertiary">{t.key}</span>
          <span className="truncate">{t.name}</span>
        </span>
      )}
      placeholder="Pick a task"
      searchPlaceholder="Search tasks or type a key like ABC-12"
      emptyMessage={(q) =>
        q ? `No open task matches "${q}"` : projectId ? "No open tasks in this project" : "No open tasks"
      }
      contentSizing="anchor"
    >
      <Select.Trigger<TTimeTask> variant="select-md" className={className} appendIcon={<ChevronDownOutline />}>
        {value ? (
          <span className="flex min-w-0 grow items-center gap-2 text-left">
            <span className="shrink-0 text-caption-sm-medium text-tertiary">{value.key}</span>
            <span className="truncate">{value.name}</span>
          </span>
        ) : (
          <span className="grow truncate text-left text-placeholder">Pick a task</span>
        )}
      </Select.Trigger>
    </Select>
  );
}
