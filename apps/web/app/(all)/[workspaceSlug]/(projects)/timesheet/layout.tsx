/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";

export default function TimesheetLayout() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Outlet />
    </div>
  );
}
