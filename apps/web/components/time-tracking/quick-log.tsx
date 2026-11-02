/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
// services
import type { TTimeTask } from "@/services/time-entry.service";
import { timeEntryService } from "@/services/time-entry.service";
// local
import { formatMinutes, parseDuration, toIsoDay } from "./utils";

const FIELD =
  "h-8 rounded-md border border-subtle bg-surface-1 px-2 text-body-sm-regular text-primary outline-none placeholder:text-placeholder focus:border-accent-primary";
const LAST_KEY = "vynk-last-time-task";

const readLast = (): TTimeTask | null => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
  } catch {
    return null;
  }
};

type Props = { workspaceSlug: string; onLogged: () => void };

/** One row to log time on any project and task: project, task, duration, day, note, Enter. */
export function QuickLog({ workspaceSlug, onLogged }: Props) {
  const [project, setProject] = useState("");
  const [task, setTask] = useState<TTimeTask | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState("");
  const [day, setDay] = useState(toIsoDay(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const durationRef = useRef<HTMLInputElement>(null);

  // the task you logged on last is ready for the next entry
  useEffect(() => {
    const last = readLast();
    if (last) setTask(last);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  const { data: projects } = useSWR(["time-projects", workspaceSlug], () => timeEntryService.projects(workspaceSlug));
  const { data: tasks, isLoading } = useSWR(
    open ? ["time-tasks", workspaceSlug, project, debounced] : null,
    async () => {
      const q = debounced.trim();
      const list = await timeEntryService.tasks(workspaceSlug, {
        q,
        project_id: project || undefined,
        assigned: q ? undefined : "1",
      });
      // nothing assigned to you here: offer the project's open tasks instead
      if (!q && !list.length) return timeEntryService.tasks(workspaceSlug, { project_id: project || undefined });
      return list;
    }
  );

  const pick = (t: TTimeTask) => {
    setTask(t);
    setQuery("");
    setOpen(false);
    setError("");
    durationRef.current?.focus();
  };

  const minutes = parseDuration(duration);
  const submit = async () => {
    if (busy) return;
    if (!task) return setError("Pick a task first.");
    if (minutes === null) return setError("Enter a duration such as 1h30, 45m or 1.5.");
    setBusy(true);
    setError("");
    try {
      await timeEntryService.log(workspaceSlug, task.project.id, task.id, {
        minutes: duration,
        spent_on: day,
        comment: note,
      });
      localStorage.setItem(LAST_KEY, JSON.stringify(task));
      setToast({ type: "success", title: `Logged ${formatMinutes(minutes)}`, message: `${task.key} · ${task.name}` });
      setDuration("");
      setNote("");
      onLogged();
      durationRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="rounded-lg border border-subtle bg-layer-1 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption-sm-regular text-tertiary">Project</span>
          <select
            className={`${FIELD} w-44`}
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setTask(null);
            }}
          >
            <option value="">All my projects</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div className="relative flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-caption-sm-regular text-tertiary">Task</span>
          <input
            className={FIELD}
            placeholder={task ? `${task.key} · ${task.name}` : "Search a task or type a key like ABC-12"}
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && open && tasks?.[0]) {
                e.preventDefault();
                pick(tasks[0]);
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {task && !query && (
            <span className="pointer-events-none absolute right-2 bottom-[7px] left-2 truncate text-body-sm-regular text-primary">
              {task.key} · {task.name}
            </span>
          )}
          {open && (
            <ul className="shadow-lg absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-subtle bg-surface-1 p-1">
              {isLoading && <li className="px-2 py-1.5 text-body-sm-regular text-tertiary">Searching…</li>}
              {!isLoading && !tasks?.length && (
                <li className="px-2 py-1.5 text-body-sm-regular text-tertiary">No matching open tasks.</li>
              )}
              {(tasks ?? []).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-layer-1"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(t)}
                  >
                    <span className="shrink-0 text-caption-sm-medium text-tertiary">{t.key}</span>
                    <span className="truncate text-body-sm-regular text-primary">{t.name}</span>
                    <span className="ml-auto shrink-0 text-caption-sm-regular text-tertiary">{t.project.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-caption-sm-regular text-tertiary">Time</span>
          <input
            ref={durationRef}
            className={`${FIELD} w-24`}
            placeholder="1h 30m"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onKeyDown={onEnter}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption-sm-regular text-tertiary">Day</span>
          <input
            type="date"
            className={FIELD}
            value={day}
            max={toIsoDay(new Date())}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-caption-sm-regular text-tertiary">Note</span>
          <input
            className={FIELD}
            placeholder="What did you do? (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onEnter}
          />
        </label>
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          label={busy ? "Logging…" : "Log time"}
          disabled={busy}
          onClick={() => void submit()}
        />
      </div>
      {error && <p className="mt-2 text-body-sm-regular text-danger-primary">{error}</p>}
    </div>
  );
}
