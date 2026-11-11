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
import { LogTimeButton } from "./log-time-drawer";
import { formatMinutes, groupByProject, groupEntries, rangeLabel, weekDays } from "./utils";

/** Home: this week's hours by project and task (admins can switch to the team), and a "Log time" button. */
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
  const empty = entries && projects.length === 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClockOutline className="size-4 text-secondary" />
          <h3 className="text-body-md-semibold text-primary">Time this week</h3>
          <span className="text-body-sm-regular text-tertiary">{rangeLabel(days)}</span>
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
            size="md"
            stretch="auto"
            label="Timesheet"
            nativeButton={false}
            render={<Link href={`/${workspaceSlug}/timesheet/`} />}
          />
          <LogTimeButton workspaceSlug={workspaceSlug} onLogged={() => void refresh()} />
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-subtle bg-layer-1 p-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1 md:border-r md:border-subtle md:pr-5">
          <span className="text-body-sm-regular text-tertiary">{view === "team" ? "Team total" : "Your total"}</span>
          <span className="text-h3-semibold text-primary">{formatMinutes(shownTotal)}</span>
          {view === "team" && (
            <span className="text-body-sm-regular text-tertiary">
              {people.length} {people.length === 1 ? "person" : "people"} logging
            </span>
          )}
        </div>

        {empty ? (
          <p className="self-center text-body-sm-regular text-tertiary">
            {view === "team" ? "Nobody has logged time this week yet." : "You haven't logged time this week yet."}
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            {projects.map((p) => (
              <div key={p.id} className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-body-sm-medium text-primary">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0">{formatMinutes(p.total)}</span>
                </div>
                {p.tasks.slice(0, 4).map((t) => (
                  <Link
                    key={t.id}
                    href={t.href}
                    className="flex items-center justify-between gap-3 text-body-sm-regular text-secondary hover:text-primary"
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="shrink-0 text-tertiary">{formatMinutes(t.total)}</span>
                  </Link>
                ))}
                {p.tasks.length > 4 && (
                  <span className="text-caption-md-regular text-tertiary">+{p.tasks.length - 4} more</span>
                )}
              </div>
            ))}
            {view === "team" && (
              <div className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
                <span className="text-body-sm-medium text-primary">By person</span>
                {people.map((g) => (
                  <div
                    key={g.userId}
                    className="flex items-center justify-between gap-3 text-body-sm-regular text-secondary"
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 text-tertiary">{formatMinutes(g.total)}</span>
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
