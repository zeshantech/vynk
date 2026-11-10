// Reading the Log time modal (kept apart from index.js so it can be tested without Slack).
import { hoursError, parseHours } from "./time.js";

/** Modal state values -> { block_id: { text, date, option } } (one input per block). */
export const stateOf = (values = {}) => {
  const out = {};
  for (const [block, actions] of Object.entries(values)) {
    const a = Object.values(actions)[0] ?? {};
    out[block] = { text: a.value, date: a.selected_date, option: a.selected_option };
  }
  return out;
};

/** Validates the form; returns { errors } or { entries } (an entry has a task, or a new task title). */
export function readLogTimeForm(values, count) {
  const prev = stateOf(values);
  const errors = {};
  const entries = [];
  for (let n = 1; n <= count; n++) {
    const projectValue = prev[`e${n}_project`]?.option?.value;
    const option = prev[`e${n}_task`]?.option;
    const newTitle = (prev[`e${n}_newtask`]?.text ?? "").trim();
    const hoursText = prev[`e${n}_hours`]?.text ?? "";
    const bad = hoursError(hoursText);
    if (bad) errors[`e${n}_hours`] = bad;
    if (!projectValue) {
      errors[`e${n}_project`] = "Choose a project.";
      continue;
    }
    const [projectId, identifier] = projectValue.split("|");
    const projectName = prev[`e${n}_project`].option.text.text;
    let task = null;
    if (option && newTitle) errors[`e${n}_newtask`] = "Pick a task or type a new title, not both.";
    else if (option) {
      const [id, key, taskProjectId] = option.value.split("|");
      if (taskProjectId && taskProjectId !== projectId) errors[`e${n}_task`] = "That task is in another project.";
      else task = { id, key, name: option.text.text.replace(/^[^·]*·\s*/, ""), project: { name: projectName } };
    } else if (!newTitle) errors[`e${n}_task`] = "Pick a task, or type a new task title below.";
    if (errors[`e${n}_hours`] || errors[`e${n}_task`] || errors[`e${n}_newtask`]) continue;
    entries.push({
      hours: parseHours(hoursText),
      task,
      newTask: task ? null : { title: newTitle, projectId, identifier, projectName },
      spentOn: prev[`e${n}_date`]?.date,
      comment: prev[`e${n}_notes`]?.text ?? "",
    });
  }
  return Object.keys(errors).length ? { errors } : { entries };
}
