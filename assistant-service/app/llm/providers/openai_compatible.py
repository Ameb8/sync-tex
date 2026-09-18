import json
from typing import AsyncIterator

import httpx

from .base import LLMClient, LLMResponse


OPENAI_BASE_URL = "https://api.openai.com/v1"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"


class OpenAICompatibleClient(LLMClient):
    """Adapter for OpenAI's Chat Completions protocol."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._transport = transport

    def _request(self, messages: list[dict], max_tokens: int, *, stream: bool) -> dict:
        return {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": stream,
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {self.api_key}",
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
                f"{self.base_url}/chat/completions",
                json=self._request(messages, max_tokens, stream=False),
            )
            response.raise_for_status()

        body = response.json()
        usage = body.get("usage") or {}
        content = body["choices"][0]["message"].get("content") or ""
        return LLMResponse(
            text=content,
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
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
                f"{self.base_url}/chat/completions",
                json=self._request(messages, max_tokens, stream=True),
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if not data or data == "[DONE]":
                        continue
                    event = json.loads(data)
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    text = (choices[0].get("delta") or {}).get("content")
                    if text:
                        yield text


class OpenAIClient(OpenAICompatibleClient):
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            model=model,
            base_url=OPENAI_BASE_URL,
            transport=transport,
        )

    def _request(self, messages: list[dict], max_tokens: int, *, stream: bool) -> dict:
        request = super()._request(messages, max_tokens, stream=stream)
        request["max_completion_tokens"] = request.pop("max_tokens")
        return request


class DeepSeekClient(OpenAICompatibleClient):
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            model=model,
            base_url=DEEPSEEK_BASE_URL,
            transport=transport,
        )
