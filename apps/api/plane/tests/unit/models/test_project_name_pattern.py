# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import re

import pytest

from plane.db.models import Project


@pytest.mark.unit
class TestProjectNamePattern:
    @pytest.mark.parametrize("name", ["Fyx - Home Services Platform", "Real_Estate+Ops", "Company Brain", "ATLAS-2"])
    def test_names_may_use_dash_underscore_plus_and_spaces(self, name):
        assert not re.match(Project.FORBIDDEN_NAME_CHARS_PATTERN, name)

    @pytest.mark.parametrize("name", ["A.B", "Acme (EU)", "Q&A", "x@y", "a<b>"])
    def test_other_special_characters_stay_blocked(self, name):
        assert re.match(Project.FORBIDDEN_NAME_CHARS_PATTERN, name)

    @pytest.mark.parametrize("identifier,blocked", [("AB-1", True), ("A+B", True), ("A_B", False), ("ABC", False)])
    def test_identifiers_stay_strict(self, identifier, blocked):
        # an identifier with - or + would break issue keys like ABC-12
        assert bool(re.match(Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN, identifier)) is blocked
