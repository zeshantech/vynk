# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.app.permissions import WorkSpaceBasePermission
from plane.db.models import Issue
from plane.utils.time_entry import (
    TimeEntryError,
    acting_for,
    create_entry,
    entries_between,
    entry_to_dict,
    loggable_projects,
    open_tasks,
    parse_day,
    parse_minutes,
    project_to_dict,
    task_to_dict,
)
from plane.db.models.time_entry import today


def _error(err):
    return Response({"error": err.message}, status=err.status)


class TimeEntryListCreateAPIEndpoint(BaseAPIView):
    """Log time, or list it for a date range. The Slack bot uses this with a workspace admin's API key."""

    permission_classes = [WorkSpaceBasePermission]

    def get(self, request, slug):
        try:
            entries = entries_between(
                viewer=request.user,
                slug=slug,
                start=parse_day(request.query_params.get("from")),
                end=parse_day(request.query_params.get("to")),
                user_id=request.query_params.get("user_id"),
                project_id=request.query_params.get("project_id"),
            )
        except TimeEntryError as err:
            return _error(err)
        return Response([entry_to_dict(e) for e in entries], status=status.HTTP_200_OK)

    def post(self, request, slug):
        issue = get_object_or_404(Issue, id=request.data.get("issue_id"), workspace__slug=slug)
        try:
            entry = create_entry(
                actor=request.user,
                slug=slug,
                issue=issue,
                minutes=parse_minutes(request.data.get("minutes", request.data.get("duration"))),
                spent_on=parse_day(request.data.get("spent_on"), default=today()),
                comment=request.data.get("comment", ""),
                user_id=request.data.get("user_id"),
            )
        except TimeEntryError as err:
            return _error(err)
        return Response({"id": str(entry.id)}, status=status.HTTP_201_CREATED)


class TimeEntryProjectsAPIEndpoint(BaseAPIView):
    permission_classes = [WorkSpaceBasePermission]

    def get(self, request, slug):
        try:
            user_id = acting_for(request.user, slug, request.query_params.get("user_id"))
        except TimeEntryError as err:
            return _error(err)
        return Response([project_to_dict(p) for p in loggable_projects(user_id, slug)], status=status.HTTP_200_OK)


class TimeEntryTasksAPIEndpoint(BaseAPIView):
    permission_classes = [WorkSpaceBasePermission]

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
