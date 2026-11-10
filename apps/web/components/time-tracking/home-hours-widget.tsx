/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Button } from "@makeplane/propel/components/button";
import { Tab, Tabs, TabsList } from "@makeplane/propel/components/tabs";
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

/** Home: log time right away, and this week's hours by project and task (admins can switch to the team). */
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
  const shownTotal = projects.reduce((s, p) => s + p.total, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClockOutline className="size-4 text-secondary" />
          <h3 className="text-body-md-semibold text-primary">Time this week</h3>
          <span className="text-caption-md-regular text-tertiary">{rangeLabel(days)}</span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Tabs variant="contained" value={view} onValueChange={(v: string) => setView(v as "mine" | "team")}>
              <TabsList>
                <Tab value="mine" label="Mine" />
                <Tab value="team" label="Team" />
              </TabsList>
            </Tabs>
          )}
          <Button
            variant="tertiary"
            size="sm"
            stretch="auto"
            label="Open timesheet"
            nativeButton={false}
            render={<Link href={`/${workspaceSlug}/timesheet/`} />}
          />
        </div>
      </div>

      <QuickLog workspaceSlug={workspaceSlug} onLogged={() => void refresh()} />

      <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="flex flex-row gap-3 md:flex-col">
          <Stat label={view === "team" ? "Team this week" : "You this week"} value={formatMinutes(shownTotal)} />
          {view === "team" && <Stat label="People logging" value={String(people.length)} />}
        </div>

        <div className="rounded-lg border border-subtle bg-layer-1 p-4">
          {entries && projects.length === 0 ? (
            <p className="text-body-sm-regular text-tertiary">
              {view === "team" ? "Nobody has logged time this week yet." : "You haven't logged time this week yet."}
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h4 className="text-caption-md-medium text-tertiary">By project and task</h4>
                {projects.map((p) => (
                  <div key={p.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3 text-body-sm-medium text-primary">
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0">{formatMinutes(p.total)}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-layer-2">
                      <div
                        className="h-full rounded-full bg-accent-primary"
                        style={{ width: `${Math.max(4, (p.total / Math.max(shownTotal, 1)) * 100)}%` }}
                      />
                    </div>
                    {p.tasks.slice(0, 3).map((t) => (
                      <Link
                        key={t.id}
                        href={t.href}
                        className="flex items-center justify-between gap-3 text-caption-md-regular text-secondary hover:text-primary"
                      >
                        <span className="truncate">
                          <span className="text-tertiary">{t.key}</span> {t.name}
                        </span>
                        <span className="shrink-0">{formatMinutes(t.total)}</span>
                      </Link>
                    ))}
                    {p.tasks.length > 3 && (
                      <span className="text-caption-md-regular text-tertiary">+{p.tasks.length - 3} more tasks</span>
                    )}
                  </div>
                ))}
              </div>
              {view === "team" && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-caption-md-medium text-tertiary">By person</h4>
                  {people.map((g) => (
                    <div key={g.userId} className="flex items-center justify-between gap-3 text-body-sm-regular">
                      <span className="truncate text-secondary">{g.name}</span>
                      <span className="shrink-0 text-primary">{formatMinutes(g.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col rounded-lg border border-subtle bg-layer-1 px-4 py-3">
      <span className="text-caption-md-medium text-tertiary">{label}</span>
      <span className="text-h4-semibold text-primary">{value}</span>
    </div>
  );
}
