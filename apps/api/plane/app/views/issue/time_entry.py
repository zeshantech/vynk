# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Issue, TimeEntry
from plane.utils.time_entry import (
    TimeEntryError,
    can_manage_entry,
    check_day_total,
    create_entry,
    entries_between,
    acting_for,
    entry_to_dict,
    loggable_projects,
    open_tasks,
    project_to_dict,
    task_to_dict,
    parse_day,
    parse_minutes,
)


def _error(err):
    return Response({"error": err.message}, status=err.status)


class IssueTimeEntryEndpoint(BaseAPIView):
    """Time logged on one work item: list it, add to it, edit or remove an entry."""

    def _entries(self, slug, project_id, issue_id):
        return TimeEntry.objects.filter(workspace__slug=slug, project_id=project_id, issue_id=issue_id).select_related(
            "issue", "project", "user"
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        entries = self._entries(slug, project_id, issue_id)
        return Response([entry_to_dict(e) for e in entries], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        issue = get_object_or_404(Issue, id=issue_id, project_id=project_id, workspace__slug=slug)
        try:
            entry = create_entry(
                actor=request.user,
                slug=slug,
                issue=issue,
                minutes=parse_minutes(request.data.get("minutes", request.data.get("duration"))),
                spent_on=parse_day(request.data.get("spent_on"), default=TimeEntry._meta.get_field("spent_on").default()),
                comment=request.data.get("comment", ""),
                user_id=request.data.get("user_id"),
            )
        except TimeEntryError as err:
            return _error(err)
        entry = self._entries(slug, project_id, issue_id).get(id=entry.id)
        return Response(entry_to_dict(entry), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id, pk):
        entry = get_object_or_404(self._entries(slug, project_id, issue_id), pk=pk)
        if not can_manage_entry(request.user, entry, slug):
            return Response({"error": "You can only change your own time."}, status=status.HTTP_403_FORBIDDEN)
        try:
            if "minutes" in request.data or "duration" in request.data:
                entry.minutes = parse_minutes(request.data.get("minutes", request.data.get("duration")))
            if "spent_on" in request.data:
                entry.spent_on = parse_day(request.data.get("spent_on"))
            if "comment" in request.data:
                entry.comment = (request.data.get("comment") or "").strip()[:500]
            check_day_total(entry.user_id, entry.spent_on, entry.minutes, exclude_id=entry.id)
        except TimeEntryError as err:
            return _error(err)
        entry.save(update_fields=["minutes", "spent_on", "comment", "updated_at"])
        return Response(entry_to_dict(entry), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, issue_id, pk):
        entry = get_object_or_404(self._entries(slug, project_id, issue_id), pk=pk)
        if not can_manage_entry(request.user, entry, slug):
            return Response({"error": "You can only remove your own time."}, status=status.HTTP_403_FORBIDDEN)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceTimeEntriesEndpoint(BaseAPIView):
    """The timesheet: entries in a date range. Admins see everyone and can narrow by person or project."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        try:
            start = parse_day(request.query_params.get("from"))
            end = parse_day(request.query_params.get("to"))
            entries = entries_between(
                viewer=request.user,
                slug=slug,
                start=start,
                end=end,
                user_id=request.query_params.get("user_id"),
                project_id=request.query_params.get("project_id"),
            )
        except TimeEntryError as err:
            return _error(err)
        return Response([entry_to_dict(e) for e in entries], status=status.HTTP_200_OK)


class TimeEntryProjectsEndpoint(BaseAPIView):
    """Projects the person can log time in (for the quick-log picker and the Slack bot)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        try:
            user_id = acting_for(request.user, slug, request.query_params.get("user_id"))
        except TimeEntryError as err:
            return _error(err)
        return Response([project_to_dict(p) for p in loggable_projects(user_id, slug)], status=status.HTTP_200_OK)


class TimeEntryTasksEndpoint(BaseAPIView):
    """Open work items to log time on, optionally only the ones assigned to the person."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        params = request.query_params
        try:
            user_id = acting_for(request.user, slug, params.get("user_id"))
        except TimeEntryError as err:
            return _error(err)
        tasks = open_tasks(
            user_id,
            slug,
            project_id=params.get("project_id"),
            query=params.get("q", ""),
            assigned_only=params.get("assigned") in ("1", "true"),
            limit=params.get("limit", 50),
        )
        return Response([task_to_dict(i) for i in tasks], status=status.HTTP_200_OK)
