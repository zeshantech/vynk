# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views import (
    TimeEntryListCreateAPIEndpoint,
    TimeEntryProjectsAPIEndpoint,
    TimeEntryTasksAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/time-entries/",
        TimeEntryListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="time-entries",
    ),
    path(
        "workspaces/<str:slug>/time-entries/projects/",
        TimeEntryProjectsAPIEndpoint.as_view(http_method_names=["get"]),
        name="time-entry-projects",
    ),
    path(
        "workspaces/<str:slug>/time-entries/tasks/",
        TimeEntryTasksAPIEndpoint.as_view(http_method_names=["get"]),
        name="time-entry-tasks",
    ),
]
