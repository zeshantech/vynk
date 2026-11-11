/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerHeaderActions,
  DrawerHeaderContent,
  DrawerHeaderStart,
  DrawerPanel,
  DrawerTitle,
} from "@makeplane/propel/components/drawer";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { AddOutline, CloseOutline } from "@makeplane/propel/icons";
// local
import { LogTimeForm } from "./log-time-form";

type Props = {
  workspaceSlug: string;
  /** Called after time is logged, to refresh whatever is on screen. */
  onLogged: () => void;
  variant?: "primary" | "secondary";
};

/** "Log time" button that opens the log form in a side panel. */
export function LogTimeButton({ workspaceSlug, onLogged, variant = "primary" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size="md"
        stretch="auto"
        label="Log time"
        icon={<Icon icon={AddOutline} />}
        onClick={() => setOpen(true)}
      />
      <Drawer open={open} onOpenChange={setOpen} modal swipeDirection="right">
        <DrawerPanel variant="overlay" side="end" size="sm" backdrop>
          <DrawerHeader>
            <DrawerHeaderStart>
              <DrawerHeaderContent>
                <DrawerTitle>Log time</DrawerTitle>
                <DrawerDescription>Pick a task, say how long, and you&apos;re done.</DrawerDescription>
              </DrawerHeaderContent>
            </DrawerHeaderStart>
            <DrawerHeaderActions side="end">
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Close"
                icon={<Icon icon={CloseOutline} />}
                render={<DrawerClose />}
              />
            </DrawerHeaderActions>
          </DrawerHeader>
          <DrawerBody>
            <LogTimeForm workspaceSlug={workspaceSlug} onLogged={onLogged} onDone={() => setOpen(false)} />
          </DrawerBody>
        </DrawerPanel>
      </Drawer>
    </>
  );
}
