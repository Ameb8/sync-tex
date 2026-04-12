from fastapi import FastAPI
from app.llm.router import router as llm_router

app = FastAPI(title="SyncTeX Assistant Service")


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(llm_router)