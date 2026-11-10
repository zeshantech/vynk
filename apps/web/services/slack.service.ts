/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TSlackConnection = { workspace: { slug: string; name: string } | null };

/** Connecting a Slack user (identified by the signed code in the bot's link) to this Vynk account. */
export class SlackService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async connection(code: string): Promise<TSlackConnection> {
    return this.get(`/api/slack/connect/${encodeURIComponent(code)}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async connect(code: string, workspaceSlug: string): Promise<TSlackConnection> {
    return this.post(`/api/slack/connect/${encodeURIComponent(code)}/`, { workspace_slug: workspaceSlug })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}

export const slackService = new SlackService();
