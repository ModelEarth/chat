"""
End-to-end test for chat/ingestion/vector_db_sync.py.

This runs real API calls (Voyage + Pinecone) and cleans up vectors.

Scenarios:
- Add multiple files in one run -> index files
- Modify multiple files in one run -> delete old vectors, index replacements
- Rename mixed with modify -> delete old path, index new path, keep other files correct
- Delete multiple files in one run -> remove vectors

Run (from repo root): python chat/ingestion/test_vectordb_sync.py
"""

import os
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, List, Tuple

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


def vector_metadata(vector_obj) -> dict:
    return vector_obj.get("metadata", {}) if isinstance(vector_obj, dict) else getattr(vector_obj, "metadata", {})


def fetch_vectors_by_ids(index, ids: List[str]) -> Dict[str, object]:
    fetched = index.fetch(ids=ids, namespace=vector_db_sync.DEFAULT_NAMESPACE)
    if isinstance(fetched, dict):
        return fetched.get("vectors") or fetched.get("records") or {}
    return getattr(fetched, "vectors", None) or getattr(fetched, "records", None) or {}


def wait_fetch_by_ids(index, ids: List[str], attempts: int = 20, delay: float = 1.5) -> bool:
    """Wait for fetch(ids) to return any records using DEFAULT_NAMESPACE."""
    for _ in range(attempts):
        try:
            vecs = fetch_vectors_by_ids(index, ids)
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
            vecs = fetch_vectors_by_ids(index, ids)
            if not vecs:
                return True
        except Exception:
            return True
        time.sleep(delay)
    return False


def wait_ids_grouped_by_path(index, ids: List[str], expected_paths: List[str], attempts: int = 20, delay: float = 1.5) -> Dict[str, List[str]]:
    """Wait until fetch(ids) returns vectors for each expected file_path."""
    expected = set(expected_paths)
    last_grouped: Dict[str, List[str]] = {}
    for _ in range(attempts):
        try:
            vectors = fetch_vectors_by_ids(index, ids)
            grouped: Dict[str, List[str]] = {}
            for vector_id, vector_obj in vectors.items():
                path = vector_metadata(vector_obj).get("file_path")
                if isinstance(path, str):
                    grouped.setdefault(path, []).append(vector_id)
            if expected.issubset(grouped.keys()) and all(grouped[path] for path in expected):
                return grouped
            last_grouped = grouped
        except Exception:
            last_grouped = {}
        time.sleep(delay)
    raise AssertionError(f"Timed out waiting for vectors for paths {sorted(expected)}; last seen={sorted(last_grouped)}")


def assert_paths_only(grouped_ids: Dict[str, List[str]], expected_paths: List[str], context: str) -> None:
    expected = set(expected_paths)
    actual = set(grouped_ids)
    if actual != expected:
        raise AssertionError(f"Unexpected file paths after {context}: expected {sorted(expected)}, got {sorted(actual)}")


def make_markdown(label: str, variant: str, section_count: int = 8) -> str:
    sections = [f"# {label}", ""]
    for idx in range(section_count):
        repeated = " ".join([f"{label}-{variant}-section-{idx}"] * 120)
        sections.extend(
            [
                f"## Section {idx}",
                repeated,
                "",
            ]
        )
    return "\n".join(sections)


