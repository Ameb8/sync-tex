import voyageai
from typing import Literal

_client: voyageai.AsyncClient | None = None

def get_client() -> voyageai.AsyncClient:
    global _client
    if _client is None:
        _client = voyageai.AsyncClient()  # reads VOYAGE_API_KEY from env
    return _client


InputType = Literal["document", "query"]

async def embed(texts: list[str], input_type: InputType) -> list[list[float]]:
    """
    Embed a list of texts. Use input_type="document" for indexing,
    "query" for user prompt embedding at retrieval time.
    """
    if not texts:
        return []

    client = get_client()
    result = await client.embed(
        texts,
        model="voyage-4-large",
        input_type=input_type,
    )
    return result.embeddings


async def embed_document(texts: list[str]) -> list[list[float]]:
    return await embed(texts, input_type="document")


async def embed_query(text: str) -> list[float]:
    embeddings = await embed([text], input_type="query")
    return embeddings[0]