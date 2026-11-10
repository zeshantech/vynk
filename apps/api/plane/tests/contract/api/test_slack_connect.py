# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import APIToken, SlackAccountLink, Workspace, WorkspaceMember

SECRET = "bot-secret-for-tests"
BOT = {"HTTP_X_SLACK_BOT_SECRET": SECRET}


@pytest.fixture
def bot_secret(settings):
    settings.SLACK_BOT_SECRET = SECRET


@pytest.fixture
def bot():
    return APIClient()


def connect_code(bot, user_id="U123"):
    res = bot.post("/api/v1/slack/connect-code/", {"team_id": "T1", "user_id": user_id}, format="json", **BOT)
    assert res.status_code == status.HTTP_200_OK
    return res.data["code"]


@pytest.mark.contract
class TestSlackConnect:
    @pytest.mark.django_db
    def test_bot_endpoints_need_the_shared_secret(self, bot, bot_secret):
        missing = bot.post("/api/v1/slack/connect-code/", {"team_id": "T1", "user_id": "U1"}, format="json")
        assert missing.status_code == 403
        wrong = {"HTTP_X_SLACK_BOT_SECRET": "nope"}
        assert bot.get("/api/v1/slack/link/?team_id=T1&user_id=U1", **wrong).status_code == 403
        assert bot.get("/api/v1/slack/links/", **wrong).status_code == 403

    @pytest.mark.django_db
    def test_endpoints_are_off_without_a_configured_secret(self, bot, settings):
        settings.SLACK_BOT_SECRET = ""
        res = bot.post("/api/v1/slack/connect-code/", {"team_id": "T1", "user_id": "U1"}, format="json", **BOT)
        assert res.status_code == 403

    @pytest.mark.django_db
    def test_connect_then_the_bot_acts_as_that_person(self, bot, bot_secret, session_client, create_user, workspace):
        assert bot.get("/api/v1/slack/link/?team_id=T1&user_id=U123", **BOT).status_code == 404

        code = connect_code(bot)
        assert session_client.get(f"/api/slack/connect/{code}/").data == {"workspace": None}
        res = session_client.post(f"/api/slack/connect/{code}/", {"workspace_slug": workspace.slug}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["workspace"]["slug"] == workspace.slug
        assert session_client.get(f"/api/slack/connect/{code}/").data["workspace"]["slug"] == workspace.slug

        link = bot.get("/api/v1/slack/link/?team_id=T1&user_id=U123", **BOT)
        assert link.status_code == status.HTTP_200_OK
        assert link.data["user"]["email"] == create_user.email
        assert link.data["workspace"] == {"slug": workspace.slug, "name": workspace.name}
        assert link.data["user"]["admin"] is True

        # the token works on the public API as that person
        as_person = APIClient()
        as_person.credentials(HTTP_X_API_KEY=link.data["api_token"])
        projects = as_person.get(f"/api/v1/workspaces/{workspace.slug}/time-entries/projects/")
        assert projects.status_code == status.HTTP_200_OK

        listed = bot.get("/api/v1/slack/links/", **BOT)
        assert [(i["slack_user_id"], i["workspace"]["slug"]) for i in listed.data] == [("U123", workspace.slug)]

    @pytest.mark.django_db
    def test_switching_workspace_moves_the_link_and_keeps_one_token(
        self, bot, bot_secret, session_client, create_user, workspace
    ):
        other = Workspace.objects.create(name="Other", owner=create_user, slug="other-ws")
        WorkspaceMember.objects.create(workspace=other, member=create_user, role=15)
        code = connect_code(bot)
        session_client.post(f"/api/slack/connect/{code}/", {"workspace_slug": workspace.slug}, format="json")
        session_client.post(f"/api/slack/connect/{code}/", {"workspace_slug": other.slug}, format="json")

        assert SlackAccountLink.objects.count() == 1
        assert APIToken.objects.filter(user=create_user, label="Slack bot").count() == 1
        link = bot.get("/api/v1/slack/link/?team_id=T1&user_id=U123", **BOT)
        assert link.data["workspace"]["slug"] == "other-ws"

    @pytest.mark.django_db
    def test_cannot_connect_to_a_workspace_you_are_not_in(self, bot, bot_secret, session_client, create_user):
        stranger = Workspace.objects.create(name="Not mine", owner=create_user, slug="not-mine")
        code = connect_code(bot)
        res = session_client.post(f"/api/slack/connect/{code}/", {"workspace_slug": stranger.slug}, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert not SlackAccountLink.objects.exists()

    @pytest.mark.django_db
    def test_bad_codes_are_rejected(self, session_client, bot_secret, workspace):
        res = session_client.post("/api/slack/connect/forged:code/", {"workspace_slug": workspace.slug}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "Ask the Vynk bot" in res.data["error"]

    @pytest.mark.django_db
    def test_deleting_the_token_disconnects(self, bot, bot_secret, session_client, create_user, workspace):
        code = connect_code(bot)
        session_client.post(f"/api/slack/connect/{code}/", {"workspace_slug": workspace.slug}, format="json")
        APIToken.objects.filter(user=create_user, label="Slack bot").delete()
        assert bot.get("/api/v1/slack/link/?team_id=T1&user_id=U123", **BOT).status_code == 404

    @pytest.mark.django_db
    def test_a_regular_member_connects_and_the_bot_works_for_them(self, bot, bot_secret, workspace):
        from plane.db.models import User

        member = User.objects.create_user(email="sam@ts.test", password="pw-12345-x", username="sam")
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
        browser = APIClient()
        browser.force_authenticate(user=member)
        code = connect_code(bot, "U777")
        assert (
            browser.post(f"/api/slack/connect/{code}/", {"workspace_slug": workspace.slug}, format="json").status_code
            == 200
        )

        link = bot.get("/api/v1/slack/link/?team_id=T1&user_id=U777", **BOT).data
        assert (link["user"]["email"], link["user"]["role"], link["user"]["admin"]) == ("sam@ts.test", 15, False)
        as_member = APIClient()
        as_member.credentials(HTTP_X_API_KEY=link["api_token"])
        res = as_member.get(f"/api/v1/workspaces/{workspace.slug}/time-entries/?from=2026-03-02&to=2026-03-08")
        assert res.status_code == status.HTTP_200_OK
