# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.slack import SlackConnectCodeEndpoint, SlackLinkEndpoint, SlackLinkListEndpoint

urlpatterns = [
    path("slack/connect-code/", SlackConnectCodeEndpoint.as_view(), name="slack-connect-code"),
    path("slack/link/", SlackLinkEndpoint.as_view(), name="slack-link"),
    path("slack/links/", SlackLinkListEndpoint.as_view(), name="slack-links"),
]
