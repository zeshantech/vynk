/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
// components
import { ProjectSelect } from "@/components/dropdowns/project/project-select";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserProfile } from "@/hooks/store/user";
// services
import type { TTimeTask } from "@/services/time-entry.service";
import { timeEntryService } from "@/services/time-entry.service";
// local
import { DurationField } from "./duration-field";
import { TaskSelect } from "./task-select";
import { formatMinutes, fromIsoDay, parseDuration, toIsoDay } from "./utils";

const LAST_KEY = "vynk-last-time-task";
const readLast = (): TTimeTask | null => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
  } catch {
    return null;
  }
};
const remember = (task: TTimeTask) => {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(task));
  } catch {
    // private mode: just don't remember it
  }
};

type Props = { workspaceSlug: string; onLogged: () => void };

/**
 * Log time: project, then a task in it (or a new task, created and assigned to you), how long, which
 * day, an optional note. Remembers the last task so the next entry is one click.
 */
export const QuickLog = observer(function QuickLog({ workspaceSlug, onLogged }: Props) {
  const { data: me } = useUser();
  const { data: profile } = useUserProfile();
  const { getProjectById } = useProject();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [task, setTask] = useState<TTimeTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [day, setDay] = useState(toIsoDay(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const durationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = readLast();
    if (last) {
      setTask(last);
      setProjectId(last.project.id);
    }
  }, []);

  const minutes = parseDuration(duration);

  const chooseProject = (id: string | null) => {
    setProjectId(id);
    if (task && task.project.id !== id) setTask(null);
    setError("");
  };

  /** The task to log on: the picked one, or a new one created in the chosen project. */
  const resolveTask = async (): Promise<TTimeTask> => {
    if (!creating) {
      if (!task) throw new Error("Pick a task, or choose + New task.");
      return task;
    }
    const title = newTitle.trim();
    if (!projectId) throw new Error("Choose the project for the new task.");
    if (!title) throw new Error("Type a title for the new task.");
    const project = getProjectById(projectId);
    const created = await timeEntryService.createTask(workspaceSlug, projectId, { name: title, assigneeId: me?.id });
    const identifier = project?.identifier ?? "";
    return {
      id: created.id,
      name: title,
      sequence_id: created.sequence_id,
      key: `${identifier}-${created.sequence_id}`,
      project: { id: projectId, name: project?.name ?? "", identifier },
    };
  };

  const submit = async () => {
    if (busy) return;
    if (minutes === null || minutes <= 0)
      return setError("Enter how long, e.g. 1h30, 45m or 1.5, or tap a quick pick.");
    setBusy(true);
    setError("");
    try {
      const target = await resolveTask();
      if (creating) {
        setTask(target);
        setCreating(false);
        setNewTitle("");
      }
      await timeEntryService.log(workspaceSlug, target.project.id, target.id, {
        minutes: duration,
        spent_on: day,
        comment: note,
      });
      remember(target);
      setToast({
        type: "success",
        title: `Logged ${formatMinutes(minutes)}`,
        message: `${target.key} · ${target.name}`,
      });
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

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_232px_auto]">
        <Field label="Project">
          <ProjectSelect
            variant="select-md"
            projectList="joined"
            value={projectId}
            onChange={chooseProject}
            placeholder="All my projects"
          />
        </Field>

        <Field
          label={creating ? "New task" : "Task"}
          action={
            <button
              type="button"
              className="text-caption-md-medium text-accent-primary hover:underline"
              onClick={() => {
                setCreating(!creating);
                setError("");
              }}
            >
              {creating ? "Pick an existing task" : "+ New task"}
            </button>
          }
        >
          {creating ? (
            <InputGroup size="md">
              <Input
                size="md"
                placeholder={projectId ? "Title of the new task" : "Choose a project first"}
                maxLength={255}
                value={newTitle}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to type a title
                autoFocus
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </InputGroup>
          ) : (
            <TaskSelect
              key={projectId ?? "all"}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              value={task}
              onChange={(t) => {
                setTask(t);
                setProjectId(t.project.id);
                setError("");
                setTimeout(() => durationRef.current?.focus(), 0);
              }}
              className="w-full"
            />
          )}
        </Field>

        <Field label="Time">
          <DurationField value={duration} onChange={setDuration} inputRef={durationRef} />
        </Field>

        <Field label="Day">
          <DateSelect
            variant="select-md"
            value={fromIsoDay(day)}
            onChange={(d) => d && setDay(toIsoDay(d))}
            maxDate={new Date()}
            icon={<CalendarOutline />}
            weekStartsOn={profile?.start_of_the_week}
          />
        </Field>
      </div>

      <Field label="What did you work on? (optional)">
        <TextAreaGroup resize="none">
          <TextArea
            size="md"
            surface="field"
            autoResize
            maxRows={6}
            placeholder="A few words about the work, e.g. fixed the login redirect"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </TextAreaGroup>
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm-regular text-danger-primary">{error}</p>
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          label={minutes ? `Log ${formatMinutes(minutes)}` : "Log time"}
          loading={busy}
          onClick={() => void submit()}
        />
      </div>
    </div>
  );
});

function Field({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption-md-medium text-tertiary">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
