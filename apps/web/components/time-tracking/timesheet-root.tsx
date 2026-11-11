/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tab, Tabs, TabsList, TabsPanel } from "@makeplane/propel/components/tabs";
import {
  CalendarOutline,
  ChevronDownOutline,
  ChevronLeftOutline,
  ChevronRightOutline,
  CloseOutline,
  DeleteOutline,
  DownloadOutline,
} from "@makeplane/propel/icons";
import { DateRangeSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { ProjectSelect } from "@/components/dropdowns/project/project-select";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions, useUserProfile } from "@/hooks/store/user";
// services
import type { TTimeEntry } from "@/services/time-entry.service";
import { timeEntryService } from "@/services/time-entry.service";
// local
import { LogTimeButton } from "./log-time-drawer";
import {
  dayLabel,
  daysBetween,
  formatMinutes,
  fromIsoDay,
  groupEntries,
  rangeLabel,
  toIsoDay,
  weekDays,
} from "./utils";

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
const sumMinutes = (entries: TTimeEntry[] | undefined) => (entries ?? []).reduce((s, e) => s + e.minutes, 0);

type TRange = { from: string; to: string };
const thisWeek = (): TRange => {
  const w = weekDays(0);
  return { from: w[0], to: w[6] };
};

/** Timesheet: see your hours over any date range (admins also get a Team tab); "Log time" opens a side panel. */
export const TimesheetRoot = observer(function TimesheetRoot({ workspaceSlug }: { workspaceSlug: string }) {
  const [range, setRange] = useState<TRange>(thisWeek);
  const { data: profile } = useUserProfile();
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserWorkspaceRoles.ADMIN] as any, EUserPermissionsLevel.WORKSPACE);
  const days = useMemo(() => daysBetween(range.from, range.to), [range]);
  const isThisWeek = range.from === thisWeek().from && range.to === thisWeek().to;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col gap-6 overflow-y-auto px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h4-semibold text-primary">Timesheet</h1>
          <p className="text-body-sm-regular text-tertiary">Your hours, by day and task.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isThisWeek && (
            <Button
              variant="tertiary"
              size="md"
              stretch="auto"
              label="This week"
              onClick={() => setRange(thisWeek())}
            />
          )}
          <div className="w-64 shrink-0">
            <DateRangeSelect
              variant="select-md"
              value={{ from: fromIsoDay(range.from), to: fromIsoDay(range.to) }}
              onChange={(r) => {
                if (r.from && r.to) setRange({ from: toIsoDay(r.from), to: toIsoDay(r.to) });
              }}
              icon={<CalendarOutline />}
              weekStartsOn={profile?.start_of_the_week}
              placeholder="Pick dates"
            />
          </div>
          <LogTimeButton workspaceSlug={workspaceSlug} onLogged={() => void refreshAll()} />
        </div>
      </div>

      {isAdmin ? (
        <Tabs variant="underline" defaultValue="mine">
          <TabsList>
            <Tab value="mine" label="My time" />
            <Tab value="team" label="Team" />
          </TabsList>
          <TabsPanel value="mine">
            <MyTime workspaceSlug={workspaceSlug} range={range} days={days} />
          </TabsPanel>
          <TabsPanel value="team">
            <TeamTime workspaceSlug={workspaceSlug} range={range} days={days} />
          </TabsPanel>
        </Tabs>
      ) : (
        <MyTime workspaceSlug={workspaceSlug} range={range} days={days} />
      )}
    </div>
  );
});

function RangeTotal({
  label,
  minutes,
  range,
  extra,
}: {
  label: string;
  minutes: number;
  range: TRange;
  extra?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-h3-semibold text-primary">{formatMinutes(minutes)}</span>
      <span className="text-body-sm-regular text-tertiary">
        {label} · {rangeLabel([range.from, range.to])}
        {extra ? ` · ${extra}` : ""}
      </span>
    </div>
  );
}

/** Scroll a row sideways with the trackpad/wheel, or by grabbing it with the mouse. */
function useGrabScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, x: 0, left: 0, moved: false });
  return {
    ref,
    props: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || !ref.current) return;
        drag.current = { active: true, x: e.clientX, left: ref.current.scrollLeft, moved: false };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d.active || !ref.current) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 4) d.moved = true;
        if (d.moved) ref.current.scrollLeft = d.left - dx;
      },
      onPointerUp: () => {
        drag.current.active = false;
      },
      onPointerLeave: () => {
        drag.current.active = false;
      },
      // a drag must not also click the day card it ended on
      onClickCapture: (e: React.MouseEvent) => {
        if (drag.current.moved) {
          e.stopPropagation();
          e.preventDefault();
          drag.current.moved = false;
        }
      },
    },
  };
}

