import asyncio
import importlib
import sys
import types
import unittest
from dataclasses import dataclass
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
MISSING = object()


@dataclass
class FakeProjectFile:
    id: str
    filename: str
    file_type: str
    text_url: str | None = None


class FakeSession:
    def __init__(self, name: str):
        self.name = name
        self.rollbacks = 0
        self.closed = False

    async def rollback(self):
        self.rollbacks += 1


class FakeSessionContext:
    def __init__(self, session: FakeSession):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        self.session.closed = True
        return None


class FakeSessionFactory:
    def __init__(self):
        self.sessions: list[FakeSession] = []

    def __call__(self):
        session = FakeSession(f"s{len(self.sessions) + 1}")
        self.sessions.append(session)
        return FakeSessionContext(session)


def load_indexer_module():
    fake_core = types.ModuleType("app.core")
    fake_core.__path__ = []
    fake_core.get_logger = lambda **kwargs: types.SimpleNamespace(debug=lambda *a, **k: None)

    fake_database = types.ModuleType("app.core.database")
    fake_database.get_async_session = lambda: None

    fake_crud = types.ModuleType("app.auto_context.crud")
    fake_chunker = types.ModuleType("app.auto_context.chunker")
    fake_chunker.chunk_latex = lambda text: []
    fake_chunker.hierarchy_path = lambda chunk: ""

    fake_embeddings = types.ModuleType("app.auto_context.embeddings")

    async def embed_document(texts):
        return [[0.0] for _ in texts]

    fake_embeddings.embed_document = embed_document

    fake_projects_client = types.ModuleType("app.clients.projects_client")
    fake_projects_client.ProjectFile = FakeProjectFile

    async def get_project_files(project_id, *, with_text_urls=True):
        return []

    async def fetch_file_text(text_url):
        return ""

    fake_projects_client.get_project_files = get_project_files
    fake_projects_client.fetch_file_text = fetch_file_text

    patched_modules = {
        "app.core": fake_core,
        "app.core.database": fake_database,
        "app.auto_context.crud": fake_crud,
        "app.auto_context.chunker": fake_chunker,
        "app.auto_context.embeddings": fake_embeddings,
        "app.clients.projects_client": fake_projects_client,
    }

    sys.path.insert(0, str(SERVICE_ROOT))
    target = "app.auto_context.indexer"
    original_target = sys.modules.pop(target, MISSING)
    originals = {
        name: sys.modules.get(name, MISSING)
        for name in patched_modules
    }
    sys.modules.update(patched_modules)

    try:
        module = importlib.import_module(target)
        module.logger = types.SimpleNamespace(
            info=lambda *args, **kwargs: None,
            exception=lambda *args, **kwargs: None,
        )
    finally:
        sys.modules.pop(target, None)
        parent = sys.modules.get("app.auto_context")
        if parent is not None and hasattr(parent, "indexer"):
            delattr(parent, "indexer")

        if original_target is not MISSING:
            sys.modules[target] = original_target

        for name, original in originals.items():
            if original is MISSING:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

        try:
            sys.path.remove(str(SERVICE_ROOT))
        except ValueError:
            pass

    return module


