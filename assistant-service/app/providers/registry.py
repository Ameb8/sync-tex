from .base import LLMClient
from .gemini import GeminiClient

# Registry maps provider string to (client_class, default_model)
_REGISTRY = {
    "gemini": (GeminiClient, "gemini-2.5-flash-lite"),
    # "anthropic": (AnthropicClient, "claude-sonnet-4-20250514"),
    # "openai":    (OpenAIClient,    "gpt-4o"),
}


def get_client(provider: str, api_key: str, preferred_model: str | None = None) -> LLMClient:
    """
    Instantiate the right LLM client for the given provider.
    Raises ValueError if the provider is not registered.
    """
    if provider not in _REGISTRY:
        raise ValueError(
            f"Unknown provider '{provider}'. "
            f"Supported providers: {list(_REGISTRY.keys())}"
        )

    client_class, default_model = _REGISTRY[provider]
    model = preferred_model or default_model
    return client_class(api_key=api_key, model=model)


def supported_providers() -> list[str]:
    return list(_REGISTRY.keys())