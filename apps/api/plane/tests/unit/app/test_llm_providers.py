# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import MagicMock, patch

import pytest

from plane.app.views.external import base
from plane.app.views.external.base import SUPPORTED_PROVIDERS, get_llm_config, get_llm_response

CONFIG_FN = "plane.app.views.external.base.get_configuration_value"


@pytest.mark.unit
class TestGetLLMConfig:
    """get_llm_config resolves (api_key, model, provider) from instance config"""

    def test_groq_is_a_supported_provider(self):
        assert "groq" in SUPPORTED_PROVIDERS

    def test_groq_uses_its_default_model_when_none_set(self):
        with patch(CONFIG_FN, return_value=["gsk_key", "groq", None]):
            assert get_llm_config() == ("gsk_key", "llama-3.3-70b-versatile", "groq")

    def test_groq_accepts_any_model_id(self):
        # Groq renames models often, so a model outside the built-in list must not be rejected
        with patch(CONFIG_FN, return_value=["gsk_key", "groq", "openai/gpt-oss-20b"]):
            assert get_llm_config() == ("gsk_key", "openai/gpt-oss-20b", "groq")

    def test_provider_name_is_case_insensitive(self):
        with patch(CONFIG_FN, return_value=["gsk_key", "Groq", None]):
            assert get_llm_config()[2] == "Groq"

    def test_openai_still_rejects_unknown_models(self):
        with patch(CONFIG_FN, return_value=["sk-key", "openai", "not-a-model"]):
            assert get_llm_config() == (None, None, None)

    def test_missing_api_key_is_rejected(self):
        with patch(CONFIG_FN, return_value=[None, "groq", None]):
            assert get_llm_config() == (None, None, None)

    def test_unknown_provider_is_rejected(self):
        with patch(CONFIG_FN, return_value=["key", "nope", None]):
            assert get_llm_config() == (None, None, None)


@pytest.mark.unit
class TestGetLLMResponse:
    """get_llm_response points the OpenAI-compatible client at the provider's endpoint"""

    def _run(self, provider):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="hi"))]
        with patch.object(base, "OpenAI", return_value=client) as openai_cls:
            result = get_llm_response("task", "prompt", "key", "some-model", provider)
        return result, openai_cls

    def test_groq_uses_the_groq_base_url(self):
        result, openai_cls = self._run("groq")
        assert result == ("hi", None)
        openai_cls.assert_called_once_with(api_key="key", base_url="https://api.groq.com/openai/v1")

    def test_openai_keeps_the_default_endpoint(self):
        _, openai_cls = self._run("openai")
        openai_cls.assert_called_once_with(api_key="key", base_url=None)
