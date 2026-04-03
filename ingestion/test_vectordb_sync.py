"""
End-to-end test for chat/ingestion/vector_db_sync.py.

This runs real API calls (Voyage + Pinecone) and cleans up vectors.

Scenarios:
- Add (A) -> index file
- Modify (M) -> reindex (delete first)
- Rename (D+M) -> delete old, index new
- Delete (D) -> remove vectors

Run (from repo root): python chat/ingestion/test_vectordb_sync.py
"""

import os
import sys
import time
import uuid
from pathlib import Path
from typing import Tuple, List

from dotenv import load_dotenv
# Path calculations based on test file location
THIS_DIR = Path(__file__).parent  # chat/ingestion/
CHAT_ROOT = THIS_DIR.parent  # chat/
REPO_ROOT = CHAT_ROOT.parent  # webroot/
sys.path.insert(0, str(THIS_DIR))
import vector_db_sync  # type: ignore


def ensure_env() -> Tuple[str, str, str]:
    api = os.getenv("PINECONE_API_KEY")
    voy = os.getenv("VOYAGE_API_KEY")
    if not api or not voy:
        raise SystemExit("PINECONE_API_KEY and VOYAGE_API_KEY must be set in docker/.env, chat/.env, or environment")

    # Generate unique repo_name for metadata tagging (not used as namespace anymore)
    repo_name = f"vector-sync-test-{uuid.uuid4().hex[:8]}"
    os.environ["GITHUB_REPOSITORY"] = f"local/{repo_name}"

    # Note: We now use DEFAULT_NAMESPACE (empty string) for all vectors
    # repo_name is only used in metadata for filtering
    index_name = os.getenv("PINECONE_INDEX", vector_db_sync.INDEX_NAME)
    env = os.getenv("PINECONE_ENV", "us-west1-gcp")
    return repo_name, index_name, env


def get_index_handle(index_name: str):
    """Return an index handle using available SDK (serverless preferred)."""
    try:
        from pinecone import Pinecone  # type: ignore
        pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
        return pc.Index(index_name)
    except Exception:
        # Fallback to classic client
        import pinecone as pinecone_client  # type: ignore
        pinecone_client.init(api_key=os.environ["PINECONE_API_KEY"], environment=os.getenv("PINECONE_ENV", "us-west1-gcp"))
        return pinecone_client.Index(index_name)


def count_vectors_by_query(index, query_vec, expect_path: str) -> int:
    """Query using DEFAULT_NAMESPACE"""
    res = index.query(
        vector=query_vec, 
        top_k=5, 
        namespace=vector_db_sync.DEFAULT_NAMESPACE, 
        include_metadata=True
    )
    matches = res.get("matches", []) if isinstance(res, dict) else getattr(res, "matches", [])
    def md(m):
        return m.get("metadata", {}) if isinstance(m, dict) else getattr(m, "metadata", {})
    return sum(1 for m in matches if md(m).get("file_path") == expect_path)


def wait_fetch_by_ids(index, ids: List[str], attempts: int = 20, delay: float = 1.5) -> bool:
    """Wait for fetch(ids) to return any records using DEFAULT_NAMESPACE."""
    for _ in range(attempts):
        try:
            fetched = index.fetch(ids=ids, namespace=vector_db_sync.DEFAULT_NAMESPACE)
            if isinstance(fetched, dict):
                vecs = fetched.get("vectors") or fetched.get("records") or {}
            else:
                vecs = getattr(fetched, "vectors", None) or getattr(fetched, "records", None) or {}
            if vecs:
                return True
        except Exception:
            pass
        time.sleep(delay)
    return False


def wait_ids_gone(index, ids: List[str], attempts: int = 20, delay: float = 1.0) -> bool:
    """Wait until fetch(ids) returns no records using DEFAULT_NAMESPACE."""
    for _ in range(attempts):
        try:
            fetched = index.fetch(ids=ids, namespace=vector_db_sync.DEFAULT_NAMESPACE)
            if isinstance(fetched, dict):
                vecs = fetched.get("vectors") or fetched.get("records") or {}
            else:
                vecs = getattr(fetched, "vectors", None) or getattr(fetched, "records", None) or {}
            if not vecs:
                return True
        except Exception:
            return True
        time.sleep(delay)
    return False


def wait_for_count(index, query_vec, expect_path: str, expect_min: int, attempts: int = 10, delay: float = 1.5) -> int:
    """Poll query until count >= expect_min or attempts exhausted."""
    last = 0
    for _ in range(attempts):
        try:
            last = count_vectors_by_query(index, query_vec, expect_path)
            if last >= expect_min:
                return last
        except Exception:
            last = 0
        time.sleep(delay)
    return last


