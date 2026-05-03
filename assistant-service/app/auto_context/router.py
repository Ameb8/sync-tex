from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.auth import get_current_user_id

from . import crud
from .indexer import index_project

class AutoContextToggle(BaseModel):
    enabled: bool

router = APIRouter()

@router.patch("/projects/{project_id}/auto-context")
async def toggle_auto_context(
    project_id: str,
    body: AutoContextToggle,        # { enabled: bool }
    background_tasks: BackgroundTasks,
    user_id = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    state = await crud.upsert_index_state(db, project_id, user_id, body.enabled)

    if body.enabled and state.status == "idle":
        background_tasks.add_task(index_project, project_id, user_id)

    return state