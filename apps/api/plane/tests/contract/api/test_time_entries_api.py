# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember

DAY = "2026-03-04"


@pytest.fixture
def board(db, workspace, create_user):
    """The API key's owner (workspace admin) plus a project member and an issue, as the Slack bot sees them."""
    project = Project.objects.create(name="Acme", identifier="ACM", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    member = User.objects.create_user(email="sam@ts.test", password="pw-12345-x", username="sam")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    ProjectMember.objects.create(project=project, member=member, role=15)
    state = State.objects.create(name="Todo", project=project, group="unstarted", default=True)
    issue = Issue.objects.create(name="Write docs", project=project, state=state)
    return {"slug": workspace.slug, "member": member, "issue": issue, "project": project}


@pytest.mark.contract
class TestTimeEntriesApiKey:
    @pytest.mark.django_db
    def test_bot_logs_time_as_a_member_and_reads_it_back(self, api_key_client, board):
        base = f"/api/v1/workspaces/{board['slug']}/time-entries/"
        res = api_key_client.post(
            base,
            {"issue_id": str(board["issue"].id), "user_id": str(board["member"].id), "minutes": 90, "spent_on": DAY},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        listed = api_key_client.get(f"{base}?from={DAY}&to={DAY}&user_id={board['member'].id}")
        assert [(e["user"]["email"], e["minutes"], e["issue"]["key"]) for e in listed.data] == [("sam@ts.test", 90, "ACM-1")]

    @pytest.mark.django_db
    def test_the_24_hour_day_cap_applies_through_the_api(self, api_key_client, board):
        base = f"/api/v1/workspaces/{board['slug']}/time-entries/"
        body = {"issue_id": str(board["issue"].id), "user_id": str(board["member"].id), "spent_on": DAY}
        assert api_key_client.post(base, {**body, "minutes": 23 * 60}, format="json").status_code == 201
        over = api_key_client.post(base, {**body, "minutes": 120}, format="json")
        assert over.status_code == status.HTTP_400_BAD_REQUEST and "24 hours" in over.data["error"]

    @pytest.mark.django_db
    def test_bot_pickers_are_scoped_to_the_person(self, api_key_client, board):
        slug, member = board["slug"], board["member"]
        projects = api_key_client.get(f"/api/v1/workspaces/{slug}/time-entries/projects/?user_id={member.id}")
        assert [p["identifier"] for p in projects.data] == ["ACM"]
        tasks = api_key_client.get(f"/api/v1/workspaces/{slug}/time-entries/tasks/?user_id={member.id}&q=acm-1")
        assert [t["key"] for t in tasks.data] == ["ACM-1"]
        assert api_key_client.get(f"/api/v1/workspaces/{slug}/time-entries/tasks/?assigned=1&user_id={member.id}").data == []

    @pytest.mark.django_db
    def test_requests_without_a_key_are_rejected(self, api_client, board):
        res = api_client.get(f"/api/v1/workspaces/{board['slug']}/time-entries/?from={DAY}&to={DAY}")
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
