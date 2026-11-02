# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from datetime import date

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel


def today():
    return date.today()


class TimeEntry(ProjectBaseModel):
    """Time a person spent on a work item on a given day (stored in whole minutes)."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="time_entries")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="time_entries")
    minutes = models.PositiveIntegerField()
    spent_on = models.DateField(default=today)
    comment = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        verbose_name = "Time Entry"
        verbose_name_plural = "Time Entries"
        db_table = "time_entries"
        ordering = ("-spent_on", "-created_at")
        indexes = [
            models.Index(fields=["user", "spent_on"], name="time_entry_user_day_idx"),
            models.Index(fields=["workspace", "spent_on"], name="time_entry_ws_day_idx"),
        ]

    def __str__(self):
        return f"{self.user_id} {self.issue_id} {self.minutes}m {self.spent_on}"
