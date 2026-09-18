from dataclasses import dataclass
from typing import Callable

from .base import LLMClient
from .anthropic import AnthropicClient
from .gemini import GeminiClient
from .openai_compatible import DeepSeekClient, OpenAIClient, OpenAICompatibleClient


@dataclass(frozen=True)
class ProviderSpec:
    factory: Callable[..., LLMClient]
    default_model: str
    requires_base_url: bool = False


_REGISTRY: dict[str, ProviderSpec] = {
    "openai": ProviderSpec(OpenAIClient, "gpt-5-mini"),
    "anthropic": ProviderSpec(AnthropicClient, "claude-sonnet-5"),
    "deepseek": ProviderSpec(DeepSeekClient, "deepseek-flash"),
    "gemini": ProviderSpec(GeminiClient, "gemini-2.5-flash-lite"),
    "openai-compatible": ProviderSpec(
        OpenAICompatibleClient,
        "gpt-4o-mini",
        requires_base_url=True,
    ),
}


def get_client(
    provider: str,
    api_key: str,
    preferred_model: str | None = None,
    base_url: str | None = None,
) -> LLMClient:
    """
    Instantiate the right LLM client for the given provider.
    Raises ValueError if the provider is not registered.
    """
    if provider not in _REGISTRY:
        raise ValueError(
            f"Unknown provider '{provider}'. "
            f"Supported providers: {list(_REGISTRY.keys())}"
        )

    spec = _REGISTRY[provider]
    model = preferred_model or spec.default_model
    if spec.requires_base_url:
        if not base_url:
            raise ValueError(f"Provider '{provider}' requires a base URL")
        return spec.factory(api_key=api_key, model=model, base_url=base_url)
    return spec.factory(api_key=api_key, model=model)


def supported_providers() -> list[str]:
    return list(_REGISTRY.keys())
