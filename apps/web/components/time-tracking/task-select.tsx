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

/** A task that doesn't exist yet: typed in the task field, created when the time is logged. */
export const NEW_TASK_PREFIX = "new:";
export const isNewTask = (t: TTimeTask | null): boolean => !!t && t.id.startsWith(NEW_TASK_PREFIX);
const newTask = (title: string, projectId: string | null | undefined): TTimeTask => ({
  id: `${NEW_TASK_PREFIX}${title}`,
  name: title,
  key: "",
  sequence_id: 0,
  project: { id: projectId ?? "", name: "", identifier: "" },
});

const LOOKS_LIKE_KEY = /^[A-Za-z0-9]+-\d+$/;

type Props = {
  workspaceSlug: string;
  /** Only this project's tasks (all your projects when empty). The key is hidden when a project is chosen. */
  projectId?: string | null;
  value: TTimeTask | null;
  onChange: (task: TTimeTask) => void;
  className?: string;
};

/**
 * One field for the task: type to find an existing task (title or key like ABC-12), or type a new
 * title and pick "Create …" to make it. Empty search shows your assigned tasks first.
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
    const exact = list.some((t) => t.name.trim().toLowerCase() === q.toLowerCase());
    const offerCreate = q && !exact && !(LOOKS_LIKE_KEY.test(q) && list.length);
    const results = offerCreate ? [...list, newTask(q, projectId)] : list;
    for (const t of results) seen.current.set(t.id, t);
    return { results, next_page_results: false };
  };

  return (
    <Select<TTimeTask>
      infinite
      getValues={load}
      value={value}
      onChange={(id) => {
        const task = seen.current.get(id);
        if (task) onChange(isNewTask(task) ? newTask(task.name, projectId) : task);
      }}
      getOptionValue={(t) => t.id}
      getOptionLabel={(t) => (isNewTask(t) ? `Create ${t.name}` : `${t.key} ${t.name}`)}
      getOptionDisabled={(t) => isNewTask(t) && !projectId}
      getOptionDescription={(t) => {
        if (isNewTask(t)) return projectId ? "New task in this project, assigned to you" : "Choose a project first";
        return projectId ? undefined : t.project.name;
      }}
      renderOption={(t) =>
        isNewTask(t) ? (
          <span className="truncate text-accent-primary">+ Create “{t.name}”</span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            {!projectId && <span className="shrink-0 text-caption-md-medium text-tertiary">{t.key}</span>}
            <span className="truncate">{t.name}</span>
          </span>
        )
      }
      placeholder="Find or create a task"
      searchPlaceholder="Type a task, or a new title to create it"
      emptyMessage={(q) => (q ? `No open task matches “${q}”` : "No open tasks yet. Type a title to create one.")}
      contentSizing="anchor"
    >
      <Select.Trigger<TTimeTask> variant="select-md" className={className} appendIcon={<ChevronDownOutline />}>
        {value ? (
          <span className="flex min-w-0 grow items-center gap-2 text-left">
            {isNewTask(value) ? (
              <span className="shrink-0 text-caption-md-medium text-accent-primary">New</span>
            ) : (
              !projectId && <span className="shrink-0 text-caption-md-medium text-tertiary">{value.key}</span>
            )}
            <span className="truncate">{value.name}</span>
          </span>
        ) : (
          <span className="grow truncate text-left text-placeholder">Find or create a task</span>
        )}
      </Select.Trigger>
    </Select>
  );
}
