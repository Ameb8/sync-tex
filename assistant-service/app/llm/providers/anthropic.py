import json
from typing import AsyncIterator

import httpx

from .base import LLMClient, LLMResponse


ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"


def _to_anthropic_messages(messages: list[dict]) -> tuple[str | None, list[dict]]:
    system_parts: list[str] = []
    conversation: list[dict] = []
    for message in messages:
        if message["role"] == "system":
            system_parts.append(message["content"])
        else:
            conversation.append(message)
    return "\n\n".join(system_parts) or None, conversation


class AnthropicClient(LLMClient):
    """Adapter for Anthropic's Messages API."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self._transport = transport

    def _request(self, messages: list[dict], max_tokens: int, *, stream: bool) -> dict:
        system, conversation = _to_anthropic_messages(messages)
        request = {
            "model": self.model,
            "messages": conversation,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        if system:
            request["system"] = system
        return request

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=ANTHROPIC_BASE_URL,
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": ANTHROPIC_VERSION,
                "Content-Type": "application/json",
            },
            transport=self._transport,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def chat(
        self,
        messages: list[dict],
        max_tokens: int = 1000,
    ) -> LLMResponse:
        async with self._client() as client:
            response = await client.post(
                "messages",
                json=self._request(messages, max_tokens, stream=False),
            )
            response.raise_for_status()

        body = response.json()
        usage = body.get("usage") or {}
        text = "".join(
            block.get("text", "")
            for block in body.get("content", [])
            if block.get("type") == "text"
        )
        return LLMResponse(
            text=text,
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
            model=body.get("model") or self.model,
        )

    async def stream(
        self,
        messages: list[dict],
        max_tokens: int = 1000,
    ) -> AsyncIterator[str]:
        async with self._client() as client:
            async with client.stream(
                "POST",
                "messages",
                json=self._request(messages, max_tokens, stream=True),
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if not data:
                        continue
                    event = json.loads(data)
                    if event.get("type") != "content_block_delta":
                        continue
                    delta = event.get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield delta["text"]
