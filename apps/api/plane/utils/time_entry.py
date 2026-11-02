# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Rules for logging time, shared by the web app endpoints and the public API (used by the Slack bot)."""

# Python imports
import re
from datetime import date, datetime, timedelta

# Django imports
from django.db.models import Sum

# Module imports
from plane.db.models import Issue, Project, ProjectMember, TimeEntry, WorkspaceMember

ADMIN_ROLE = 20
MEMBER_ROLE = 15
MAX_MINUTES_PER_DAY = 24 * 60
MAX_RANGE_DAYS = 93


class TimeEntryError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def is_workspace_admin(user, slug):
    return WorkspaceMember.objects.filter(
        workspace__slug=slug, member=user, role=ADMIN_ROLE, is_active=True
    ).exists()


def parse_minutes(value):
    """Accepts whole minutes (int) or text such as "1h30", "2h", "90m", "1.5"; returns whole minutes."""
    if isinstance(value, bool):
        raise TimeEntryError("Enter a duration such as 1h30 or 45m.")
    if isinstance(value, (int, float)):
        minutes = round(float(value))
    else:
        text = str(value or "").strip().lower().replace(",", ".")
        hours_minutes = re.fullmatch(r"(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*(?:m(?:in(?:ute)?s?)?)?)?", text)
        only_minutes = re.fullmatch(r"(\d+)\s*m(?:in(?:ute)?s?)?", text)
        if hours_minutes:
            minutes = round(float(hours_minutes.group(1)) * 60 + int(hours_minutes.group(2) or 0))
        elif only_minutes:
            minutes = int(only_minutes.group(1))
        elif re.fullmatch(r"\d+(?:\.\d+)?", text):
            minutes = round(float(text) * 60)  # a bare number means hours
        else:
            raise TimeEntryError("Enter a duration such as 1h30 or 45m.")
    if minutes < 1:
        raise TimeEntryError("Time must be at least 1 minute.")
    if minutes > MAX_MINUTES_PER_DAY:
        raise TimeEntryError("A single entry can't be longer than 24 hours.")
    return minutes


def parse_day(value, default=None):
    if not value:
        if default is None:
            raise TimeEntryError("A date is required (YYYY-MM-DD).")
        return default
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        raise TimeEntryError("Dates must look like YYYY-MM-DD.")


def day_minutes(user_id, spent_on, exclude_id=None):
    qs = TimeEntry.objects.filter(user_id=user_id, spent_on=spent_on)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.aggregate(total=Sum("minutes"))["total"] or 0


def check_day_total(user_id, spent_on, minutes, exclude_id=None):
    used = day_minutes(user_id, spent_on, exclude_id)
    if used + minutes > MAX_MINUTES_PER_DAY:
        left = max(MAX_MINUTES_PER_DAY - used, 0)
        raise TimeEntryError(f"That would be more than 24 hours on {spent_on}; {left // 60}h {left % 60}m left that day.")


def can_log_in_project(user_id, project_id):
    return ProjectMember.objects.filter(
        project_id=project_id, member_id=user_id, is_active=True, role__gte=MEMBER_ROLE
    ).exists()


def can_manage_entry(user, entry, slug):
    """The person it belongs to, a project admin, or a workspace admin."""
    if entry.user_id == user.id:
        return True
    if ProjectMember.objects.filter(
        project_id=entry.project_id, member=user, is_active=True, role=ADMIN_ROLE
    ).exists():
        return True
    return is_workspace_admin(user, slug)


def create_entry(*, actor, slug, issue, minutes, spent_on, comment="", user_id=None):
    """Logs time on an issue. Only workspace admins may log for someone else."""
    target_id = user_id or actor.id
    if str(target_id) != str(actor.id) and not is_workspace_admin(actor, slug):
        raise TimeEntryError("Only workspace admins can log time for someone else.", 403)
    if not can_log_in_project(target_id, issue.project_id):
        raise TimeEntryError("You need to be a member of this project to log time on it.", 403)
    check_day_total(target_id, spent_on, minutes)
    return TimeEntry.objects.create(
        issue=issue,
        project_id=issue.project_id,
        user_id=target_id,
        minutes=minutes,
        spent_on=spent_on,
        comment=(comment or "").strip()[:500],
    )


