/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TTimeEntry = {
  id: string;
  minutes: number;
  spent_on: string;
  comment: string;
  created_at: string | null;
  user: { id: string; display_name: string; email: string; avatar_url: string | null };
  project: { id: string; name: string; identifier: string };
  issue: { id: string; name: string; sequence_id: number; key: string };
};

export type TTimeTask = {
  id: string;
  name: string;
  sequence_id: number;
  key: string;
  project: { id: string; name: string; identifier: string };
};

export type TTimeProject = { id: string; name: string; identifier: string };

export type TNewTimeEntry = { minutes: string; spent_on: string; comment?: string };

const messageOf = (error: unknown): never => {
  const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
  throw new Error(data?.error ?? "Something went wrong. Please try again.");
};

export class TimeEntryService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async forIssue(slug: string, projectId: string, issueId: string): Promise<TTimeEntry[]> {
    return this.get(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/`)
      .then((r) => r.data)
      .catch(messageOf);
  }

  async log(slug: string, projectId: string, issueId: string, data: TNewTimeEntry): Promise<TTimeEntry> {
    return this.post(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/`, data)
      .then((r) => r.data)
      .catch(messageOf);
  }

  async remove(slug: string, projectId: string, issueId: string, id: string): Promise<void> {
    return this.delete(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/${id}/`)
      .then(() => undefined)
      .catch(messageOf);
  }

  async between(
    slug: string,
    params: { from: string; to: string; user_id?: string; project_id?: string }
  ): Promise<TTimeEntry[]> {
    return this.get(`/api/workspaces/${slug}/time-entries/`, { params })
      .then((r) => r.data)
      .catch(messageOf);
  }

  async projects(slug: string): Promise<TTimeProject[]> {
    return this.get(`/api/workspaces/${slug}/time-entries/projects/`)
      .then((r) => r.data)
      .catch(messageOf);
  }

  async tasks(slug: string, params: { q?: string; project_id?: string; assigned?: string }): Promise<TTimeTask[]> {
    return this.get(`/api/workspaces/${slug}/time-entries/tasks/`, { params })
      .then((r) => r.data)
      .catch(messageOf);
  }
}

export const timeEntryService = new TimeEntryService();