/** Your time in the range: scrollable day cards (click one to see just that day) and your entries. */
const MyTime = observer(function MyTime({
  workspaceSlug,
  range,
  days,
}: {
  workspaceSlug: string;
  range: TRange;
  days: string[];
}) {
  const { data: me } = useUser();
  const today = toIsoDay(new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const grab = useGrabScroll();

  // New range: forget the picked day and bring today (or the first day) into view.
  useEffect(() => {
    setSelected(null);
    const box = grab.ref.current;
    const target = box?.querySelector<HTMLElement>(`[data-day="${days.includes(today) ? today : days[0]}"]`);
    if (box && target) box.scrollTo({ left: target.offsetLeft - (box.clientWidth - target.clientWidth) / 2 });
  }, [days, today, grab.ref]);

  const {
    data: entries,
    isLoading,
    error,
  } = useSWR(me?.id ? ["timesheet", workspaceSlug, range.from, range.to, me.id, "mine"] : null, () =>
    timeEntryService.between(workspaceSlug, { from: range.from, to: range.to, user_id: me?.id })
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TTimeEntry[]>();
    for (const e of entries ?? []) map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    return map;
  }, [entries]);
  // newest day first
  const shownDays = (selected ? [selected] : days)
    .filter((d) => byDay.get(d)?.length)
    .map((d, i, all) => all[all.length - 1 - i]);

  const scrollBy = (dir: 1 | -1) =>
    grab.ref.current?.scrollBy({ left: dir * grab.ref.current.clientWidth * 0.8, behavior: "smooth" });

  const remove = async (e: TTimeEntry) => {
    try {
      await timeEntryService.remove(workspaceSlug, e.project.id, e.issue.id, e.id);
      await refreshAll();
    } catch (err) {
      setToast({ type: "error", title: "Couldn't remove it", message: (err as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-5">
      <RangeTotal label="Your time" minutes={sumMinutes(entries)} range={range} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={() => setSelected(null)}
          className={cn(
            "flex w-28 shrink-0 flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
            selected === null
              ? "border-accent-strong bg-accent-subtle"
              : "border-subtle bg-layer-1 hover:bg-layer-transparent-hover"
          )}
        >
          <span className={cn("text-caption-md-medium", selected === null ? "text-accent-primary" : "text-tertiary")}>
            All days
          </span>
          <span className="text-h5-semibold text-primary">{formatMinutes(sumMinutes(entries))}</span>
        </button>
        <IconButton
          variant="ghost"
          size="md"
          aria-label="Scroll days left"
          icon={<Icon icon={ChevronLeftOutline} />}
          onClick={() => scrollBy(-1)}
        />
        <div
          ref={grab.ref}
          {...grab.props}
          className={cn(
            "horizontal-scrollbar relative scrollbar-sm flex flex-1 cursor-grab snap-x gap-2 overflow-x-auto pb-2 active:cursor-grabbing"
          )}
        >
          {days.map((d) => {
            const l = dayLabel(d);
            const m = sumMinutes(byDay.get(d));
            const isSelected = selected === d;
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                data-day={d}
                aria-pressed={isSelected}
                onClick={() => setSelected(isSelected ? null : d)}
                className={cn(
                  "flex w-28 shrink-0 snap-start flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors select-none",
                  isSelected
                    ? "border-accent-strong bg-accent-subtle"
                    : "border-subtle bg-layer-1 hover:bg-layer-transparent-hover"
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-caption-md-medium",
                    isSelected || isToday ? "text-accent-primary" : "text-tertiary"
                  )}
                >
                  {l.weekday} {fromIsoDay(d).getDate()}
                  {(fromIsoDay(d).getDate() === 1 || d === days[0]) &&
                    ` ${fromIsoDay(d).toLocaleDateString(undefined, { month: "short" })}`}
                  {isToday && <span className="size-1.5 rounded-full bg-accent-primary" aria-label="Today" />}
                </span>
                <span className={cn("text-h5-semibold", m ? "text-primary" : "text-placeholder")}>
                  {m ? formatMinutes(m) : "–"}
                </span>
              </button>
            );
          })}
        </div>
        <IconButton
          variant="ghost"
          size="md"
          aria-label="Scroll days right"
          icon={<Icon icon={ChevronRightOutline} />}
          onClick={() => scrollBy(1)}
        />
      </div>

      {error && <p className="text-body-sm-regular text-danger-primary">{(error as Error).message}</p>}
      {!error && !isLoading && !shownDays.length && (
        <div className="rounded-lg border border-dashed border-subtle px-4 py-12 text-center text-body-sm-regular text-tertiary">
          {selected ? "Nothing logged on this day." : "Nothing logged in these dates yet."}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {shownDays.map((d) => {
          const list = byDay.get(d) ?? [];
          const l = dayLabel(d);
          return (
            <section key={d} className="overflow-hidden rounded-lg border border-subtle">
              <div className="flex items-center justify-between bg-layer-1 px-4 py-2.5">
                <span className="text-body-sm-medium text-primary">
                  {l.weekday}, {l.date}
                  {d === today && <span className="ml-2 text-caption-md-medium text-accent-primary">Today</span>}
                </span>
                <span className="text-body-sm-medium text-primary">{formatMinutes(sumMinutes(list))}</span>
              </div>
              <ul className="divide-y divide-subtle">
                {list.map((e) => (
                  <li key={e.id} className="group flex items-start gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/${workspaceSlug}/browse/${e.issue.key}/`}
                        className="block truncate text-body-sm-medium text-primary hover:underline"
                      >
                        {e.issue.name}
                      </Link>
                      <p className="truncate text-caption-md-regular text-tertiary">{e.project.name}</p>
                      {e.comment && (
                        <p className="mt-1.5 text-body-sm-regular whitespace-pre-line text-secondary">{e.comment}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-body-sm-medium text-primary">{formatMinutes(e.minutes)}</span>
                    <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
    </div>
  );
});

type TPerson = { id: string; name: string };

/** Everyone's time in the range (admins): a person-by-day table; click a person for their tasks. */
const TeamTime = observer(function TeamTime({
  workspaceSlug,
  range,
  days,
}: {
  workspaceSlug: string;
  range: TRange;
  days: string[];
}) {
  const [person, setPerson] = useState<TPerson | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { workspace: workspaceMembers, getUserDetails } = useMember();
  const today = toIsoDay(new Date());

  const {
    data: entries,
    isLoading,
    error,
  } = useSWR(["timesheet", workspaceSlug, range.from, range.to, person?.id ?? "", projectId ?? "", "team"], () =>
    timeEntryService.between(workspaceSlug, {
      from: range.from,
      to: range.to,
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
    <div className="flex flex-col gap-5 pt-5">
      <RangeTotal
        label="Team time"
        minutes={sumMinutes(entries)}
        range={range}
        extra={`${groups.length} ${groups.length === 1 ? "person" : "people"}`}
      />

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
            onClick={() => entries && downloadCsv(entries, `timesheet-${range.from}-to-${range.to}.csv`)}
          />
        </div>
      </div>

      {error && <p className="text-body-sm-regular text-danger-primary">{(error as Error).message}</p>}

      <div className="horizontal-scrollbar scrollbar-sm overflow-x-auto rounded-lg border border-subtle">
        <table className="w-full border-collapse text-body-sm-regular">
          <thead>
            <tr className="bg-layer-1 text-left">
              <th className="sticky left-0 z-10 min-w-56 bg-layer-1 px-4 py-3 text-caption-md-medium text-tertiary">
                Person {isLoading && <span className="ml-1">· loading…</span>}
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={cn(
                    "min-w-16 px-2 py-3 text-center text-caption-md-medium whitespace-nowrap",
                    d === today ? "text-accent-primary" : "text-tertiary"
                  )}
                >
                  {dayLabel(d).weekday} {fromIsoDay(d).getDate()}
                </th>
              ))}
              <th className="sticky right-0 z-10 min-w-20 bg-layer-1 px-4 py-3 text-right text-caption-md-medium text-tertiary">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && !groups.length && (
              <tr>
                <td colSpan={days.length + 2} className="px-4 py-12 text-center text-tertiary">
                  Nobody has logged time in these dates{projectId || person ? " with these filters" : ""}.
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
                <td className="sticky left-0 bg-layer-1 px-4 py-3">Total</td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-3 text-center">
                    {dayTotals[d] ? formatMinutes(dayTotals[d]) : "–"}
                  </td>
                ))}
                <td className="sticky right-0 bg-layer-1 px-4 py-3 text-right">{formatMinutes(sumMinutes(entries))}</td>
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
        <td className="sticky left-0 bg-surface-1 px-4 py-3">
          <span className="flex items-center gap-2 text-body-sm-medium text-primary">
            <ChevronRightOutline
              className={cn("size-3.5 shrink-0 text-tertiary transition-transform", open && "rotate-90")}
            />
            {group.name}
          </span>
        </td>
        {days.map((d) => (
          <td key={d} className={cn("px-2 py-3 text-center text-secondary", d === today && "bg-accent-subtle")}>
            {group.perDay[d] ? formatMinutes(group.perDay[d]) : <span className="text-placeholder">–</span>}
          </td>
        ))}
        <td className="sticky right-0 bg-surface-1 px-4 py-3 text-right text-body-sm-medium text-primary">
          {formatMinutes(group.total)}
        </td>
      </tr>
      {open &&
        group.rows.map((r) => (
          <tr key={r.key} className="border-t border-subtle bg-layer-1">
            <td className="sticky left-0 max-w-72 bg-layer-1 py-2.5 pr-4 pl-10">
              <Link href={r.href} className="block truncate text-primary hover:underline">
                {r.label}
              </Link>
              <span className="block truncate text-caption-md-regular text-tertiary">{r.sub}</span>
            </td>
            {days.map((d) => (
              <td key={d} className="px-2 py-2.5 text-center text-tertiary">
                {r.perDay[d] ? formatMinutes(r.perDay[d]) : ""}
              </td>
            ))}
            <td className="sticky right-0 bg-layer-1 px-4 py-2.5 text-right text-secondary">
              {formatMinutes(r.total)}
            </td>
          </tr>
        ))}
    </>
  );
}
