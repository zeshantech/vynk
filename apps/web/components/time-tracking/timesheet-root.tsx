/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserWorkspaceRoles } from "@plane/types";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// services
import type { TTimeEntry } from "@/services/time-entry.service";
import { timeEntryService } from "@/services/time-entry.service";
// local
import { QuickLog } from "./quick-log";
import { dayLabel, formatMinutes, groupEntries, rangeLabel, toIsoDay, weekDays } from "./utils";

const SELECT =
  "h-8 rounded-md border border-subtle bg-surface-1 px-2 text-body-sm-regular text-primary outline-none focus:border-accent-primary";
const NAV_BUTTON =
  "h-8 rounded-md border border-subtle bg-surface-1 px-3 text-body-sm-medium text-secondary hover:bg-layer-1";

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

/** The weekly timesheet: log time fast, see the week; admins see everyone and can filter by person or project. */
export const TimesheetRoot = observer(function TimesheetRoot({ workspaceSlug }: { workspaceSlug: string }) {
  const [offset, setOffset] = useState(0);
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const { allowPermissions } = useUserPermissions();
  const { workspace: workspaceMembers, getUserDetails } = useMember();
  const { workspaceProjectIds, joinedProjectIds, getProjectById } = useProject();

  const isAdmin = allowPermissions([EUserWorkspaceRoles.ADMIN] as any, EUserPermissionsLevel.WORKSPACE);
  const days = useMemo(() => weekDays(offset), [offset]);
  const today = toIsoDay(new Date());

  const {
    data: entries,
    isLoading,
    error,
  } = useSWR(["timesheet", workspaceSlug, days[0], userId, projectId], () =>
    timeEntryService.between(workspaceSlug, {
      from: days[0],
      to: days[6],
      user_id: isAdmin && userId ? userId : undefined,
      project_id: projectId || undefined,
    })
  );
  const refresh = () => mutate((k) => Array.isArray(k) && (k[0] === "timesheet" || k[0] === "issue-time-entries"));

  const groups = useMemo(() => groupEntries(entries ?? [], workspaceSlug), [entries, workspaceSlug]);
  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of entries ?? []) totals[e.spent_on] = (totals[e.spent_on] ?? 0) + e.minutes;
    return totals;
  }, [entries]);
  const grandTotal = (entries ?? []).reduce((sum, e) => sum + e.minutes, 0);

  const people = (workspaceMembers.getWorkspaceMemberIds(workspaceSlug) ?? [])
    .map((id) => ({ id, name: getUserDetails(id)?.display_name ?? "" }))
    .filter((p) => p.name)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const projectIds = (isAdmin ? workspaceProjectIds : joinedProjectIds) ?? [];
  const showPerson = isAdmin && (groups.length > 1 || !userId);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h4-semibold text-primary">Timesheet</h1>
          <p className="text-body-sm-regular text-tertiary">
            {isAdmin ? "Everyone's logged time for the week." : "Your logged time for the week."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <select className={SELECT} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Person">
                <option value="">Everyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className={SELECT}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Project"
              >
                <option value="">All projects</option>
                {projectIds.map((id) => (
                  <option key={id} value={id}>
                    {getProjectById(id)?.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <button type="button" className={NAV_BUTTON} aria-label="Previous week" onClick={() => setOffset(offset - 1)}>
            ‹
          </button>
          <button type="button" className={NAV_BUTTON} onClick={() => setOffset(0)} disabled={offset === 0}>
            This week
          </button>
          <button type="button" className={NAV_BUTTON} aria-label="Next week" onClick={() => setOffset(offset + 1)}>
            ›
          </button>
          {isAdmin && !!entries?.length && (
            <button
              type="button"
              className={NAV_BUTTON}
              onClick={() => downloadCsv(entries, `timesheet-${days[0]}.csv`)}
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      <QuickLog workspaceSlug={workspaceSlug} onLogged={() => void refresh()} />

      <div className="overflow-x-auto rounded-lg border border-subtle">
        <table className="w-full min-w-[820px] border-collapse text-body-sm-regular">
          <thead>
            <tr className="bg-layer-1 text-left text-tertiary">
              <th className="px-3 py-2 font-medium">
                {rangeLabel(days)}
                {isLoading && <span className="ml-2 text-caption-sm-regular">Loading…</span>}
              </th>
              {days.map((d) => {
                const l = dayLabel(d);
                return (
                  <th
                    key={d}
                    className={`w-20 px-2 py-2 text-center font-medium ${d === today ? "text-accent-primary" : ""}`}
                  >
                    <div>{l.weekday}</div>
                    <div className="text-caption-sm-regular">{l.date}</div>
                  </th>
                );
              })}
              <th className="w-20 px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-danger-primary">
                  {(error as Error).message}
                </td>
              </tr>
            )}
            {!error && !isLoading && !groups.length && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-tertiary">
                  Nothing logged this week. Use the bar above to add your first entry.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <GroupRows key={g.userId} group={g} days={days} today={today} showPerson={showPerson} />
            ))}
          </tbody>
          {!!groups.length && (
            <tfoot>
              <tr className="border-t border-subtle bg-layer-1 font-medium text-primary">
                <td className="px-3 py-2">Total</td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-2 text-center">
                    {dayTotals[d] ? formatMinutes(dayTotals[d]) : "–"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">{formatMinutes(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
});

function GroupRows({
  group,
  days,
  today,
  showPerson,
}: {
  group: ReturnType<typeof groupEntries>[number];
  days: string[];
  today: string;
  showPerson: boolean;
}) {
  return (
    <>
      {showPerson && (
        <tr className="border-t border-subtle bg-layer-1/60">
          <td className="px-3 py-2 font-medium text-primary">{group.name}</td>
          {days.map((d) => (
            <td key={d} className="px-2 py-2 text-center text-secondary">
              {group.perDay[d] ? formatMinutes(group.perDay[d]) : ""}
            </td>
          ))}
          <td className="px-3 py-2 text-right font-medium text-primary">{formatMinutes(group.total)}</td>
        </tr>
      )}
      {group.rows.map((r) => (
        <tr key={r.key} className="border-t border-subtle hover:bg-layer-1/40">
          <td className="max-w-0 px-3 py-2">
            <Link href={r.href} className="block truncate text-primary hover:underline">
              {r.label}
            </Link>
            <span className="block truncate text-caption-sm-regular text-tertiary">{r.sub}</span>
          </td>
          {days.map((d) => (
            <td key={d} className={`px-2 py-2 text-center ${d === today ? "bg-accent-primary/5" : ""} text-secondary`}>
              {r.perDay[d] ? formatMinutes(r.perDay[d]) : <span className="text-placeholder">–</span>}
            </td>
          ))}
          <td className="px-3 py-2 text-right text-primary">{formatMinutes(r.total)}</td>
        </tr>
      ))}
    </>
  );
}
