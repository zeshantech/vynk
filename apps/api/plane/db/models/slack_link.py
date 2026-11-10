# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .base import BaseModel


class SlackAccountLink(BaseModel):
    """A Slack user connected to a Vynk account, and the workspace the Slack bot works in for them."""

    slack_team_id = models.CharField(max_length=32)
    slack_user_id = models.CharField(max_length=32)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="slack_links")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="slack_links")
    # The personal API token the bot uses to act as this person.
    api_token = models.ForeignKey("db.APIToken", on_delete=models.SET_NULL, null=True, related_name="slack_links")

    class Meta:
        verbose_name = "Slack Account Link"
        verbose_name_plural = "Slack Account Links"
        db_table = "slack_account_links"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["slack_team_id", "slack_user_id"],
                condition=models.Q(deleted_at__isnull=True),
                name="slack_account_link_unique_slack_user_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.slack_team_id}/{self.slack_user_id} -> {self.user_id}"
