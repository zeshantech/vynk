/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate } from "swr";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
// services
import { timeEntryService } from "@/services/time-entry.service";
// local
import { formatMinutes, fromIsoDay, parseDuration, toIsoDay } from "./utils";

const FIELD =
  "h-8 rounded-md border border-subtle bg-surface-1 px-2 text-body-sm-regular text-primary outline-none placeholder:text-placeholder focus:border-accent-primary";

type Props = { workspaceSlug: string; projectId: string; issueId: string; disabled?: boolean };

/** Time spent on one work item: who logged what, plus a one-line form to add more. */
export const IssueTimeLog = observer(function IssueTimeLog({ workspaceSlug, projectId, issueId, disabled }: Props) {
  const { data: me } = useUser();
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserWorkspaceRoles.ADMIN] as any, EUserPermissionsLevel.WORKSPACE);
  const [duration, setDuration] = useState("");
  const [day, setDay] = useState(toIsoDay(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const key = ["issue-time-entries", issueId];
  const { data: entries } = useSWR(key, () => timeEntryService.forIssue(workspaceSlug, projectId, issueId));
  const total = (entries ?? []).reduce((sum, e) => sum + e.minutes, 0);
  const refreshSheets = () => mutate((k) => Array.isArray(k) && k[0] === "timesheet");

  const add = async () => {
    if (busy) return;
    if (parseDuration(duration) === null) return setError("Enter a duration such as 1h30, 45m or 1.5.");
    setBusy(true);
    setError("");
    try {
      await timeEntryService.log(workspaceSlug, projectId, issueId, {
        minutes: duration,
        spent_on: day,
        comment: note,
      });
      setDuration("");
      setNote("");
      await mutate(key);
      void refreshSheets();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await timeEntryService.remove(workspaceSlug, projectId, issueId, id);
      await mutate(key);
      void refreshSheets();
    } catch (e) {
      setToast({ type: "error", title: "Couldn't remove it", message: (e as Error).message });
    }
  };

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-h5-medium text-primary">Time</h3>
        <span className="text-body-sm-medium text-secondary">
          {total ? `${formatMinutes(total)} logged` : "Nothing logged yet"}
        </span>
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${FIELD} w-24`}
            placeholder="1h 30m"
            aria-label="Time spent"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <input
            type="date"
            className={FIELD}
            value={day}
            max={toIsoDay(new Date())}
            onChange={(e) => setDay(e.target.value)}
          />
          <input
            className={`${FIELD} min-w-40 flex-1`}
            placeholder="Note (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label={busy ? "Logging…" : "Log time"}
            disabled={busy}
            onClick={() => void add()}
          />
        </div>
      )}
      {error && <p className="text-body-sm-regular text-danger-primary">{error}</p>}

      {!!entries?.length && (
        <ul className="divide-y divide-subtle rounded-lg border border-subtle">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-body-sm-regular">
              <span className="w-14 shrink-0 text-body-sm-medium text-primary">{formatMinutes(e.minutes)}</span>
              <span className="shrink-0 text-secondary">{e.user.display_name}</span>
              <span className="shrink-0 text-tertiary">
                {fromIsoDay(e.spent_on).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
              <span className="min-w-0 flex-1 truncate text-tertiary">{e.comment}</span>
              {!disabled && (e.user.id === me?.id || isAdmin) && (
                <button
                  type="button"
                  className="text-tertiary hover:text-danger-primary"
                  onClick={() => void remove(e.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
