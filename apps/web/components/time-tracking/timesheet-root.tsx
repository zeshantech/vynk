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
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tab, Tabs, TabsList, TabsPanel } from "@makeplane/propel/components/tabs";
import {
  ChevronDownOutline,
  ChevronLeftOutline,
  ChevronRightOutline,
  CloseOutline,
  DeleteOutline,
  DownloadOutline,
} from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { ProjectSelect } from "@/components/dropdowns/project/project-select";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// services
import type { TTimeEntry } from "@/services/time-entry.service";
import { timeEntryService } from "@/services/time-entry.service";
// local
import { QuickLog } from "./quick-log";
import { dayLabel, formatMinutes, fromIsoDay, groupEntries, rangeLabel, toIsoDay, weekDays } from "./utils";

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const downloadCsv = (entries: TTimeEntry[], name: string) => {
  const rows = [
    ["Person", "Project", "Task", "Title", "Date", "Hours", "Note"],
    ...entries.map((e) => [
      e.user.display_name,
      e.project.name,
      e.issue.key,
      e.issue.name,
      e.spent_on,
      (e.minutes / 60).toFixed(2),
      e.comment,
    ]),
  ];
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

const refreshAll = () => mutate((k) => Array.isArray(k) && (k[0] === "timesheet" || k[0] === "issue-time-entries"));

/** Timesheet: log time, see your week day by day; admins also get a Team tab. */
export const TimesheetRoot = observer(function TimesheetRoot({ workspaceSlug }: { workspaceSlug: string }) {
  const [offset, setOffset] = useState(0);
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserWorkspaceRoles.ADMIN] as any, EUserPermissionsLevel.WORKSPACE);
  const days = useMemo(() => weekDays(offset), [offset]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col gap-5 overflow-y-auto px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h4-semibold text-primary">Timesheet</h1>
          <p className="text-body-sm-regular text-tertiary">Log your hours and see where the week went.</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            variant="ghost"
            size="md"
            aria-label="Previous week"
            icon={<Icon icon={ChevronLeftOutline} />}
            onClick={() => setOffset(offset - 1)}
          />
          <Button
            variant={offset === 0 ? "secondary" : "tertiary"}
            size="md"
            stretch="auto"
            label={offset === 0 ? `This week · ${rangeLabel(days)}` : rangeLabel(days)}
            onClick={() => setOffset(0)}
          />
          <IconButton
            variant="ghost"
            size="md"
            aria-label="Next week"
            icon={<Icon icon={ChevronRightOutline} />}
            disabled={offset >= 0}
            onClick={() => setOffset(offset + 1)}
          />
        </div>
      </div>

      <QuickLog workspaceSlug={workspaceSlug} onLogged={() => void refreshAll()} />

      {isAdmin ? (
        <Tabs variant="underline" defaultValue="mine">
          <TabsList>
            <Tab value="mine" label="My time" />
            <Tab value="team" label="Team" />
          </TabsList>
          <TabsPanel value="mine">
            <MyWeek workspaceSlug={workspaceSlug} days={days} />
          </TabsPanel>
          <TabsPanel value="team">
            <TeamWeek workspaceSlug={workspaceSlug} days={days} />
          </TabsPanel>
        </Tabs>
      ) : (
        <MyWeek workspaceSlug={workspaceSlug} days={days} />
      )}
    </div>
  );
});

