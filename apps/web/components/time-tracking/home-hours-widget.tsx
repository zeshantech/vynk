/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { ClockOutline } from "@makeplane/propel/icons";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
// services
import { timeEntryService } from "@/services/time-entry.service";
// local
import { QuickLog } from "./quick-log";
import { formatMinutes, groupByProject, groupEntries, rangeLabel, weekDays } from "./utils";

const TAB = "rounded-md px-2.5 py-1 text-body-xs-medium";

/** Home: log time in one row, and this week's hours by project and task (admins can switch to the team). */
export const HomeHoursWidget = observer(function HomeHoursWidget({ workspaceSlug }: { workspaceSlug: string }) {
  const { data: me } = useUser();
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserWorkspaceRoles.ADMIN] as any, EUserPermissionsLevel.WORKSPACE);
  const [view, setView] = useState<"mine" | "team">("mine");
  const days = useMemo(() => weekDays(0), []);

  // Admins get everyone's entries from this endpoint; members get their own.
  const { data: entries } = useSWR(["timesheet", workspaceSlug, days[0], "", "", "home"], () =>
    timeEntryService.between(workspaceSlug, { from: days[0], to: days[6] })
  );
  const refresh = () => mutate((k) => Array.isArray(k) && (k[0] === "timesheet" || k[0] === "issue-time-entries"));

  const mine = useMemo(() => (entries ?? []).filter((e) => e.user.id === me?.id), [entries, me?.id]);
  const projects = useMemo(
    () => groupByProject(view === "team" ? (entries ?? []) : mine, workspaceSlug),
    [view, entries, mine, workspaceSlug]
  );
  const people = useMemo(() => groupEntries(entries ?? [], workspaceSlug), [entries, workspaceSlug]);
  const myTotal = mine.reduce((s, e) => s + e.minutes, 0);
  const teamTotal = (entries ?? []).reduce((s, e) => s + e.minutes, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClockOutline className="size-4 text-secondary" />
          <h3 className="text-body-md-semibold text-primary">Time this week</h3>
          <span className="text-body-xs-regular text-tertiary">{rangeLabel(days)}</span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex rounded-md border border-subtle p-0.5" role="tablist" aria-label="Whose hours">
              {(["mine", "team"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  className={`${TAB} ${view === v ? "bg-layer-2 text-primary" : "text-tertiary hover:text-primary"}`}
                  onClick={() => setView(v)}
                >
                  {v === "mine" ? "Mine" : "Team"}
                </button>
              ))}
            </div>
          )}
          <Link
            href={`/${workspaceSlug}/timesheet/`}
            className="text-body-xs-medium text-accent-primary hover:underline"
          >
            Open timesheet
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-subtle bg-layer-1 p-4">
        <QuickLog workspaceSlug={workspaceSlug} onLogged={() => void refresh()} />

        <div className="mt-4 flex flex-wrap gap-6 border-t border-subtle pt-4">
          <Stat label="You" value={formatMinutes(myTotal)} />
          {isAdmin && <Stat label="Team" value={formatMinutes(teamTotal)} />}
          {isAdmin && <Stat label="People logging" value={String(people.length)} />}
        </div>

        {entries && projects.length === 0 && (
          <p className="mt-4 text-body-sm-regular text-tertiary">
            {view === "team" ? "Nobody has logged time this week yet." : "You haven't logged time this week yet."}
          </p>
        )}

        {projects.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h4 className="text-body-xs-medium text-tertiary">By project and task</h4>
              {projects.map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-body-sm-medium text-primary">
                    <span className="truncate">{p.name}</span>
                    <span>{formatMinutes(p.total)}</span>
                  </div>
                  {p.tasks.slice(0, 4).map((t) => (
                    <Link
                      key={t.id}
                      href={t.href}
                      className="flex items-center justify-between gap-3 pl-3 text-body-xs-regular text-secondary hover:text-primary"
                    >
                      <span className="truncate">
                        <span className="text-tertiary">{t.key}</span> {t.name}
                      </span>
                      <span className="shrink-0">{formatMinutes(t.total)}</span>
                    </Link>
                  ))}
                  {p.tasks.length > 4 && (
                    <span className="pl-3 text-body-xs-regular text-tertiary">+{p.tasks.length - 4} more</span>
                  )}
                </div>
              ))}
            </div>
            {view === "team" && (
              <div className="flex flex-col gap-2">
                <h4 className="text-body-xs-medium text-tertiary">By person</h4>
                {people.map((g) => (
                  <div key={g.userId} className="flex items-center justify-between text-body-sm-regular">
                    <span className="truncate text-secondary">{g.name}</span>
                    <span className="text-primary">{formatMinutes(g.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-body-xs-regular text-tertiary">{label}</span>
      <span className="text-h5-semibold text-primary">{value}</span>
    </div>
  );
}
