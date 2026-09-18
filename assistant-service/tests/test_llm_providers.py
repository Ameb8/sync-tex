import json

import httpx
import pytest
from pydantic import ValidationError

from app.llm.providers.anthropic import AnthropicClient
from app.llm.providers.openai_compatible import (
    DEEPSEEK_BASE_URL,
    OPENAI_BASE_URL,
    DeepSeekClient,
    OpenAIClient,
    OpenAICompatibleClient,
)
from app.llm.providers.registry import get_client, supported_providers
from app.llm.schemas import LLMKeyUpsert


MESSAGES = [
    {"role": "system", "content": "Be concise."},
    {"role": "user", "content": "Hello"},
]


def test_registry_exposes_all_supported_providers() -> None:
    assert supported_providers() == [
        "openai",
        "anthropic",
        "deepseek",
        "gemini",
        "openai-compatible",
    ]


def test_custom_provider_requires_base_url() -> None:
    with pytest.raises(ValueError, match="requires a base URL"):
        get_client("openai-compatible", "secret")


def test_registry_configures_fixed_provider_endpoints() -> None:
    openai = get_client("openai", "secret")
    deepseek = get_client("deepseek", "secret")

    assert isinstance(openai, OpenAIClient)
    assert openai.base_url == OPENAI_BASE_URL
    assert openai.model == "gpt-5-mini"
    assert isinstance(deepseek, DeepSeekClient)
    assert deepseek.base_url == DEEPSEEK_BASE_URL
    assert deepseek.model == "deepseek-flash"


def test_openai_uses_current_completion_limit_field() -> None:
    client = OpenAIClient(api_key="secret", model="gpt-5-mini")

    request = client._request(MESSAGES, 321, stream=True)

    assert request["max_completion_tokens"] == 321
    assert "max_tokens" not in request


def test_custom_provider_schema_normalizes_base_url() -> None:
    body = LLMKeyUpsert(
        provider="openai-compatible",
        api_key=" secret ",
        base_url="http://llama.internal:8080/v1/",
    )

    assert body.api_key == "secret"
    assert body.base_url == "http://llama.internal:8080/v1"


@pytest.mark.parametrize(
    "base_url",
    ["llama.internal/v1", "ftp://llama.internal", "https://user:pass@example.com"],
)
def test_custom_provider_schema_rejects_unsafe_base_urls(base_url: str) -> None:
    with pytest.raises(ValidationError):
        LLMKeyUpsert(
            provider="openai-compatible",
            api_key="secret",
            base_url=base_url,
        )


@pytest.mark.asyncio
async def test_openai_compatible_chat_uses_custom_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://llama.internal:8080/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer secret"
        payload = json.loads(request.content)
        assert payload == {
            "model": "local-model",
            "messages": MESSAGES,
            "max_tokens": 321,
            "stream": False,
        }
        return httpx.Response(
            200,
            json={
                "model": "local-model",
                "choices": [{"message": {"content": "Hi"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1},
            },
        )

    client = OpenAICompatibleClient(
        api_key="secret",
        model="local-model",
        base_url="http://llama.internal:8080/v1",
        transport=httpx.MockTransport(handler),
    )

    response = await client.chat(MESSAGES, max_tokens=321)

    assert response.text == "Hi"
    assert response.tokens_in == 5
    assert response.tokens_out == 1
    assert response.model == "local-model"


@pytest.mark.asyncio
async def test_openai_compatible_stream_yields_text_deltas() -> None:
    content = b"".join(
        [
            b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            b"data: [DONE]\n\n",
        ]
    )
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=content))
    client = OpenAICompatibleClient(
        api_key="secret",
        model="local-model",
        base_url="http://llama.internal/v1",
        transport=transport,
    )

    chunks = [chunk async for chunk in client.stream(MESSAGES)]

    assert chunks == ["Hel", "lo"]


@pytest.mark.asyncio
async def test_anthropic_chat_extracts_system_prompt() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.anthropic.com/v1/messages"
        assert request.headers["x-api-key"] == "secret"
        payload = json.loads(request.content)
        assert payload["system"] == "Be concise."
        assert payload["messages"] == [{"role": "user", "content": "Hello"}]
        return httpx.Response(
            200,
            json={
                "model": "claude-test",
                "content": [{"type": "text", "text": "Hi"}],
                "usage": {"input_tokens": 5, "output_tokens": 1},
            },
        )

    client = AnthropicClient(
        api_key="secret",
        model="claude-test",
        transport=httpx.MockTransport(handler),
    )

    response = await client.chat(MESSAGES)

    assert response.text == "Hi"
    assert response.tokens_in == 5
    assert response.tokens_out == 1


@pytest.mark.asyncio
async def test_anthropic_stream_yields_text_deltas() -> None:
    content = b"".join(
        [
            b'event: content_block_delta\n',
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
            b'event: content_block_delta\n',
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
            b'event: message_stop\n',
            b'data: {"type":"message_stop"}\n\n',
        ]
    )
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=content))
    client = AnthropicClient(
        api_key="secret",
        model="claude-test",
        transport=transport,
    )

    chunks = [chunk async for chunk in client.stream(MESSAGES)]

    assert chunks == ["Hel", "lo"]
