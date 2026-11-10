# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Connecting Slack users to Vynk accounts for the Slack bot.

Flow: the bot asks for a signed connect code for a Slack user and sends them a link to
/slack/connect/<code>. They sign in (or sign up) on Vynk, pick a workspace, and Vynk stores a
SlackAccountLink with a personal API token. The bot then looks the link up and acts as that person.
"""

# Python imports
import hmac
import re

# Django imports
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone

# Module imports
from plane.db.models import APIToken, SlackAccountLink, WorkspaceMember

CONNECT_SALT = "plane.slack.connect"
ADMIN_ROLE = 20
CONNECT_MAX_AGE = 60 * 60  # a connect link works for an hour
TOKEN_LABEL = "Slack bot"
_SLACK_ID = re.compile(r"^[A-Z0-9]{2,32}$")


class SlackLinkError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def bot_secret_ok(value):
    """True when the request carries the shared secret the Slack bot is configured with."""
    secret = getattr(settings, "SLACK_BOT_SECRET", "") or ""
    return bool(secret) and bool(value) and hmac.compare_digest(str(value), secret)


def _clean_ids(team_id, user_id):
    team_id, user_id = str(team_id or "").strip(), str(user_id or "").strip()
    if not _SLACK_ID.match(team_id) or not _SLACK_ID.match(user_id):
        raise SlackLinkError("A Slack team id and user id are required.")
    return team_id, user_id


def make_connect_code(team_id, user_id):
    team_id, user_id = _clean_ids(team_id, user_id)
    return signing.dumps({"t": team_id, "u": user_id}, salt=CONNECT_SALT, compress=False)


def read_connect_code(code):
    """The (team_id, user_id) a connect code was made for; raises SlackLinkError when bad or expired."""
    try:
        data = signing.loads(code, salt=CONNECT_SALT, max_age=CONNECT_MAX_AGE)
    except signing.SignatureExpired:
        raise SlackLinkError("This link has expired. Ask the Vynk bot in Slack for a new one.", 410)
    except signing.BadSignature:
        raise SlackLinkError("This link isn't valid. Ask the Vynk bot in Slack for a new one.", 400)
    return _clean_ids(data.get("t"), data.get("u"))


def active_membership(user, slug):
    return (
        WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True)
        .select_related("workspace")
        .first()
    )


def _usable_token(token, user):
    """Deleting the token in Profile settings (a soft delete) or deactivating it disconnects Slack."""
    return (
        token is not None
        and token.deleted_at is None
        and token.is_active
        and token.user_id == user.id
        and (token.expired_at is None or token.expired_at > timezone.now())
    )


@transaction.atomic
def connect(team_id, user_id, user, slug):
    """Link the Slack user to `user` in workspace `slug` (creating or moving the link)."""
    membership = active_membership(user, slug)
    if membership is None:
        raise SlackLinkError("You aren't a member of that workspace.", 403)

    link = SlackAccountLink.objects.select_for_update().filter(slack_team_id=team_id, slack_user_id=user_id).first()
    token = link.api_token if link else None
    if not _usable_token(token, user):
        token = APIToken.objects.create(
            user=user,
            label=TOKEN_LABEL,
            description="Used by the Vynk Slack bot to act as you. Delete it to disconnect Slack.",
            user_type=0,
        )

    if link is None:
        link = SlackAccountLink(slack_team_id=team_id, slack_user_id=user_id)
    link.user = user
    link.workspace = membership.workspace
    link.api_token = token
    link.save()
    return link


def find_link(team_id, user_id):
    """The working link for a Slack user, or None (also None when the token or membership is gone)."""
    team_id, user_id = _clean_ids(team_id, user_id)
    link = (
        SlackAccountLink.objects.filter(slack_team_id=team_id, slack_user_id=user_id)
        .select_related("user", "workspace", "api_token")
        .first()
    )
    if link is None or not link.user.is_active or not _usable_token(link.api_token, link.user):
        return None
    if active_membership(link.user, link.workspace.slug) is None:
        return None
    return link


def link_to_dict(link, with_token=False):
    user = link.user
    # The bot can't list members unless the person is an admin, so it gets their role from here.
    membership = active_membership(user, link.workspace.slug)
    role = membership.role if membership else None
    full_name = " ".join(part for part in (user.first_name, user.last_name) if part)
    data = {
        "slack_team_id": link.slack_team_id,
        "slack_user_id": link.slack_user_id,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name or full_name or user.email,
            "role": role,
            "admin": role == ADMIN_ROLE,
        },
        "workspace": {"slug": link.workspace.slug, "name": link.workspace.name},
    }
    if with_token:
        data["api_token"] = link.api_token.token
    return data


def all_links():
    links = SlackAccountLink.objects.select_related("user", "workspace", "api_token")
    return [
        link
        for link in links
        if link.user.is_active
        and _usable_token(link.api_token, link.user)
        and active_membership(link.user, link.workspace.slug) is not None
    ]