/** Your week: one tile per day, then your entries grouped by day (newest first), each removable. */
const MyWeek = observer(function MyWeek({ workspaceSlug, days }: { workspaceSlug: string; days: string[] }) {
  const { data: me } = useUser();
  const today = toIsoDay(new Date());
  const {
    data: entries,
    isLoading,
    error,
  } = useSWR(me?.id ? ["timesheet", workspaceSlug, days[0], me.id, "", "mine"] : null, () =>
    timeEntryService.between(workspaceSlug, { from: days[0], to: days[6], user_id: me?.id })
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TTimeEntry[]>();
    for (const e of entries ?? []) map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    return map;
  }, [entries]);
  const total = (entries ?? []).reduce((s, e) => s + e.minutes, 0);
  const dayTotal = (d: string) => (byDay.get(d) ?? []).reduce((s, e) => s + e.minutes, 0);

  const remove = async (e: TTimeEntry) => {
    try {
      await timeEntryService.remove(workspaceSlug, e.project.id, e.issue.id, e.id);
      await refreshAll();
    } catch (err) {
      setToast({ type: "error", title: "Couldn't remove it", message: (err as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {days.map((d) => {
          const l = dayLabel(d);
          const m = dayTotal(d);
          return (
            <div
              key={d}
              className={cn(
                "flex flex-col rounded-lg border px-3 py-2",
                d === today ? "border-accent-strong bg-accent-subtle" : "border-subtle bg-layer-1"
              )}
            >
              <span className={cn("text-caption-md-medium", d === today ? "text-accent-primary" : "text-tertiary")}>
                {l.weekday} {fromIsoDay(d).getDate()}
              </span>
              <span className={cn("text-body-md-semibold", m ? "text-primary" : "text-placeholder")}>
                {m ? formatMinutes(m) : "–"}
              </span>
            </div>
          );
        })}
        <div className="flex flex-col rounded-lg border border-subtle bg-layer-2 px-3 py-2">
          <span className="text-caption-md-medium text-tertiary">Total</span>
          <span className="text-body-md-semibold text-primary">{formatMinutes(total)}</span>
        </div>
      </div>

      {error && <p className="text-body-sm-regular text-danger-primary">{(error as Error).message}</p>}
      {!error && !isLoading && !entries?.length && (
        <div className="rounded-lg border border-dashed border-subtle px-4 py-10 text-center text-body-sm-regular text-tertiary">
          Nothing logged this week yet. Pick a task above, set the time and press Log.
        </div>
      )}

      {days
        .map((_, i) => days[days.length - 1 - i])
        .map((d) => {
          const list = byDay.get(d);
          if (!list?.length) return null;
          const l = dayLabel(d);
          return (
            <section key={d} className="overflow-hidden rounded-lg border border-subtle">
              <div className="flex items-center justify-between bg-layer-1 px-4 py-2">
                <span className="text-body-sm-medium text-primary">
                  {l.weekday}, {l.date}
                  {d === today && <span className="ml-2 text-caption-md-medium text-accent-primary">Today</span>}
                </span>
                <span className="text-body-sm-medium text-primary">{formatMinutes(dayTotal(d))}</span>
              </div>
              <ul className="divide-y divide-subtle">
                {list.map((e) => (
                  <li key={e.id} className="group flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/${workspaceSlug}/browse/${e.issue.key}/`}
                        className="flex min-w-0 items-center gap-2 text-body-sm-regular text-primary hover:underline"
                      >
                        <span className="shrink-0 text-caption-md-medium text-tertiary">{e.issue.key}</span>
                        <span className="truncate">{e.issue.name}</span>
                      </Link>
                      <p className="truncate text-caption-md-regular text-tertiary">
                        {e.project.name}
                        {e.comment ? ` · ${e.comment}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-body-sm-medium text-primary">{formatMinutes(e.minutes)}</span>
                    <span className="opacity-60 group-hover:opacity-100">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label="Remove entry"
                        icon={<Icon icon={DeleteOutline} />}
                        onClick={() => void remove(e)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
});

type TPerson = { id: string; name: string };

/** Everyone's week (admins): people by day, click a person for their tasks; filter by person or project. */
const TeamWeek = observer(function TeamWeek({ workspaceSlug, days }: { workspaceSlug: string; days: string[] }) {
  const [person, setPerson] = useState<TPerson | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { workspace: workspaceMembers, getUserDetails } = useMember();
  const today = toIsoDay(new Date());

  const {
    data: entries,
    isLoading,
    error,
  } = useSWR(["timesheet", workspaceSlug, days[0], person?.id ?? "", projectId ?? "", "team"], () =>
    timeEntryService.between(workspaceSlug, {
      from: days[0],
      to: days[6],
      user_id: person?.id,
      project_id: projectId ?? undefined,
    })
  );
  const groups = useMemo(() => groupEntries(entries ?? [], workspaceSlug), [entries, workspaceSlug]);
  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of entries ?? []) totals[e.spent_on] = (totals[e.spent_on] ?? 0) + e.minutes;
    return totals;
  }, [entries]);
  const grandTotal = (entries ?? []).reduce((s, e) => s + e.minutes, 0);

  const people: TPerson[] = (workspaceMembers.getWorkspaceMemberIds(workspaceSlug) ?? [])
    .map((id) => ({ id, name: getUserDetails(id)?.display_name ?? "" }))
    .filter((p) => p.name)
    // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array; toSorted isn't in this TS lib target
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select<TPerson>
          getValues={() => people}
          value={person}
          onChange={(id) => setPerson(people.find((p) => p.id === id) ?? null)}
          getOptionValue={(p) => p.id}
          getOptionLabel={(p) => p.name}
          placeholder="Everyone"
          searchPlaceholder="Search people"
        >
          <Select.Trigger<TPerson> variant="select-md" className="w-48" appendIcon={<ChevronDownOutline />}>
            <span className={cn("grow truncate text-left", !person && "text-secondary")}>
              {person?.name ?? "Everyone"}
            </span>
          </Select.Trigger>
        </Select>
        {person && (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Show everyone"
            icon={<Icon icon={CloseOutline} />}
            onClick={() => setPerson(null)}
          />
        )}
        <div className="w-56">
          <ProjectSelect
            variant="select-md"
            projectList="all"
            value={projectId}
            onChange={(id) => setProjectId(id)}
            placeholder="All projects"
          />
        </div>
        {projectId && (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="All projects"
            icon={<Icon icon={CloseOutline} />}
            onClick={() => setProjectId(null)}
          />
        )}
        <div className="ml-auto">
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label="Export CSV"
            icon={<Icon icon={DownloadOutline} />}
            disabled={!entries?.length}
            onClick={() => entries && downloadCsv(entries, `timesheet-${days[0]}.csv`)}
          />
        </div>
      </div>

      {error && <p className="text-body-sm-regular text-danger-primary">{(error as Error).message}</p>}

      <div className="overflow-x-auto rounded-lg border border-subtle">
        <table className="w-full min-w-[760px] border-collapse text-body-sm-regular">
          <thead>
            <tr className="bg-layer-1 text-left">
              <th className="px-4 py-2.5 text-caption-md-medium text-tertiary">
                Person {isLoading && <span className="ml-1">· loading…</span>}
              </th>
              {days.map((d) => {
                const l = dayLabel(d);
                return (
                  <th
                    key={d}
                    className={cn(
                      "w-20 px-2 py-2.5 text-center text-caption-md-medium",
                      d === today ? "text-accent-primary" : "text-tertiary"
                    )}
                  >
                    {l.weekday} {fromIsoDay(d).getDate()}
                  </th>
                );
              })}
              <th className="w-20 px-4 py-2.5 text-right text-caption-md-medium text-tertiary">Total</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && !groups.length && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-tertiary">
                  Nobody has logged time for this week{projectId || person ? " with these filters" : ""}.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <PersonRows
                key={g.userId}
                group={g}
                days={days}
                today={today}
                open={open.has(g.userId)}
                onToggle={() => toggle(g.userId)}
              />
            ))}
          </tbody>
          {groups.length > 1 && (
            <tfoot>
              <tr className="border-t border-subtle bg-layer-1 text-body-sm-medium text-primary">
                <td className="px-4 py-2.5">Total</td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-2.5 text-center">
                    {dayTotals[d] ? formatMinutes(dayTotals[d]) : "–"}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right">{formatMinutes(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
});

function PersonRows({
  group,
  days,
  today,
  open,
  onToggle,
}: {
  group: ReturnType<typeof groupEntries>[number];
  days: string[];
  today: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-t border-subtle hover:bg-layer-transparent-hover" onClick={onToggle}>
        <td className="px-4 py-2.5">
          <span className="flex items-center gap-2 text-body-sm-medium text-primary">
            <ChevronRightOutline
              className={cn("size-3.5 shrink-0 text-tertiary transition-transform", open && "rotate-90")}
            />
            {group.name}
          </span>
        </td>
        {days.map((d) => (
          <td key={d} className={cn("px-2 py-2.5 text-center text-secondary", d === today && "bg-accent-subtle")}>
            {group.perDay[d] ? formatMinutes(group.perDay[d]) : <span className="text-placeholder">–</span>}
          </td>
        ))}
        <td className="px-4 py-2.5 text-right text-body-sm-medium text-primary">{formatMinutes(group.total)}</td>
      </tr>
      {open &&
        group.rows.map((r) => (
          <tr key={r.key} className="border-t border-subtle bg-layer-1">
            <td className="max-w-0 py-2 pr-4 pl-10">
              <Link href={r.href} className="block truncate text-primary hover:underline">
                {r.label}
              </Link>
              <span className="block truncate text-caption-md-regular text-tertiary">{r.sub}</span>
            </td>
            {days.map((d) => (
              <td key={d} className="px-2 py-2 text-center text-tertiary">
                {r.perDay[d] ? formatMinutes(r.perDay[d]) : ""}
              </td>
            ))}
            <td className="px-4 py-2 text-right text-secondary">{formatMinutes(r.total)}</td>
          </tr>
        ))}
    </>
  );
}
