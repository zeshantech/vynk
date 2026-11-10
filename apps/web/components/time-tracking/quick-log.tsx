/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useUserProfile } from "@/hooks/store/user";
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

type Props = { workspaceSlug: string; onLogged: () => void };

/** Log time on any task in a few clicks: task, how long, day, optional note. Remembers the last task. */
export const QuickLog = observer(function QuickLog({ workspaceSlug, onLogged }: Props) {
  const { data: profile } = useUserProfile();
  const [task, setTask] = useState<TTimeTask | null>(null);
  const [duration, setDuration] = useState("");
  const [day, setDay] = useState(toIsoDay(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const durationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = readLast();
    if (last) setTask(last);
  }, []);

  const minutes = parseDuration(duration);
  const submit = async () => {
    if (busy) return;
    if (!task) return setError("Pick a task first.");
    if (minutes === null || minutes <= 0)
      return setError("Enter how long, e.g. 1h30, 45m or 1.5, or tap a quick pick.");
    setBusy(true);
    setError("");
    try {
      await timeEntryService.log(workspaceSlug, task.project.id, task.id, {
        minutes: duration,
        spent_on: day,
        comment: note,
      });
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(task));
      } catch {
        // private mode: just don't remember it
      }
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
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(232px,auto)_auto]">
        <Field label="Task">
          <TaskSelect
            workspaceSlug={workspaceSlug}
            value={task}
            onChange={(t) => {
              setTask(t);
              setError("");
              setTimeout(() => durationRef.current?.focus(), 0);
            }}
            className="w-full"
          />
        </Field>
        <Field label="Time">
          <DurationField value={duration} onChange={setDuration} onKeyDown={onEnter} inputRef={durationRef} />
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
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <InputGroup size="md">
            <Input
              size="md"
              placeholder="What did you work on? (optional)"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={onEnter}
            />
          </InputGroup>
        </div>
        <Button
          variant="primary"
          size="md"
          stretch="auto"
          label={minutes ? `Log ${formatMinutes(minutes)}` : "Log time"}
          loading={busy}
          onClick={() => void submit()}
        />
      </div>
      {error && <p className="text-body-sm-regular text-danger-primary">{error}</p>}
    </div>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption-md-medium text-tertiary">{label}</span>
      {children}
    </div>
  );
}
