// Parsing for slash-command text (pure, no I/O).

import { parseHours } from "./time.js";

const DATE_WORD = /^(today|yesterday|\d{4}-\d{2}-\d{2})$/i;

const TASK_KEY = /^#?([A-Za-z][A-Za-z0-9]*-\d+)$/;

/**
 * "/log-time 2h ABC-12 fixed login bug yesterday"
 * -> { hours: 2, taskKey: "ABC-12", comment: "fixed login bug", date: "yesterday" }
 * Hours and task may come in any order; the date word may be anywhere.
 */
export function parseLogTime(text) {
  const tokens = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let hours = null;
  let taskKey = null;
  let date = null;
  const rest = [];
  tokens.forEach((token, index) => {
    const key = TASK_KEY.exec(token);
    if (taskKey === null && key) taskKey = key[1].toUpperCase();
    else if (hours === null && index < 2 && /^\d/.test(token) && parseHours(token) !== null) hours = parseHours(token);
    else if (date === null && DATE_WORD.test(token)) date = token.toLowerCase();
    else rest.push(token);
  });
  return { hours, taskKey, date, comment: rest.join(" ") };
}

/** "/create-task website | Fix header" -> { project: "website", subject: "Fix header" } */
export function parseCreateTask(text) {
  const raw = String(text ?? "").trim();
  const idx = raw.indexOf("|");
  if (idx === -1) return { project: null, subject: raw || null };
  return { project: raw.slice(0, idx).trim() || null, subject: raw.slice(idx + 1).trim() || null };
}