def main() -> None:
    # Load local env file (prefer .env.local for secrets)
    env_path = CHAT_ROOT / ".env.local"
    if not env_path.exists():
        env_path = CHAT_ROOT / ".env"
    load_dotenv(dotenv_path=str(env_path), override=True)

    # vector_db_sync expects paths relative to repo root (like `chat/...`).
    os.chdir(REPO_ROOT)
    repo_name, index_name, _env = ensure_env()

    # Test artifacts
    test_prefix = f"_tmp_vector_sync_test_{uuid.uuid4().hex[:8]}"
    test_file_a = CHAT_ROOT / f"{test_prefix}_a.md"
    test_file_a_renamed = CHAT_ROOT / f"{test_prefix}_a_renamed.md"
    test_file_b = CHAT_ROOT / f"{test_prefix}_b.md"
    test_file_c = CHAT_ROOT / f"{test_prefix}_c.md"
    errors_file = CHAT_ROOT / "_tmp_vector_sync_errors.jsonl"

    # Index handle obtained after first sync (index may be created there)
    index = None

    rel_file_a = f"chat/{test_file_a.name}"
    rel_file_a_renamed = f"chat/{test_file_a_renamed.name}"
    rel_file_b = f"chat/{test_file_b.name}"
    rel_file_c = f"chat/{test_file_c.name}"

    created_files = [test_file_a, test_file_a_renamed, test_file_b, test_file_c]
    try:
        # 1) Add multiple files in one run.
        test_file_a.write_text(make_markdown("Vector Sync Test A", "add"), encoding="utf-8")
        test_file_b.write_text(make_markdown("Vector Sync Test B", "add"), encoding="utf-8")
        test_file_c.write_text(make_markdown("Vector Sync Test C", "add"), encoding="utf-8")
        res = vector_db_sync.run_sync(
            [("A", rel_file_a), ("A", rel_file_b), ("A", rel_file_c)],
            str(errors_file),
            repo_root=str(REPO_ROOT),
        )
        index = get_index_handle(index_name)
        add_ids = res.get("upserted_ids", [])
        if not add_ids or not wait_fetch_by_ids(index, add_ids):
            raise AssertionError("No vectors found after Add (fetch-by-id)")
        add_ids_by_path = wait_ids_grouped_by_path(index, add_ids, [rel_file_a, rel_file_b, rel_file_c])
        assert_paths_only(add_ids_by_path, [rel_file_a, rel_file_b, rel_file_c], "Add")

        # 2) Modify the same files together and verify old IDs are gone.
        test_file_a.write_text(make_markdown("Vector Sync Test A", "modify"), encoding="utf-8")
        test_file_b.write_text(make_markdown("Vector Sync Test B", "modify"), encoding="utf-8")
        test_file_c.write_text(make_markdown("Vector Sync Test C", "modify"), encoding="utf-8")
        res = vector_db_sync.run_sync(
            [("M", rel_file_a), ("M", rel_file_b), ("M", rel_file_c)],
            str(errors_file),
            repo_root=str(REPO_ROOT),
        )
        mod_ids = res.get("upserted_ids", [])
        if not mod_ids or not wait_fetch_by_ids(index, mod_ids, attempts=15, delay=1.0):
            raise AssertionError("No vectors found after Modify (fetch-by-id)")
        mod_ids_by_path = wait_ids_grouped_by_path(index, mod_ids, [rel_file_a, rel_file_b, rel_file_c], attempts=15, delay=1.0)
        assert_paths_only(mod_ids_by_path, [rel_file_a, rel_file_b, rel_file_c], "Modify")
        for path, old_ids in add_ids_by_path.items():
            if not wait_ids_gone(index, old_ids, attempts=20, delay=1.0):
                raise AssertionError(f"Old vectors still present after Modify for {path}")

        # 3) Rename A and modify B/C in the same run.
        test_file_a.rename(test_file_a_renamed)
        test_file_a_renamed.write_text(make_markdown("Vector Sync Test A", "rename"), encoding="utf-8")
        test_file_b.write_text(make_markdown("Vector Sync Test B", "rename-mixed"), encoding="utf-8")
        test_file_c.write_text(make_markdown("Vector Sync Test C", "rename-mixed"), encoding="utf-8")
        res = vector_db_sync.run_sync([
            ("D", rel_file_a),
            ("M", rel_file_a_renamed),
            ("M", rel_file_b),
            ("M", rel_file_c),
        ], str(errors_file), repo_root=str(REPO_ROOT))
        rename_ids = res.get("upserted_ids", [])
        if not rename_ids or not wait_fetch_by_ids(index, rename_ids, attempts=15, delay=1.0):
            raise AssertionError("No vectors found after Rename/Modify batch (fetch-by-id)")
        rename_ids_by_path = wait_ids_grouped_by_path(
            index,
            rename_ids,
            [rel_file_a_renamed, rel_file_b, rel_file_c],
            attempts=15,
            delay=1.0,
        )
        assert_paths_only(rename_ids_by_path, [rel_file_a_renamed, rel_file_b, rel_file_c], "Rename/Modify batch")
        if not wait_ids_gone(index, mod_ids_by_path[rel_file_a], attempts=20, delay=1.0):
            raise AssertionError("Old path vectors still present after Rename")
        for path in (rel_file_b, rel_file_c):
            if not wait_ids_gone(index, mod_ids_by_path[path], attempts=20, delay=1.0):
                raise AssertionError(f"Old vectors still present after mixed Rename/Modify batch for {path}")

        # 4) Delete all remaining files in one run.
        for path in (test_file_a_renamed, test_file_b, test_file_c):
            if path.exists():
                path.unlink()
        _ = vector_db_sync.run_sync(
            [("D", rel_file_a_renamed), ("D", rel_file_b), ("D", rel_file_c)],
            str(errors_file),
            repo_root=str(REPO_ROOT),
        )
        for path, ids in rename_ids_by_path.items():
            if not wait_ids_gone(index, ids, attempts=20, delay=1.0):
                raise AssertionError(f"Vectors still present after Delete for {path}")

        print("[ok] Vector sync e2e test passed.")

    finally:
        # Cleanup vectors defensively for all paths.
        try:
            index = index or get_index_handle(index_name)
        except Exception:
            index = None
        if index is not None:
            for fp in (rel_file_a, rel_file_a_renamed, rel_file_b, rel_file_c):
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
