/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { KeyboardEvent, RefObject } from "react";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { cn } from "@plane/utils";
// local
import { formatMinutes, parseDuration } from "./utils";

export const QUICK_DURATIONS = ["15m", "30m", "1h", "2h", "4h", "8h"];

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  focusOnOpen?: boolean;
};

/** Time spent: type "1h30", "45m" or "1.5", or tap a quick pick. Shows how it was read. */
export function DurationField({ value, onChange, onKeyDown, inputRef, className, focusOnOpen }: Props) {
  const minutes = parseDuration(value);
  const readBack = value && minutes !== null && !QUICK_DURATIONS.includes(value) ? formatMinutes(minutes) : null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <InputGroup size="md">
        <Input
          ref={inputRef}
          size="md"
          placeholder="1h 30m"
          aria-label="Time spent"
          value={value}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- only used where typing a duration is the point
          autoFocus={focusOnOpen}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </InputGroup>
      <div className="flex flex-wrap items-center gap-1">
        {QUICK_DURATIONS.map((q) => (
          <button
            key={q}
            type="button"
            className={cn(
              "rounded-md border px-2 py-0.5 text-caption-md-medium transition-colors",
              value === q
                ? "border-accent-strong bg-accent-subtle text-accent-primary"
                : "border-subtle text-secondary hover:bg-layer-transparent-hover"
            )}
            onClick={() => onChange(q)}
          >
            {q}
          </button>
        ))}
        {readBack && <span className="ml-1 text-caption-md-regular text-tertiary">= {readBack}</span>}
      </div>
    </div>
  );
}
