# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.utils.slack_link import (
    SlackLinkError,
    all_links,
    bot_secret_ok,
    find_link,
    link_to_dict,
    make_connect_code,
)

SECRET_HEADER = "X-Slack-Bot-Secret"


class IsSlackBot(BasePermission):
    """Only the Slack bot, which sends the shared SLACK_BOT_SECRET, may call these endpoints."""

    def has_permission(self, request, view):
        return bot_secret_ok(request.headers.get(SECRET_HEADER))


class SlackBotBaseView(APIView):
    authentication_classes = []
    permission_classes = [IsSlackBot]


class SlackConnectCodeEndpoint(SlackBotBaseView):
    """A signed code for the /slack/connect/<code> page, made for one Slack user."""

    def post(self, request):
        try:
            code = make_connect_code(request.data.get("team_id"), request.data.get("user_id"))
        except SlackLinkError as err:
            return Response({"error": err.message}, status=err.status)
        return Response({"code": code}, status=status.HTTP_200_OK)


class SlackLinkEndpoint(SlackBotBaseView):
    """The connected Vynk account (and its API token) for one Slack user, or 404 when not connected."""

    def get(self, request):
        try:
            link = find_link(request.query_params.get("team_id"), request.query_params.get("user_id"))
        except SlackLinkError as err:
            return Response({"error": err.message}, status=err.status)
        if link is None:
            return Response({"error": "not_connected"}, status=status.HTTP_404_NOT_FOUND)
        return Response(link_to_dict(link, with_token=True), status=status.HTTP_200_OK)


class SlackLinkListEndpoint(SlackBotBaseView):
    """Every working link, for the bot's weekly reminders."""

    def get(self, request):
        return Response([link_to_dict(link, with_token=True) for link in all_links()], status=status.HTTP_200_OK)
