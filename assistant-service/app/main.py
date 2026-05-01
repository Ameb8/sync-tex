from fastapi import FastAPI
from app.llm.router import router as llm_router
from app.core import setup_logging

app = FastAPI(title="SyncTeX Assistant Service")
setup_logging()

@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(llm_router)