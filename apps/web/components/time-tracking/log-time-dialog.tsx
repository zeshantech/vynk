/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogCloseGroup,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { CloseOutline } from "@makeplane/propel/icons";
// services
import { timeEntryService } from "@/services/time-entry.service";
// local
import { formatMinutes, parseDuration, toIsoDay } from "./utils";

const FIELD =
  "h-9 w-full rounded-md border border-subtle bg-surface-1 px-3 text-body-sm-regular text-primary outline-none placeholder:text-placeholder focus:border-accent-primary";
const QUICK = ["15m", "30m", "1h", "2h", "4h"];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onLogged: () => void;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
};

/** "Add time" for one work item: duration (with quick picks), day and an optional note. */
export function LogTimeDialog({ isOpen, onClose, onLogged, workspaceSlug, projectId, issueId }: Props) {
  const [duration, setDuration] = useState("");
  const [day, setDay] = useState(toIsoDay(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setDuration("");
    setNote("");
    setError("");
    setDay(toIsoDay(new Date()));
  }, [isOpen]);

  const minutes = parseDuration(duration);

  const submit = async () => {
    if (busy) return;
    if (minutes === null || minutes <= 0) return setError("Enter a duration such as 1h30, 45m or 1.5.");
    setBusy(true);
    setError("");
    try {
      await timeEntryService.log(workspaceSlug, projectId, issueId, {
        minutes: duration,
        spent_on: day,
        comment: note,
      });
      onLogged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm">
        <DialogCloseGroup>
          <IconButton
            variant="ghost"
            size="xs"
            aria-label="Close"
            icon={<Icon icon={CloseOutline} />}
            render={<DialogClose />}
          />
        </DialogCloseGroup>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>Add time</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody>
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-xs-medium text-secondary">Time spent</span>
                  <input
                    className={FIELD}
                    placeholder="1h 30m, 45m or 1.5"
                    value={duration}
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to type a duration
                    autoFocus
                    onChange={(e) => setDuration(e.target.value)}
                  />
                  <span className="flex flex-wrap gap-1.5">
                    {QUICK.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={`rounded-md border px-2 py-0.5 text-body-xs-medium ${
                          duration === q
                            ? "border-accent-strong text-accent-primary"
                            : "border-subtle text-secondary hover:bg-layer-1"
                        }`}
                        onClick={() => setDuration(q)}
                      >
                        {q}
                      </button>
                    ))}
                    {minutes !== null && minutes > 0 && !QUICK.includes(duration) && (
                      <span className="self-center text-body-xs-regular text-tertiary">= {formatMinutes(minutes)}</span>
                    )}
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-xs-medium text-secondary">Date</span>
                  <input
                    type="date"
                    className={FIELD}
                    value={day}
                    max={toIsoDay(new Date())}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-xs-medium text-secondary">Note (optional)</span>
                  <input
                    className={FIELD}
                    placeholder="What did you work on?"
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {error && <p className="text-body-sm-regular text-danger-primary">{error}</p>}
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button variant="secondary" size="md" stretch="auto" label="Cancel" onClick={onClose} />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              label={busy ? "Logging…" : "Log time"}
              disabled={busy}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