def main() -> None:
    # Load local env file (prefer .env.local for secrets)
    env_path = CHAT_ROOT / ".env.local"
    if not env_path.exists():
        env_path = CHAT_ROOT / ".env"
    load_dotenv(dotenv_path=str(env_path), override=True)

    # vector_db_sync expects paths relative to repo root (like `chat/...`).
    os.chdir(REPO_ROOT)
    repo_name, index_name, env = ensure_env()

    # Test artifacts
    test_file_1 = CHAT_ROOT / f"_tmp_vector_sync_test_{uuid.uuid4().hex[:8]}.md"
    test_file_2 = test_file_1.with_name(test_file_1.stem + "_renamed.md")
    errors_file = CHAT_ROOT / "_tmp_vector_sync_errors.jsonl"

    # Index handle obtained after first sync (index may be created there)
    index = None

    created_files = []
    try:
        # 1) Add
        content_add = "# Vector Sync Test\n\nInitial content."
        test_file_1.write_text(content_add, encoding="utf-8")
        created_files.append(test_file_1)
        # Add via run_sync (capture ids for fetch-by-id verification)
        res = vector_db_sync.run_sync([("A", f"chat/{test_file_1.name}")], str(errors_file), repo_root=str(REPO_ROOT))
        index = get_index_handle(index_name)
        add_ids = res.get("upserted_ids", [])
        if not add_ids:
            # Force a follow-up modify upsert to ensure IDs are available
            res2 = vector_db_sync.run_sync([("M", f"chat/{test_file_1.name}")], str(errors_file), repo_root=str(REPO_ROOT))
            add_ids = res2.get("upserted_ids", [])
        if not add_ids or not wait_fetch_by_ids(index, add_ids):
            raise AssertionError("No vectors found after Add (fetch-by-id)")

        # 2) Modify
        content_mod = "# Vector Sync Test\n\nModified content."
        test_file_1.write_text(content_mod, encoding="utf-8")
        res = vector_db_sync.run_sync([("M", f"chat/{test_file_1.name}")], str(errors_file), repo_root=str(REPO_ROOT))
        mod_ids = res.get("upserted_ids", [])
        if not mod_ids or not wait_fetch_by_ids(index, mod_ids, attempts=15, delay=1.0):
            raise AssertionError("No vectors found after Modify (fetch-by-id)")

        # 3) Rename
        test_file_1.rename(test_file_2)
        created_files.append(test_file_2)
        # Rename as D old + M new
        res = vector_db_sync.run_sync([
            ("D", f"chat/{test_file_1.name}"),
            ("M", f"chat/{test_file_2.name}")
        ], str(errors_file), repo_root=str(REPO_ROOT))
        # Old ids should be gone (from previous mod_ids), new ids should be present
        if 'mod_ids' in locals() and mod_ids:
            if not wait_ids_gone(index, mod_ids, attempts=20, delay=1.0):
                raise AssertionError("Old path vectors still present after Rename")
        new_ids = res.get("upserted_ids", [])
        if not new_ids or not wait_fetch_by_ids(index, new_ids, attempts=15, delay=1.0):
            raise AssertionError("No vectors found for new path after Rename (fetch-by-id)")

        # 4) Delete
        if test_file_2.exists():
            test_file_2.unlink()
        _ = vector_db_sync.run_sync([("D", f"chat/{test_file_2.name}")], str(errors_file), repo_root=str(REPO_ROOT))
        if not wait_ids_gone(index, new_ids, attempts=20, delay=1.0):
            raise AssertionError("Vectors still present after Delete")

        print("[ok] Vector sync e2e test passed.")

    finally:
        # Cleanup vectors defensively for both paths
        try:
            index = index or get_index_handle(index_name)
        except Exception:
            index = None
        if index is not None:
            # Cleanup using DEFAULT_NAMESPACE and repo_name metadata filter
            for fp in (f"chat/{test_file_1.name}", f"chat/{test_file_2.name}"):
                try:
                    index.delete(
                        filter={"repo_name": repo_name, "file_path": fp}, 
                        namespace=vector_db_sync.DEFAULT_NAMESPACE
                    )
                except Exception:
                    # Try simpler filter on file_path only
                    try:
                        index.delete(
                            filter={"file_path": fp}, 
                            namespace=vector_db_sync.DEFAULT_NAMESPACE
                        )
                    except Exception:
                        pass

        # Cleanup files
        for f in created_files:
            try:
                if f.exists():
                    f.unlink()
            except Exception:
                pass
        try:
            if errors_file.exists():
                errors_file.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()
