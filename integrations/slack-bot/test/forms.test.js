import { test } from "node:test";
import assert from "node:assert/strict";
import { readLogTimeForm } from "../src/forms.js";

// Slack's view.state.values for one Log time entry.
const entry = (n, { project, task, newTask, hours = "1h30", date = "2026-03-04", notes } = {}) => ({
  [`e${n}_project`]: {
    project: {
      selected_option: project ? { text: { text: project.name }, value: `${project.id}|${project.key}` } : null,
    },
  },
  [`e${n}_task`]: {
    lt_task: {
      selected_option: task
        ? { text: { text: `${task.key} · ${task.name}` }, value: `${task.id}|${task.key}|${task.projectId}` }
        : null,
    },
  },
  [`e${n}_newtask`]: { newtask: { value: newTask ?? null } },
  [`e${n}_hours`]: { hours: { value: hours } },
  [`e${n}_date`]: { date: { selected_date: date } },
  [`e${n}_notes`]: { notes: { value: notes ?? null } },
});

const ACME = { id: "p1", key: "ACM", name: "Acme" };
const DOCS = { id: "t1", key: "ACM-3", name: "Write docs", projectId: "p1" };

test("an existing task in the chosen project", () => {
  const { entries, errors } = readLogTimeForm(entry(1, { project: ACME, task: DOCS, notes: "intro" }), 1);
  assert.equal(errors, undefined);
  assert.deepEqual(entries, [
    {
      hours: 1.5,
      task: { id: "t1", key: "ACM-3", name: "Write docs", project: { name: "Acme" } },
      newTask: null,
      spentOn: "2026-03-04",
      comment: "intro",
    },
  ]);
});

test("a new task title instead of a task", () => {
  const { entries } = readLogTimeForm(entry(1, { project: ACME, newTask: "  Fix login  ", hours: "45m" }), 1);
  assert.equal(entries[0].task, null);
  assert.deepEqual(entries[0].newTask, { title: "Fix login", projectId: "p1", identifier: "ACM", projectName: "Acme" });
  assert.equal(entries[0].hours, 0.75);
});

test("needs a project, and a task or a new title (not both)", () => {
  assert.deepEqual(readLogTimeForm(entry(1, { task: DOCS }), 1).errors, { e1_project: "Choose a project." });
  assert.match(readLogTimeForm(entry(1, { project: ACME }), 1).errors.e1_task, /Pick a task/);
  assert.match(readLogTimeForm(entry(1, { project: ACME, task: DOCS, newTask: "x" }), 1).errors.e1_newtask, /not both/);
});

test("a task from another project is rejected", () => {
  const other = { ...DOCS, projectId: "p2" };
  assert.match(readLogTimeForm(entry(1, { project: ACME, task: other }), 1).errors.e1_task, /another project/);
});

test("errors point at the right entry", () => {
  const values = { ...entry(1, { project: ACME, task: DOCS }), ...entry(2, { project: ACME, task: DOCS, hours: "" }) };
  const { errors } = readLogTimeForm(values, 2);
  assert.deepEqual(Object.keys(errors), ["e2_hours"]);
});