def entries_between(*, viewer, slug, start, end, user_id=None, project_id=None):
    """Entries in [start, end]. Admins see everyone (optionally one person); others only their own."""
    if (end - start) > timedelta(days=MAX_RANGE_DAYS):
        raise TimeEntryError(f"Choose a range of at most {MAX_RANGE_DAYS} days.")
    qs = TimeEntry.objects.filter(workspace__slug=slug, spent_on__gte=start, spent_on__lte=end).select_related(
        "issue", "project", "user"
    )
    if is_workspace_admin(viewer, slug):
        if user_id:
            qs = qs.filter(user_id=user_id)
    else:
        qs = qs.filter(user=viewer)
    if project_id:
        qs = qs.filter(project_id=project_id)
    return qs.order_by("spent_on", "created_at")


def entry_to_dict(e):
    return {
        "id": str(e.id),
        "minutes": e.minutes,
        "spent_on": e.spent_on.isoformat(),
        "comment": e.comment,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "user": {
            "id": str(e.user_id),
            "display_name": e.user.display_name,
            "email": e.user.email,
            "avatar_url": getattr(e.user, "avatar_url", None),
        },
        "project": {"id": str(e.project_id), "name": e.project.name, "identifier": e.project.identifier},
        "issue": {
            "id": str(e.issue_id),
            "name": e.issue.name,
            "sequence_id": e.issue.sequence_id,
            "key": f"{e.project.identifier}-{e.issue.sequence_id}",
        },
    }


def loggable_projects(user_id, slug):
    """Projects the person is a (non-guest) member of, where they can log time."""
    ids = ProjectMember.objects.filter(
        workspace__slug=slug,
        member_id=user_id,
        is_active=True,
        role__gte=MEMBER_ROLE,
        project__archived_at__isnull=True,
    ).values_list("project_id", flat=True)
    return Project.objects.filter(id__in=ids).order_by("name")


def open_tasks(user_id, slug, *, project_id=None, query="", assigned_only=False, limit=50):
    """Open work items the person could log time on, newest activity first."""
    qs = Issue.issue_objects.filter(workspace__slug=slug, project__in=loggable_projects(user_id, slug)).exclude(
        state__group__in=["completed", "cancelled"]
    )
    if project_id:
        qs = qs.filter(project_id=project_id)
    if assigned_only:
        qs = qs.filter(assignees=user_id)
    query = (query or "").strip()
    if query:
        key = re.fullmatch(r"([A-Za-z0-9]+)-(\d+)", query)
        if key:
            qs = qs.filter(project__identifier__iexact=key.group(1), sequence_id=int(key.group(2)))
        else:
            qs = qs.filter(name__icontains=query)
    return qs.select_related("project").distinct().order_by("-updated_at")[: min(int(limit), 200)]


def task_to_dict(i):
    return {
        "id": str(i.id),
        "name": i.name,
        "sequence_id": i.sequence_id,
        "key": f"{i.project.identifier}-{i.sequence_id}",
        "project": {"id": str(i.project_id), "name": i.project.name, "identifier": i.project.identifier},
    }


def project_to_dict(p):
    return {"id": str(p.id), "name": p.name, "identifier": p.identifier}


def acting_for(request_user, slug, user_id):
    """The person a lookup is for: yourself, or (workspace admins only) someone else."""
    if user_id and str(user_id) != str(request_user.id):
        if not is_workspace_admin(request_user, slug):
            raise TimeEntryError("Only workspace admins can look this up for someone else.", 403)
        return user_id
    return request_user.id
