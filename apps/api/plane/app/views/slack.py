# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import SlackAccountLink
from plane.utils.slack_link import SlackLinkError, connect, read_connect_code


class SlackConnectEndpoint(BaseAPIView):
    """The /slack/connect/<code> page: see which workspace the Slack user is connected to, and connect."""

    def get(self, request, code):
        try:
            team_id, user_id = read_connect_code(code)
        except SlackLinkError as err:
            return Response({"error": err.message}, status=err.status)
        link = (
            SlackAccountLink.objects.filter(slack_team_id=team_id, slack_user_id=user_id, user=request.user)
            .select_related("workspace")
            .first()
        )
        workspace = {"slug": link.workspace.slug, "name": link.workspace.name} if link else None
        return Response({"workspace": workspace}, status=status.HTTP_200_OK)

    def post(self, request, code):
        try:
            team_id, user_id = read_connect_code(code)
            link = connect(team_id, user_id, request.user, str(request.data.get("workspace_slug") or ""))
        except SlackLinkError as err:
            return Response({"error": err.message}, status=err.status)
        return Response(
            {"workspace": {"slug": link.workspace.slug, "name": link.workspace.name}},
            status=status.HTTP_200_OK,
        )
