from typing import AsyncIterator
from google import genai
from google.genai import types

from .base import LLMClient, LLMResponse

# Map of provider model names to Gemini model IDs
# User can override via preferred_model in settings
DEFAULT_MODEL = "gemini-2.5-flash-lite"


def _to_gemini_messages(messages: list[dict]) -> tuple[str | None, list[types.Content]]:
    """
    Convert generic message format to Gemini's Content format.
    Gemini handles system prompt separately from the conversation.
    Returns (system_instruction, contents).
    """
    system_instruction = None
    contents = []

    for msg in messages:
        role = msg["role"]
        content = msg["content"]

        if role == "system":
            system_instruction = content
            continue

        # Gemini uses "user" and "model" (not "assistant")
        gemini_role = "model" if role == "assistant" else "user"
        contents.append(
            types.Content(
                role=gemini_role,
                parts=[types.Part(text=content)],
            )
        )

    return system_instruction, contents


class GeminiClient(LLMClient):

    def __init__(self, api_key: str, model: str = DEFAULT_MODEL):
        self.model = model
        self.client = genai.Client(api_key=api_key)

    async def chat(
        self,
        messages: list[dict],
        max_tokens: int = 1000,
    ) -> LLMResponse:
        system_instruction, contents = _to_gemini_messages(messages)

        config = types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            system_instruction=system_instruction,
        )

        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=contents,
            config=config,
        )

        return LLMResponse(
            text=response.text,
            tokens_in=response.usage_metadata.prompt_token_count,
            tokens_out=response.usage_metadata.candidates_token_count,
            model=self.model,
        )

    async def stream(
        self,
        messages: list[dict],
        max_tokens: int = 1000,
    ) -> AsyncIterator[str]:
        system_instruction, contents = _to_gemini_messages(messages)

        config = types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            system_instruction=system_instruction,
        )

        async for chunk in await self.client.aio.models.generate_content_stream(
            model=self.model,
            contents=contents,
            config=config,
        ):
            if chunk.text:
                yield chunk.text