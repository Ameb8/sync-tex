from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from handlers import router
from models import Base, engine
import os

# Create tables (optional, use Alembic in production)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Users Service")

# CORS
# CORS — allow requests from frontend + other services
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost",
        "http://nginx",
        os.getenv("FRONTEND_URL", "http://localhost")
    ],
)

# Mount router with /auth prefix
app.include_router(router, prefix="/auth")

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)


