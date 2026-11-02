# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date, timedelta

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember
from plane.utils.time_entry import TimeEntryError, parse_minutes

DAY = "2026-03-04"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user(email):
    return User.objects.create_user(email=email, password="pw-12345-x", username=email.split("@")[0])


@pytest.fixture
def setup(db, workspace, create_user):
    """Workspace admin (create_user), a project member, a project guest and an outsider on one issue."""
    project = Project.objects.create(name="Acme", identifier="ACM", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    members = {}
    for name, role in (("member", 15), ("guest", 5), ("outsider", None)):
        user = _user(f"{name}@ts.test")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        if role:
            ProjectMember.objects.create(project=project, member=user, role=role)
        members[name] = user
    state = State.objects.create(name="Todo", project=project, group="unstarted", default=True)
    issue = Issue.objects.create(name="Write docs", project=project, state=state)
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/time-entries/"
    return {"admin": create_user, **members, "workspace": workspace, "project": project, "issue": issue, "url": url}


@pytest.mark.unit
class TestParseMinutes:
    @pytest.mark.parametrize(
        "text,expected",
        [("1h30", 90), ("2h", 120), ("45m", 45), ("1h 15m", 75), ("1.5", 90), (30, 30), ("0,5h", 30)],
    )
    def test_accepts(self, text, expected):
        assert parse_minutes(text) == expected

    @pytest.mark.parametrize("text", ["", "abc", "0", "25h", "-1h", None])
    def test_rejects(self, text):
        with pytest.raises(TimeEntryError):
            parse_minutes(text)


@pytest.mark.contract
class TestIssueTimeEntries:
    @pytest.mark.django_db
    def test_member_logs_and_lists_time(self, setup):
        client = _client(setup["member"])
        res = client.post(setup["url"], {"minutes": "1h30", "spent_on": DAY, "comment": "docs"}, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["minutes"] == 90 and res.data["issue"]["key"] == "ACM-1"
        listed = client.get(setup["url"])
        assert [e["minutes"] for e in listed.data] == [90]

    @pytest.mark.django_db
    def test_a_day_can_not_exceed_24_hours(self, setup):
        client = _client(setup["member"])
        assert client.post(setup["url"], {"minutes": "20h", "spent_on": DAY}, format="json").status_code == 201
        res = client.post(setup["url"], {"minutes": "5h", "spent_on": DAY}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST and "24 hours" in res.data["error"]
        assert client.post(setup["url"], {"minutes": "4h", "spent_on": DAY}, format="json").status_code == 201
        # another day is unaffected
        other = (date.fromisoformat(DAY) + timedelta(days=1)).isoformat()
        assert client.post(setup["url"], {"minutes": "5h", "spent_on": other}, format="json").status_code == 201

    @pytest.mark.django_db
    def test_non_members_and_guests_can_not_log(self, setup):
        for who in ("guest", "outsider"):
            res = _client(setup[who]).post(setup["url"], {"minutes": "1h", "spent_on": DAY}, format="json")
            assert res.status_code == status.HTTP_403_FORBIDDEN, who

    @pytest.mark.django_db
    def test_only_admins_log_for_someone_else(self, setup):
        body = {"minutes": "1h", "spent_on": DAY, "user_id": str(setup["member"].id)}
        assert _client(setup["member"]).post(setup["url"], {**body, "user_id": str(setup["admin"].id)}, format="json").status_code == 403
        res = _client(setup["admin"]).post(setup["url"], body, format="json")
        assert res.status_code == 201 and res.data["user"]["id"] == str(setup["member"].id)
        # still the admin's responsibility not to log someone into a project they are not in
        bad = _client(setup["admin"]).post(setup["url"], {**body, "user_id": str(setup["outsider"].id)}, format="json")
        assert bad.status_code == 403

    @pytest.mark.django_db
    def test_edit_and_delete_belong_to_the_owner_or_an_admin(self, setup):
        entry = _client(setup["member"]).post(setup["url"], {"minutes": "1h", "spent_on": DAY}, format="json").data
        detail = f"{setup['url']}{entry['id']}/"
        assert _client(setup["admin"]).patch(detail, {"minutes": "2h"}, format="json").data["minutes"] == 120
        # a different member may not touch it
        other = _user("other@ts.test")
        WorkspaceMember.objects.create(workspace=setup["workspace"], member=other, role=15)
        ProjectMember.objects.create(project=setup["project"], member=other, role=15)
        assert _client(other).patch(detail, {"minutes": "3h"}, format="json").status_code == 403
        assert _client(other).delete(detail).status_code == 403
        assert _client(setup["member"]).delete(detail).status_code == 204
        assert _client(setup["member"]).get(setup["url"]).data == []


@pytest.mark.contract
class TestTimesheet:
    def _log(self, setup, who, minutes, day=DAY):
        res = _client(setup[who]).post(setup["url"], {"minutes": minutes, "spent_on": day}, format="json")
        assert res.status_code == 201, res.data

    @pytest.mark.django_db
    def test_members_see_their_own_admins_see_everyone(self, setup):
        self._log(setup, "member", "2h")
        self._log(setup, "admin", "3h")
        base = f"/api/workspaces/{setup['workspace'].slug}/time-entries/?from={DAY}&to={DAY}"
        mine = _client(setup["member"]).get(base)
        assert [e["user"]["id"] for e in mine.data] == [str(setup["member"].id)]
        everyone = _client(setup["admin"]).get(base)
        assert sorted(e["minutes"] for e in everyone.data) == [120, 180]
        only = _client(setup["admin"]).get(f"{base}&user_id={setup['member'].id}")
        assert [e["minutes"] for e in only.data] == [120]
        # a member can't peek at someone else by passing user_id
        sneaky = _client(setup["member"]).get(f"{base}&user_id={setup['admin'].id}")
        assert [e["user"]["id"] for e in sneaky.data] == [str(setup["member"].id)]

    @pytest.mark.django_db
    def test_range_is_validated(self, setup):
        base = f"/api/workspaces/{setup['workspace'].slug}/time-entries/"
        client = _client(setup["admin"])
        assert client.get(f"{base}?from={DAY}").status_code == 400
        assert client.get(f"{base}?from=2026-01-01&to=2026-12-31").status_code == 400

    @pytest.mark.django_db
    def test_pickers_only_offer_projects_and_tasks_the_person_can_log_on(self, setup):
        slug = setup["workspace"].slug
        member = _client(setup["member"])
        projects = member.get(f"/api/workspaces/{slug}/time-entries/projects/")
        assert [p["identifier"] for p in projects.data] == ["ACM"]
        tasks = member.get(f"/api/workspaces/{slug}/time-entries/tasks/?q=ACM-1")
        assert [t["key"] for t in tasks.data] == ["ACM-1"]
        assert _client(setup["outsider"]).get(f"/api/workspaces/{slug}/time-entries/tasks/").data == []
        assert member.get(f"/api/workspaces/{slug}/time-entries/tasks/?user_id={setup['admin'].id}").status_code == 403
