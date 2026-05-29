import unittest

from app.context.schemas import ContextScope
from app.context.tracker import ContextCandidate, ContextTracker, normalize_path


class ContextTrackerTests(unittest.TestCase):
    def test_full_file_blocks_later_chunk_by_file_id(self):
        tracker = ContextTracker()

        self.assertTrue(tracker.add_if_allowed(ContextCandidate(
            content="full file",
            scope=ContextScope.FULL_FILE,
            source="open_file",
            file_id="file-1",
            path="main.tex",
        )))

        self.assertFalse(tracker.add_if_allowed(ContextCandidate(
            content="chunk",
            scope=ContextScope.FILE_CHUNK,
            source="rag",
            file_id="file-1",
            path="main.tex",
        )))

    def test_full_file_blocks_later_chunk_by_path(self):
        tracker = ContextTracker()

        self.assertTrue(tracker.add_if_allowed(ContextCandidate(
            content="full file",
            scope=ContextScope.FULL_FILE,
            source="mention",
            path="/sections/intro.tex",
        )))

        self.assertFalse(tracker.add_if_allowed(ContextCandidate(
            content="chunk",
            scope=ContextScope.FILE_CHUNK,
            source="rag",
            path="sections/intro.tex",
        )))

    def test_chunk_before_full_file_does_not_mark_file_included(self):
        tracker = ContextTracker()

        self.assertTrue(tracker.add_if_allowed(ContextCandidate(
            content="chunk",
            scope=ContextScope.FILE_CHUNK,
            source="rag",
            file_id="file-1",
            path="main.tex",
        )))

        self.assertTrue(tracker.add_if_allowed(ContextCandidate(
            content="full file",
            scope=ContextScope.FULL_FILE,
            source="tool",
            file_id="file-1",
            path="main.tex",
        )))

    def test_normalize_path(self):
        self.assertEqual(normalize_path(" /a//b/main.tex "), "a/b/main.tex")


if __name__ == "__main__":
    unittest.main()
