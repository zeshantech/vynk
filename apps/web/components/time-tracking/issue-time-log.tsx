/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate } from "swr";
import { Button } from "@makeplane/propel/components/button";
import { ChevronDownOutline, ClockOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
// services
import { timeEntryService } from "@/services/time-entry.service";
// local
import { LogTimeDialog } from "./log-time-dialog";
import { formatMinutes, fromIsoDay } from "./utils";

type Props = { workspaceSlug: string; projectId: string; issueId: string; disabled?: boolean };

/** The work item's time card: total logged, "Add time" (a dialog), and who logged what. */
export const IssueTimeLog = observer(function IssueTimeLog({ workspaceSlug, projectId, issueId, disabled }: Props) {
  const { data: me } = useUser();
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserWorkspaceRoles.ADMIN] as any, EUserPermissionsLevel.WORKSPACE);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);

  const key = ["issue-time-entries", issueId];
  const { data: entries } = useSWR(key, () => timeEntryService.forIssue(workspaceSlug, projectId, issueId));
  const total = (entries ?? []).reduce((sum, e) => sum + e.minutes, 0);
  const mine = (entries ?? []).filter((e) => e.user.id === me?.id).reduce((sum, e) => sum + e.minutes, 0);
  const refresh = () => mutate((k) => Array.isArray(k) && (k[0] === "timesheet" || k[0] === "issue-time-entries"));

  const remove = async (id: string) => {
    try {
      await timeEntryService.remove(workspaceSlug, projectId, issueId, id);
      await refresh();
    } catch (e) {
      setToast({ type: "error", title: "Couldn't remove it", message: (e as Error).message });
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-subtle bg-layer-1">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-body-sm-medium text-primary">
            <ClockOutline className="size-4" />
            Time tracking
          </h3>
          <p className="mt-0.5 text-body-xs-regular text-tertiary">
            Total <span className="text-body-xs-medium text-primary">{entries ? formatMinutes(total) : "…"}</span>
            {mine > 0 && mine !== total && (
              <>
                {"  ·  "}You <span className="text-body-xs-medium text-primary">{formatMinutes(mine)}</span>
              </>
            )}
          </p>
        </div>
        {!disabled && (
          <Button variant="secondary" size="md" stretch="auto" label="Add time" onClick={() => setAdding(true)} />
        )}
        {!!entries?.length && (
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md text-tertiary hover:bg-layer-2 hover:text-primary"
            aria-label={open ? "Hide time entries" : "Show time entries"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronDownOutline className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && !!entries?.length && (
        <ul className="divide-y divide-subtle border-t border-subtle">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-body-sm-regular">
              <span className="w-16 shrink-0 text-body-sm-medium text-primary">{formatMinutes(e.minutes)}</span>
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

      <LogTimeDialog
        isOpen={adding}
        onClose={() => setAdding(false)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        onLogged={() => {
          setOpen(true);
          void refresh();
        }}
      />
    </section>
  );
});