class IndexerAsyncDbTests(unittest.IsolatedAsyncioTestCase):
    async def test_index_project_uses_short_lived_project_sessions(self):
        indexer = load_indexer_module()
        sessions = FakeSessionFactory()
        indexer.get_async_session = sessions

        status_writes = []

        async def set_index_status(db, project_id, status, **kwargs):
            status_writes.append((db.name, project_id, status, kwargs))

        indexer.crud.set_index_status = set_index_status

        async def get_project_files(project_id, *, with_text_urls=True):
            return [
                indexer.ProjectFile("file-1", "one.tex", "tex", "url-1"),
                indexer.ProjectFile("file-skip", "skip.tex", "tex", None),
                indexer.ProjectFile("file-2", "two.tex", "tex", "url-2"),
            ]

        indexer.get_project_files = get_project_files

        tracked_calls = []

        async def tracked(project_id, file, sem):
            tracked_calls.append((project_id, file.id, isinstance(sem, asyncio.Semaphore)))

        indexer._index_file_tracked = tracked

        await indexer.index_project("project-1", "user-1")

        self.assertEqual(
            [(session, status) for session, _, status, _ in status_writes],
            [("s1", "indexing"), ("s2", "idle")],
        )
        self.assertEqual(
            tracked_calls,
            [
                ("project-1", "file-1", True),
                ("project-1", "file-2", True),
            ],
        )

    async def test_file_tasks_use_distinct_sessions_and_isolate_failures(self):
        indexer = load_indexer_module()
        sessions = FakeSessionFactory()
        indexer.get_async_session = sessions
        events = []

        async def upsert_file_index(db, project_id, file_id):
            events.append(("pending", db.name, file_id))

        async def set_file_index_status(
            db,
            project_id,
            file_id,
            status,
            chunk_count=None,
            error_message=None,
        ):
            events.append((status, db.name, file_id, chunk_count, error_message))

        async def index_file(project_id, file, db):
            events.append(("index", db.name, file.id))
            if file.id == "bad":
                raise RuntimeError("download failed")
            return 3

        indexer.crud.upsert_file_index = upsert_file_index
        indexer.crud.set_file_index_status = set_file_index_status
        indexer.index_file = index_file

        sem = asyncio.Semaphore(2)
        good = indexer.ProjectFile("good", "good.tex", "tex", "url-good")
        bad = indexer.ProjectFile("bad", "bad.tex", "tex", "url-bad")

        await asyncio.gather(
            indexer._index_file_tracked("project-1", good, sem),
            indexer._index_file_tracked("project-1", bad, sem),
        )

        self.assertEqual(len(sessions.sessions), 2)
        self.assertEqual({event[1] for event in events if event[0] == "index"}, {"s1", "s2"})
        self.assertIn(("indexed", "s1", "good", 3, None), events)
        self.assertIn(("error", "s2", "bad", None, "download failed"), events)
        self.assertEqual(sessions.sessions[0].rollbacks, 0)
        self.assertEqual(sessions.sessions[1].rollbacks, 1)

    async def test_file_error_status_uses_fresh_session_when_current_session_fails(self):
        indexer = load_indexer_module()
        sessions = FakeSessionFactory()
        indexer.get_async_session = sessions
        error_writes = []

        async def upsert_file_index(db, project_id, file_id):
            return None

        async def index_file(project_id, file, db):
            raise RuntimeError("embed failed")

        async def set_file_index_status(
            db,
            project_id,
            file_id,
            status,
            chunk_count=None,
            error_message=None,
        ):
            error_writes.append((db.name, status, error_message))
            if db.name == "s1" and status == "error":
                raise RuntimeError("transaction is unusable")

        indexer.crud.upsert_file_index = upsert_file_index
        indexer.crud.set_file_index_status = set_file_index_status
        indexer.index_file = index_file

        file = indexer.ProjectFile("file-1", "file.tex", "tex", "url")

        await indexer._index_file_tracked("project-1", file, asyncio.Semaphore(1))

        self.assertEqual(len(sessions.sessions), 2)
        self.assertEqual(sessions.sessions[0].rollbacks, 1)
        self.assertEqual(
            error_writes,
            [
                ("s1", "error", "embed failed"),
                ("s2", "error", "embed failed"),
            ],
        )

    async def test_empty_chunks_delete_existing_chunks(self):
        indexer = load_indexer_module()
        replaced = []

        async def fetch_file_text(text_url):
            return "   \n"

        async def replace_file_chunks(db, project_id, file_id, chunks):
            replaced.append((db, project_id, file_id, chunks))

        indexer.fetch_file_text = fetch_file_text
        indexer.crud.replace_file_chunks = replace_file_chunks

        db = object()
        file = indexer.ProjectFile("file-1", "empty.tex", "tex", "url")

        chunk_count = await indexer.index_file("project-1", file, db)

        self.assertEqual(chunk_count, 0)
        self.assertEqual(replaced, [(db, "project-1", "file-1", [])])


if __name__ == "__main__":
    unittest.main()
