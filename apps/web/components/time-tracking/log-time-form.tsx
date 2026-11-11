/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
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
import { isNewTask, TaskSelect } from "./task-select";
import { formatMinutes, fromIsoDay, parseDuration, toIsoDay } from "./utils";

const LAST_KEY = "vynk-last-time-task";
const readLast = (): TTimeTask | null => {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    return last && !isNewTask(last) ? last : null;
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

type Props = {
  workspaceSlug: string;
  onLogged: () => void;
  onDone?: () => void;
  /** "stacked" for a side panel; "inline" lays the fields in a row for a page (Home). */
  layout?: "stacked" | "inline";
};

/**
 * Log time: project, a task in it (type to find one, or type a new title to create it), how long,
 * which day, an optional note. Remembers the last task so the next entry is quick.
 */
export const LogTimeForm = observer(function LogTimeForm({
  workspaceSlug,
  onLogged,
  onDone,
  layout = "stacked",
}: Props) {
  const { data: me } = useUser();
  const { data: profile } = useUserProfile();
  const { getProjectById } = useProject();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [task, setTask] = useState<TTimeTask | null>(null);
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
    // an existing task from another project no longer fits; a typed new title still does
    if (task && !isNewTask(task) && task.project.id !== id) setTask(null);
    setError("");
  };

  /** The task to log on: the picked one, or the new one created in the chosen project. */
  const resolveTask = async (): Promise<TTimeTask> => {
    if (!task) throw new Error("Pick a task, or type a title to create a new one.");
    if (!isNewTask(task)) return task;
    if (!projectId) throw new Error("Choose the project for the new task.");
    const project = getProjectById(projectId);
    const created = await timeEntryService.createTask(workspaceSlug, projectId, {
      name: task.name,
      assigneeId: me?.id,
    });
    const identifier = project?.identifier ?? "";
    return {
      id: created.id,
      name: task.name,
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
      await timeEntryService.log(workspaceSlug, target.project.id, target.id, {
        minutes: duration,
        spent_on: day,
        comment: note,
      });
      remember(target);
      setToast({
        type: "success",
        title: `Logged ${formatMinutes(minutes)}`,
        message: `${target.name} · ${target.project.name}`,
      });
      setDuration("");
      setNote("");
      onLogged();
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inline = layout === "inline";

  const projectField = (
    <Field label="Project">
      <ProjectSelect
        variant="select-md"
        projectList="joined"
        value={projectId}
        onChange={chooseProject}
        placeholder="Any project"
      />
    </Field>
  );
  const taskField = (
    <Field label="Task" hint={isNewTask(task) ? "A new task will be created and assigned to you." : undefined}>
      <TaskSelect
        key={projectId ?? "all"}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        value={task}
        onChange={(t) => {
          setTask(t);
          if (!isNewTask(t)) setProjectId(t.project.id);
          setError("");
          setTimeout(() => durationRef.current?.focus(), 0);
        }}
        className="w-full"
      />
    </Field>
  );
  const timeField = (
    <Field label="Time spent">
      <DurationField value={duration} onChange={setDuration} inputRef={durationRef} />
    </Field>
  );
  const dayField = (
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
  );
  const noteField = (
    <Field label="Note (optional)">
      <TextAreaGroup resize="none">
        <TextArea
          size="md"
          surface="field"
          autoResize
          maxRows={6}
          placeholder="What did you work on?"
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
  );
  const submitButton = (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      stretch={inline ? "auto" : "full"}
      label={minutes ? `Log ${formatMinutes(minutes)}` : "Log time"}
      loading={busy}
    />
  );

  return (
    <form
      className={cn("flex flex-col", inline ? "gap-4" : "gap-5")}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {inline ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {projectField}
            {taskField}
            {timeField}
            {dayField}
          </div>
          {noteField}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm-regular text-danger-primary">{error}</p>
            {submitButton}
          </div>
        </>
      ) : (
        <>
          {projectField}
          {taskField}
          {timeField}
          {dayField}
          {noteField}
          {error && <p className="text-body-sm-regular text-danger-primary">{error}</p>}
          {submitButton}
        </>
      )}
    </form>
  );
});

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-body-xs-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="text-caption-md-regular text-tertiary">{hint}</span>}
    </div>
  );
}
