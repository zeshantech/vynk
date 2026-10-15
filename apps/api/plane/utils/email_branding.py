# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django import template
from django.conf import settings

register = template.Library()

_LOGOS = {"dark": "logo-dark.png", "white": "logo-white.png"}


@register.simple_tag
def brand_logo_url(variant="dark"):
    """Absolute URL of the Vynk logo for emails, served from the web app's (APP_BASE_URL) /brand/ public folder.

    `dark` is the black logo (for light backgrounds), `white` is for dark backgrounds.
    """
    base = (getattr(settings, "APP_BASE_URL", None) or getattr(settings, "WEB_URL", None) or "").rstrip("/")
    return f"{base}/brand/{_LOGOS.get(variant, _LOGOS['dark'])}"
