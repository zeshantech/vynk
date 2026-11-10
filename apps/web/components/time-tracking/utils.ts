/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TTimeEntry } from "@/services/time-entry.service";

export const formatMinutes = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** Same rules as the server ("1h30", "45m", "1.5" = hours); null when it can't be read. */
export const parseDuration = (input: string): number | null => {
  const text = input.trim().toLowerCase().replace(",", ".");
  let minutes: number;
  const hm = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*(?:m(?:in(?:ute)?s?)?)?)?$/.exec(text);
  const m = /^(\d+)\s*m(?:in(?:ute)?s?)?$/.exec(text);
  if (hm) minutes = Math.round(parseFloat(hm[1]) * 60 + parseInt(hm[2] ?? "0", 10));
  else if (m) minutes = parseInt(m[1], 10);
  else if (/^\d+(?:\.\d+)?$/.test(text)) minutes = Math.round(parseFloat(text) * 60);
  else return null;
  return minutes >= 1 && minutes <= 24 * 60 ? minutes : null;
};

export const toIsoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const fromIsoDay = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, days: number): Date => {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
};

/** Monday-to-Sunday week, `offset` weeks away from the current one. */
export const weekDays = (offset: number): string[] => {
  const today = new Date();
  const monday = addDays(today, -((today.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => toIsoDay(addDays(monday, i)));
};

export const dayLabel = (iso: string): { weekday: string; date: string } => {
  const d = fromIsoDay(iso);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    date: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  };
};

export const rangeLabel = (days: string[]): string => {
  const [a, b] = [fromIsoDay(days[0]), fromIsoDay(days[days.length - 1])];
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${a.toLocaleDateString(undefined, opts)} – ${b.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
};

export type TSheetRow = {
  key: string;
  label: string;
  sub: string;
  href: string;
  perDay: Record<string, number>;
  total: number;
};
export type TSheetGroup = {
  userId: string;
  name: string;
  total: number;
  perDay: Record<string, number>;
  rows: TSheetRow[];
};

/** People (sorted by hours) -> their tasks -> minutes per day. */
export const groupEntries = (entries: TTimeEntry[], workspaceSlug: string): TSheetGroup[] => {
  const groups = new Map<string, TSheetGroup>();
  for (const e of entries) {
    let group = groups.get(e.user.id);
    if (!group) {
      group = { userId: e.user.id, name: e.user.display_name, total: 0, perDay: {}, rows: [] };
      groups.set(e.user.id, group);
    }
    let row = group.rows.find((r) => r.key === e.issue.id);
    if (!row) {
      row = {
        key: e.issue.id,
        label: e.issue.name,
        sub: `${e.issue.key} · ${e.project.name}`,
        href: `/${workspaceSlug}/browse/${e.issue.key}/`,
        perDay: {},
        total: 0,
      };
      group.rows.push(row);
    }
    row.perDay[e.spent_on] = (row.perDay[e.spent_on] ?? 0) + e.minutes;
    row.total += e.minutes;
    group.perDay[e.spent_on] = (group.perDay[e.spent_on] ?? 0) + e.minutes;
    group.total += e.minutes;
  }
  for (const g of groups.values()) g.rows.sort((a, b) => b.total - a.total);
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array; toSorted isn't in this TS lib target
  return [...groups.values()].sort((a, b) => b.total - a.total);
};

export type TProjectTotal = {
  id: string;
  name: string;
  total: number;
  tasks: { id: string; key: string; name: string; href: string; total: number }[];
};

/** Projects (sorted by time) -> their tasks, with totals in minutes. */
export const groupByProject = (entries: TTimeEntry[], workspaceSlug: string): TProjectTotal[] => {
  const projects = new Map<string, TProjectTotal>();
  for (const e of entries) {
    let project = projects.get(e.project.id);
    if (!project) {
      project = { id: e.project.id, name: e.project.name, total: 0, tasks: [] };
      projects.set(e.project.id, project);
    }
    let task = project.tasks.find((t) => t.id === e.issue.id);
    if (!task) {
      task = {
        id: e.issue.id,
        key: e.issue.key,
        name: e.issue.name,
        href: `/${workspaceSlug}/browse/${e.issue.key}/`,
        total: 0,
      };
      project.tasks.push(task);
    }
    task.total += e.minutes;
    project.total += e.minutes;
  }
  const list = [...projects.values()];
  // oxlint-disable-next-line unicorn/no-array-sort -- sorting fresh local arrays; toSorted isn't in this TS lib target
  for (const p of list) p.tasks.sort((a, b) => b.total - a.total);
  // oxlint-disable-next-line unicorn/no-array-sort -- same
  return list.sort((a, b) => b.total - a.total);
};
