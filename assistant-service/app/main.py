from fastapi import FastAPI
from contextlib import asynccontextmanager

from app.llm.router import router as llm_router
from app.auto_context.router import router as context_router
from app.core.database import engine
from app.core import setup_logging

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()

app = FastAPI(title="SyncTeX Assistant Service")
setup_logging()

@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(llm_router)
app.include_router(context_router)