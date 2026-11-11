# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models.workspace import WorkspaceHomePreference


@pytest.mark.contract
class TestHomePreferences:
    @pytest.mark.django_db
    def test_time_tracking_is_a_home_widget_and_starts_on_top(self, session_client, workspace):
        res = session_client.get(f"/api/workspaces/{workspace.slug}/home-preferences/")
        assert res.status_code == status.HTTP_200_OK
        by_key = {p["key"]: p for p in res.data}
        assert {"quick_links", "recents", "my_stickies", "time_tracking"} <= set(by_key)
        assert by_key["time_tracking"]["is_enabled"] is True
        assert by_key["time_tracking"]["sort_order"] > max(
            p["sort_order"] for key, p in by_key.items() if key != "time_tracking"
        )

    @pytest.mark.django_db
    def test_time_tracking_can_be_hidden_and_stays_hidden(self, session_client, workspace):
        base = f"/api/workspaces/{workspace.slug}/home-preferences/"
        session_client.get(base)
        res = session_client.patch(f"{base}time_tracking/", {"is_enabled": False}, format="json")
        assert res.status_code == status.HTTP_200_OK
        again = {p["key"]: p for p in session_client.get(base).data}
        assert again["time_tracking"]["is_enabled"] is False
        assert WorkspaceHomePreference.objects.filter(key="time_tracking").count() == 1
