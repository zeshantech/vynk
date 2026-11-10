/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
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
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { CalendarOutline, CloseOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
// hooks
import { useUserProfile } from "@/hooks/store/user";
// services
import { timeEntryService } from "@/services/time-entry.service";
// local
import { DurationField } from "./duration-field";
import { formatMinutes, fromIsoDay, parseDuration, toIsoDay } from "./utils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onLogged: () => void;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
};

/** "Add time" for one work item: duration (with quick picks), day and an optional note. */
export const LogTimeDialog = observer(function LogTimeDialog({
  isOpen,
  onClose,
  onLogged,
  workspaceSlug,
  projectId,
  issueId,
}: Props) {
  const { data: profile } = useUserProfile();
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
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption-md-medium text-tertiary">Time spent</span>
                  <DurationField value={duration} onChange={setDuration} focusOnOpen />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption-md-medium text-tertiary">Day</span>
                  <DateSelect
                    variant="select-md"
                    value={fromIsoDay(day)}
                    onChange={(d) => d && setDay(toIsoDay(d))}
                    maxDate={new Date()}
                    icon={<CalendarOutline />}
                    weekStartsOn={profile?.start_of_the_week}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption-md-medium text-tertiary">Note (optional)</span>
                  <InputGroup size="md">
                    <Input
                      size="md"
                      placeholder="What did you work on?"
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </InputGroup>
                </div>
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
              label={minutes ? `Log ${formatMinutes(minutes)}` : "Log time"}
              loading={busy}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
});
