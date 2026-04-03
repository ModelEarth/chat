"""
Vector DB sync for the webroot superproject and its submodules.

Invocation modes
- changed_files.txt: python chat/ingestion/vector_db_sync.py <changed_files.txt>
  (lines from `git diff --name-status`)
- explicit files: python chat/ingestion/vector_db_sync.py --files A:path M:path D:path ...
  (status prefix optional; default is M if omitted)
- commit range replay (recommended):
  python chat/ingestion/vector_db_sync.py --from-commit <rev> [--to-commit HEAD] [--repo-root .]
  Expands submodule pointer changes into file-level A/M/D across changed submodules.
- full re-index (wipe and rebuild):
  python chat/ingestion/vector_db_sync.py --reindex-all [--repo-root .]
  Wipes all vectors and re-indexes the entire repository from scratch.

Behavior
- A/M: pre-delete vectors for the path (idempotent), then chunk + embed + upsert
- D: delete vectors for the path
- Rename: expanded to D old + M new (superproject and submodules)
- Embeddings are content-only; file path is stored in metadata
- Strict failure: unexpected errors fail the run; errors recorded to JSONL

Env vars
- PINECONE_API_KEY (required)
- VOYAGE_API_KEY (required)
- PINECONE_CLOUD (serverless; default: aws)
- PINECONE_REGION (serverless; default: us-east-1)
- PINECONE_ENV (classic fallback; default: us-west1-gcp)
- PINECONE_INDEX (optional, default: repo-chunks)
"""

# pyright: basic

import os
import sys
import uuid
import re
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Tuple, Optional
import time
import tiktoken
from tqdm import tqdm
import argparse
import subprocess
import threading
from queue import Empty, Full, Queue

# LlamaIndex imports
from llama_chunker import LlamaChunker
from llama_index.embeddings.voyageai import VoyageEmbedding

# Constants
MAX_TOKENS = 8192
INDEX_NAME = "repo-chunks"
DEFAULT_NAMESPACE = ""  # Empty string = Pinecone default namespace (recommended for single consolidated namespace)
GIT_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # Git's empty tree SHA - used for full reindex
EMBEDDING_MODEL = "voyage-code-3"  # SOTA code embedding model
DIMENSION = 1024  # voyage-code-3 dimension
METRIC = "cosine"
EMBEDDING_MAX_TEXTS_PER_BATCH = 1000
EMBEDDING_MAX_TOKENS_PER_BATCH = 100_000
PINECONE_MAX_RECORDS_PER_BATCH = 1000
PINECONE_MAX_REQUEST_BYTES = 1_920_000
PINECONE_RECORD_SIZE_SAFETY_MULTIPLIER = 1.03
PINECONE_RECORD_SIZE_OVERHEAD_BYTES = 48

# Extensions we should not attempt to parse/chunk as text. We index them as a single metadata summary.
# This avoids embedding binary gibberish (images, archives, etc.) which is slow and error-prone.
BINARY_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
    ".ico",
    ".psd",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".7z",
    ".mp3",
    ".mp4",
    ".mov",
    ".avi",
    ".wav",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
}

# Files we don't want to chunk/embed as full content (lockfiles, etc).
# These are typically huge and low-value for code RAG, and can stall ingestion.
SUMMARY_ONLY_BASENAMES = {
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "cargo.lock",
    "poetry.lock",
    "pipfile.lock",
    "gemfile.lock",
    "composer.lock",
}

# Prefer serverless Pinecone SDK; fallback to classic client if not available
USE_SERVERLESS = False
pc = None  # type: ignore
pinecone_client = None  # type: ignore
try:
    from pinecone import Pinecone, ServerlessSpec  # type: ignore

    USE_SERVERLESS = True
except Exception:
    try:
        import pinecone as pinecone_client  # type: ignore

        USE_SERVERLESS = False
    except Exception:
        pinecone_client = None  # type: ignore
        USE_SERVERLESS = False

# Clients are initialized in main() to avoid import-time failures
index = None
embed_model = None  # VoyageEmbedding instance
tokenizer = None
chunker = None  # LlamaChunker instance
logger = logging.getLogger("vector_db_sync")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s:%(name)s:%(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
timing_stats = {
    "embed_calls": 0,
    "embed_texts": 0,
    "embed_seconds": 0.0,
    "pinecone_seconds": 0.0,
}
batch_stats = {
    "embedding_batches": 0,
    "embedding_batch_texts_total": 0,
    "embedding_batch_tokens_total": 0,
    "embedding_batch_texts_max": 0,
    "embedding_batch_tokens_max": 0,
    "embedding_batch_fallbacks": 0,
    "upsert_batches": 0,
    "upsert_batch_records_total": 0,
    "upsert_batch_bytes_total": 0,
    "upsert_batch_records_max": 0,
    "upsert_batch_bytes_max": 0,
    "upsert_batch_fallbacks": 0,
}
PROGRESS_LOG_EVERY = 512
PROGRESS_LOG_INTERVAL_SECONDS = 5.0
EMBEDDING_QUEUE_MAX_ITEMS = 2048
UPSERT_QUEUE_MAX_ITEMS = 512
PIPELINE_BATCH_WAIT_SECONDS = 0.25
PIPELINE_QUEUE_PUT_TIMEOUT_SECONDS = 0.25


def reset_timing_stats() -> None:
    timing_stats["embed_calls"] = 0
    timing_stats["embed_texts"] = 0
    timing_stats["embed_seconds"] = 0.0
    timing_stats["pinecone_seconds"] = 0.0
    batch_stats["embedding_batches"] = 0
    batch_stats["embedding_batch_texts_total"] = 0
    batch_stats["embedding_batch_tokens_total"] = 0
    batch_stats["embedding_batch_texts_max"] = 0
    batch_stats["embedding_batch_tokens_max"] = 0
    batch_stats["embedding_batch_fallbacks"] = 0
    batch_stats["upsert_batches"] = 0
    batch_stats["upsert_batch_records_total"] = 0
    batch_stats["upsert_batch_bytes_total"] = 0
    batch_stats["upsert_batch_records_max"] = 0
    batch_stats["upsert_batch_bytes_max"] = 0
    batch_stats["upsert_batch_fallbacks"] = 0


def log_timing(message: str) -> None:
    logger.info(f"[timing] {message}")


class ProgressReporter:
    def __init__(self, desc: str, unit: str = "chunk") -> None:
        self.desc = desc
        self.unit = unit
        self.count = 0
        self.started = time.perf_counter()
        self.last_logged_count = 0
        self.last_logged_at = self.started
        use_tqdm = bool(getattr(sys.stderr, "isatty", lambda: False)())
        self._bar = tqdm(desc=desc, unit=unit, leave=False) if use_tqdm else None

    def update(self, n: int) -> None:
        if n <= 0:
            return
        self.count += n
        if self._bar is not None:
            self._bar.update(n)
            return

        now = time.perf_counter()
        if (
            self.count - self.last_logged_count >= PROGRESS_LOG_EVERY
            or now - self.last_logged_at >= PROGRESS_LOG_INTERVAL_SECONDS
        ):
            self._log_progress(now)

    def close(self) -> None:
        if self._bar is not None:
            self._bar.close()
            return
        if self.count > self.last_logged_count:
            self._log_progress(time.perf_counter())

    def _log_progress(self, now: float) -> None:
        elapsed = max(now - self.started, 1e-9)
        rate = self.count / elapsed
        logger.info(
            "[progress] %s count=%d %s elapsed=%.1fs rate=%.2f %s/s",
            self.desc,
            self.count,
            self.unit,
            elapsed,
            rate,
            self.unit,
        )
        self.last_logged_count = self.count
        self.last_logged_at = now


def count_tokens(text: str) -> int:
    if tokenizer is None:
        # Should not happen (tokenizer initialized in main) but be safe
        return len(text.split())
    return len(tokenizer.encode(text, allowed_special="all"))


def re_chunk_if_oversize(sections: List[str], max_tokens: int = MAX_TOKENS) -> List[str]:
    final_chunks: List[str] = []
    for section in sections:
        section = section.strip()
        if not section:
            continue

        tokens = count_tokens(section)
        if tokens <= max_tokens:
            final_chunks.append(section)
        else:
            split_points = re.split(r'(?<=[.!?])\s+', section)
            current_chunk = ""

            for part in split_points:
                test_chunk = current_chunk + (" " + part if current_chunk else part)
                if count_tokens(test_chunk) <= max_tokens:
                    current_chunk = test_chunk
                else:
                    if current_chunk:
                        final_chunks.append(current_chunk.strip())
                    current_chunk = part

            if current_chunk.strip():
                final_chunks.append(current_chunk.strip())

            really_final: List[str] = []
            for chunk in final_chunks:
                if count_tokens(chunk) <= max_tokens:
                    really_final.append(chunk)
                else:
                    char_chunks = re.findall(r'.{1,3000}(?:\s+|$)', chunk)
                    really_final.extend([s.strip() for s in char_chunks if s.strip()])
            final_chunks = really_final

    return final_chunks


def detect_file_type(filepath: str) -> str:
    path = Path(filepath)
    ext = path.suffix.lower()

    if (ext == '' or ext in {'.sh'}) and path.exists():
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                first_line = f.readline().strip()
                if first_line.startswith('#!'):
                    if 'python' in first_line:
                        return 'python'
                    elif any(shell in first_line for shell in ['bash', 'sh', 'zsh']):
                        return 'bash'
        except Exception:
            pass

    return ext.lstrip('.')


# Chunking functions replaced by LlamaChunker
# chunk_code_tree_sitter, chunk_markdown, chunk_json_yaml removed


# chunk_ipynb removed - LlamaIndex JSONNodeParser handles .ipynb files as JSON

def chunk_csv_tsv(filepath: Path):
    """Simplified CSV/TSV handling without pandas dependency"""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = [f.readline() for _ in range(20)]  # Read first 20 lines

        content = ''.join(lines)
        summary = f"""CSV/TSV File: {filepath.name}
First 20 lines preview:
{content}
"""
        return re_chunk_if_oversize([summary]), True

    except Exception as e:
        # Keep should_embed=True to avoid upserting empty vectors.
        return [f"Error reading CSV {filepath}: {e}"], True


def chunk_topojson_summary(filepath: Path):
    """Build a compact, human-readable TopoJSON summary chunk."""
    path = Path(filepath)
    try:
        stat = path.stat()
        size_mb = stat.st_size / (1024 * 1024)
    except Exception as e:
        raise RuntimeError(f"Failed to stat TopoJSON file {filepath}: {e}")

    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except Exception as e:
        raise RuntimeError(f"Failed to parse TopoJSON file {filepath}: {e}")

    topo_type = data.get("type")
    if topo_type != "Topology":
        raise RuntimeError(f"Invalid TopoJSON type for {filepath}: {topo_type!r}")

    objects = data.get("objects")
    if not isinstance(objects, dict) or not objects:
        raise RuntimeError(f"Invalid TopoJSON objects for {filepath}")

    object_names = list(objects.keys())
    geometry_counts: dict = {}
    total_geometries = 0
    sample_ids: List[str] = []

    for obj in objects.values():
        if not isinstance(obj, dict):
            continue
        geometries = obj.get("geometries")
        if not isinstance(geometries, list):
            continue
        total_geometries += len(geometries)
        for geom in geometries:
            if not isinstance(geom, dict):
                continue
            geom_type = str(geom.get("type", "Unknown"))
            geometry_counts[geom_type] = int(geometry_counts.get(geom_type, 0)) + 1
            geom_id = geom.get("id")
            if geom_id is not None and len(sample_ids) < 12:
                sample_ids.append(str(geom_id))

    arcs = data.get("arcs")
    arc_count = len(arcs) if isinstance(arcs, list) else 0
    has_transform = isinstance(data.get("transform"), dict)

    object_preview = ", ".join(object_names[:8])
    if len(object_names) > 8:
        object_preview += ", ..."

    type_preview = ", ".join([f"{k}={v}" for k, v in sorted(geometry_counts.items())])
    if not type_preview:
        type_preview = "none"

    id_preview = ", ".join(sample_ids) if sample_ids else "none"

    summary = f"""TOPOJSON file: {path.name}
Path: {filepath}
Size: {size_mb:.2f} MB
Type: topojson
Topology: {topo_type}
Objects: {object_preview}
Geometry count: {total_geometries}
Geometry types: {type_preview}
Arc count: {arc_count}
Has transform: {"yes" if has_transform else "no"}
Sample IDs: {id_preview}
"""
    return re_chunk_if_oversize([summary]), True


def chunk_as_summary(filepath: Path):
    path = Path(filepath)
    file_type = detect_file_type(str(filepath))

    try:
        stat = path.stat()
        size_mb = stat.st_size / (1024 * 1024)

        summary = f"""{file_type.upper()} file: {path.name}
Path: {filepath}
Size: {size_mb:.2f} MB
Type: {file_type}
"""
        if size_mb < 1 and file_type in {'txt', 'log', 'conf', 'ini', 'cfg'}:
            try:
                preview = path.read_text(encoding='utf-8', errors='ignore')[:500]
                summary += f"\nPreview:\n{preview}..."
            except Exception:
                pass

        return re_chunk_if_oversize([summary]), True

    except Exception as e:
        # Keep should_embed=True to avoid upserting empty vectors.
        return [f"Error accessing {filepath}: {e}"], True


def dispatch_chunking(filepath: Path):
    """Simplified chunking - LlamaIndex replaces all custom AST parsing"""
    path = Path(filepath)
    ext = path.suffix.lower()

    # Lockfiles and similar artifacts: index as a single summary chunk.
    if path.name.lower() in SUMMARY_ONLY_BASENAMES:
        chunks, _ = chunk_as_summary(path)
        return chunks, True, "summary"

    # TopoJSON map datasets are large geometry payloads; index a compact structural preview.
    if path.name.lower().endswith(".topo.json"):
        chunks, _ = chunk_topojson_summary(path)
        return chunks, True, "summary"

    # Binary-ish assets: index a single summary chunk instead of trying to parse/chunk file bytes as text.
    if ext in BINARY_EXTS:
        chunks, _ = chunk_as_summary(path)
        return chunks, True, "summary"

    # CSV/TSV: simple preview (no pandas needed)
    if ext in {".csv", ".tsv"}:
        chunks, _ = chunk_csv_tsv(path)
        return chunks, True, "summary"

    # LlamaIndex handles: py, js, ts, java, cpp, go, rust, etc. (code)
    #                     md, txt, rst (markdown)
    #                     json, yaml, yml, ipynb (structured data)
    #                     html, css, xml (markup)
    try:
        chunks = chunker.chunk_file(str(filepath))
        if chunks:
            # Some formats (large JSON, lockfiles) can still exceed our embed token limit.
            # Re-chunk defensively so we never upsert empty embeddings.
            return re_chunk_if_oversize(chunks), True, "content"
    except Exception as e:
        logger.warning("LlamaChunker error for %s: %s", filepath, _compact_issue_message(str(e)))

    # Fallback: unsupported files get metadata summary
    chunks, _ = chunk_as_summary(path)
    return chunks, True, "summary"


def get_embedding(text: str) -> List[float]:
    """Generate embedding using Voyage AI's voyage-code-3 model"""
    if not text or not text.strip():
        raise RuntimeError("Empty text provided for embedding")
    try:
        # Use LlamaIndex VoyageEmbedding - get_text_embedding for documents
        embedding = embed_model.get_text_embedding(text)
        if not embedding:
            raise RuntimeError("Received empty embedding from API")
        if len(embedding) != DIMENSION:
            raise RuntimeError(
                f"Unexpected embedding dimension: got {len(embedding)}, expected {DIMENSION}"
            )
        # Pinecone rejects NaN/inf; fail early with a clear message.
        for v in embedding:
            if v != v or v == float("inf") or v == float("-inf"):
                raise RuntimeError("Embedding contains NaN/inf values")
        return embedding
    except Exception as e:
        raise RuntimeError(f"Embedding failed: {e}")


def get_embeddings(texts: List[str]) -> List[List[float]]:
    """Generate embeddings in batches using Voyage AI's voyage-code-3 model."""
    if not texts:
        return []
    for text in texts:
        if not text or not text.strip():
            raise RuntimeError("Empty text provided for embedding batch")

    started = time.perf_counter()
    try:
        embeddings = embed_model.get_text_embedding_batch(texts)
        if not embeddings:
            raise RuntimeError("Received empty embedding batch from API")
        if len(embeddings) != len(texts):
            raise RuntimeError(
                f"Unexpected embedding batch size: got {len(embeddings)}, expected {len(texts)}"
            )

        for embedding in embeddings:
            if not embedding:
                raise RuntimeError("Received empty embedding in batch response")
            if len(embedding) != DIMENSION:
                raise RuntimeError(
                    f"Unexpected embedding dimension: got {len(embedding)}, expected {DIMENSION}"
                )
            for v in embedding:
                if v != v or v == float("inf") or v == float("-inf"):
                    raise RuntimeError("Embedding contains NaN/inf values")

        elapsed = time.perf_counter() - started
        timing_stats["embed_calls"] += 1
        timing_stats["embed_texts"] += len(texts)
        timing_stats["embed_seconds"] += elapsed
        return embeddings
    except Exception as e:
        elapsed = time.perf_counter() - started
        log_timing(f"embed_failed elapsed={elapsed:.3f}s")
        raise RuntimeError(f"Batch embedding failed: {e}")


def get_accurate_line_range(chunk: str, full_text: str, filepath: str = "(unknown)") -> str:
    if not full_text or not chunk:
        return "L1-L1"

    try:
        chunk_clean = chunk.strip()
        if not chunk_clean:
            return "L1-L1"

        full_lines = full_text.split('\n')
        chunk_lines = chunk_clean.split('\n')

        first_chunk_line = chunk_lines[0].strip()
        if not first_chunk_line:
            return "L1-L1"

        for i, line in enumerate(full_lines):
            if first_chunk_line in line.strip() or line.strip() in first_chunk_line:
                start_line = i + 1
                end_line = start_line + len(chunk_lines) - 1
                return f"L{start_line}-L{end_line}"

        for i, line in enumerate(full_lines):
            if len(line.strip()) > 10 and line.strip() in chunk:
                start_line = i + 1
                chunk_line_count = chunk.count('\n') + 1
                end_line = start_line + chunk_line_count - 1
                return f"L{start_line}-L{end_line}"

        return "L1-L1"

    except Exception as e:
        logger.warning("Error calculating line range for %s: %s", filepath, _compact_issue_message(str(e)))
        return "L1-L1"


def prepare_file_chunks(filepath: str, status: str, repo_name: str, commit_sha: str):
    try:
        if not Path(filepath).exists():
            logger.warning("File not found: %s", filepath)
            return []

        chunks, should_embed, chunk_type = dispatch_chunking(Path(filepath))
        chunk_entries = []

        full_text = ""
        if chunk_type == "content":
            try:
                full_text = Path(filepath).read_text(encoding="utf-8", errors="ignore")
            except Exception as e:
                logger.warning("Could not read full text for %s: %s", filepath, _compact_issue_message(str(e)))

        for i, chunk in enumerate(chunks):
            if not chunk or not chunk.strip():
                continue

            chunk_id = str(uuid.uuid4())
            token_count = count_tokens(chunk)

            chunk_entry = {
                "id": chunk_id,
                "values": [],
                "metadata": {
                    "repo_name": repo_name,
                    "file_path": str(filepath),
                    "file_type": detect_file_type(filepath),
                    "chunk_type": chunk_type,
                    "chunk_index": i,
                    "chunk_id": chunk_id,
                    "content": chunk,
                    "line_range": get_accurate_line_range(chunk, full_text, str(filepath)),
                    "embedded": False,
                    "should_embed": bool(should_embed),
                    "status": status,
                    "token_count": token_count,
                    "commit_sha": commit_sha,
                    "indexed_at": datetime.utcnow().isoformat() + "Z"
                }
            }
            chunk_entries.append(chunk_entry)

        return chunk_entries

    except Exception as e:
        logger.error(f"Failed to process {filepath}: {e}")
        raise


def safe_delete_vectors(file_path: str, repo_name: str) -> None:
    try:
        _ = index.delete(
            filter={"repo_name": repo_name, "file_path": file_path},
            namespace=DEFAULT_NAMESPACE
        )
        logger.info(f"Deleted vectors for: {file_path}")
    except Exception as e:
        msg = str(e).lower()
        if "namespace not found" in msg or "code\":5" in msg:
            # Namespace hasn't been created yet; deletion is a no-op
            logger.info(f"Namespace absent on delete; skipping: {file_path}")
            return
        raise


def safe_upsert_batch(batch: List[dict], repo_name: str) -> int:
    for entry in batch:
        md = entry.get("metadata", {})
        if md.get("chunk_type") == "content" and not entry.get("values"):
            raise RuntimeError(f"Attempted to upsert empty embedding: {md.get('file_path')}")
    index.upsert(vectors=batch, namespace=DEFAULT_NAMESPACE)
    return len(batch)


def group_queue_items_by_file(queue_items: List[dict]) -> dict:
    grouped: dict = {}
    for item in queue_items:
        grouped.setdefault(item["file_id"], []).append(item)
    return grouped


def estimate_upsert_record_bytes(entry: dict) -> int:
    raw_size = len(json.dumps(entry, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return int(raw_size * PINECONE_RECORD_SIZE_SAFETY_MULTIPLIER) + PINECONE_RECORD_SIZE_OVERHEAD_BYTES


def take_embedding_batch(queue: List[dict]) -> Tuple[List[dict], int]:
    if not queue:
        return [], 0

    batch: List[dict] = []
    total_tokens = 0
    for item in queue:
        token_count = max(int(item["entry"].get("metadata", {}).get("token_count", 0)), 1)
        if batch and (
            len(batch) >= EMBEDDING_MAX_TEXTS_PER_BATCH
            or total_tokens + token_count > EMBEDDING_MAX_TOKENS_PER_BATCH
        ):
            break
        batch.append(item)
        total_tokens += token_count
        if (
            len(batch) >= EMBEDDING_MAX_TEXTS_PER_BATCH
            or total_tokens >= EMBEDDING_MAX_TOKENS_PER_BATCH
        ):
            break

    del queue[:len(batch)]
    return batch, total_tokens


def take_upsert_batch(queue: List[dict]) -> Tuple[List[dict], int]:
    if not queue:
        return [], 0

    batch: List[dict] = []
    total_bytes = 0
    for item in queue:
        record_bytes = int(item.get("estimated_upsert_bytes") or 0)
        if record_bytes <= 0:
            record_bytes = estimate_upsert_record_bytes(item["entry"])
            item["estimated_upsert_bytes"] = record_bytes
        if batch and (
            len(batch) >= PINECONE_MAX_RECORDS_PER_BATCH
            or total_bytes + record_bytes > PINECONE_MAX_REQUEST_BYTES
        ):
            break
        batch.append(item)
        total_bytes += record_bytes
        if (
            len(batch) >= PINECONE_MAX_RECORDS_PER_BATCH
            or total_bytes >= PINECONE_MAX_REQUEST_BYTES
        ):
            break

    del queue[:len(batch)]
    return batch, total_bytes


def embedding_item_tokens(item: dict) -> int:
    return max(int(item["entry"].get("metadata", {}).get("token_count", 0)), 1)


def upsert_item_bytes(item: dict) -> int:
    record_bytes = int(item.get("estimated_upsert_bytes") or 0)
    if record_bytes <= 0:
        record_bytes = estimate_upsert_record_bytes(item["entry"])
        item["estimated_upsert_bytes"] = record_bytes
    return record_bytes


def detect_github_commit_range() -> Tuple[str, str]:
    """
    Auto-detect commit range from GitHub Actions environment.
    Returns (from_commit, to_commit) tuple.
    Raises RuntimeError if not in GitHub Actions or if detection fails.
    """
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    event_name = os.environ.get("GITHUB_EVENT_NAME")
    github_sha = os.environ.get("GITHUB_SHA")

    if not event_path:
        raise RuntimeError("GITHUB_EVENT_PATH not set. Cannot auto-detect commit range. "
                          "Provide --from-commit or run in GitHub Actions environment.")

    if not os.path.exists(event_path):
        raise RuntimeError(f"GitHub event file not found: {event_path}")

    try:
        with open(event_path, 'r', encoding='utf-8') as f:
            event = json.load(f)
    except Exception as e:
        raise RuntimeError(f"Failed to parse GitHub event file: {e}")

    if event_name == "push":
        base = event.get("before", "")
        head = github_sha or event.get("after", "")
    elif event_name == "pull_request":
        pr = event.get("pull_request", {})
        base = pr.get("base", {}).get("sha", "")
        head = pr.get("merge_commit_sha") or github_sha or ""
    else:
        raise RuntimeError(f"Unsupported GitHub event type: {event_name}. "
                          "Only 'push' and 'pull_request' events are supported. "
                          "Use --from-commit for manual runs.")

    # Handle empty tree / first commit
    if not base or base == "0000000000000000000000000000000000000000":
        if head:
            base = f"{head}^"
        else:
            raise RuntimeError("Cannot determine base commit: both base and head are missing from event data")

    if not head:
        raise RuntimeError("Cannot determine head commit: missing from GitHub event data")

    return (base, head)


def parse_args():
    parser = argparse.ArgumentParser(description="VectorDB sync")
    parser.add_argument("changed_files", nargs="?", help="Path to changed_files.txt from git diff --name-status")
    parser.add_argument("--files", nargs="*",
                        help="Explicit files to process. Accepts optional status prefix: A:path, M:path, D:path. Default is M if omitted.")
    parser.add_argument("--skip-paths", nargs="*",
                        help="Skip repo-root-relative paths during sync. A matched entry skips that exact path and its descendants.")
    parser.add_argument("--retry-errors", dest="retry_errors", nargs="?", const="chat/.vector_sync_errors.jsonl",
                        help="Retry files listed in an errors file (default: chat/.vector_sync_errors.jsonl)")
    parser.add_argument("--errors-out", dest="errors_out", default="chat/.vector_sync_errors.jsonl",
                        help="Path to write JSONL errors")
    parser.add_argument("--from-commit", dest="from_commit",
                        help="Compute changes from this commit/ref to HEAD or --to-commit. "
                             "For bulk ingestion of all files, use: 4b825dc642cb6eb9a060e54bf8d69288fbee4904 (empty tree)")
    parser.add_argument("--to-commit", dest="to_commit", default="HEAD", help="End commit/ref for diff (default: HEAD)")
    parser.add_argument("--repo-root", dest="repo_root", default=".",
                        help="Path to the git superproject root (default: current dir)")
    parser.add_argument("--reindex-all", action="store_true",
                        help="Wipe all vectors and re-index the entire repository from scratch. "
                             "Automatically handles the empty-tree comparison.")
    parser.add_argument("--skip-on-missing-keys", action="store_true",
                        help="Exit gracefully (code 0) if API keys are missing instead of raising an error")
    return parser.parse_args()


def _compact_issue_message(message: str, max_len: int = 320) -> str:
    compact = re.sub(r"\s+", " ", str(message or "")).strip()
    if len(compact) <= max_len:
        return compact
    return compact[: max_len - 3] + "..."


def append_error(path: str, file_path: str, operation: str, message: str, status: Optional[str] = None) -> None:
    try:
        rec = {
            "level": "error",
            "file_path": file_path,
            "operation": operation,
            "message": message,
            "logged_at": datetime.now().astimezone().isoformat(),
        }
        if status:
            rec["status"] = status
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        # Swallow error; rely on idempotent commit-range replay for recovery
        pass

def normalize_relative_path(path: str) -> str:
    normalized = str(path or "").strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    normalized = re.sub(r"/+", "/", normalized)
    return normalized.rstrip("/")


def normalize_skip_paths(paths: Optional[List[str]]) -> List[str]:
    if not paths:
        return []

    normalized_paths: List[str] = []
    seen = set()
    for raw in paths:
        normalized = normalize_relative_path(raw)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        normalized_paths.append(normalized)
    return normalized_paths


def get_matching_skip_path(filepath: str, skip_paths: List[str]) -> Optional[str]:
    normalized = normalize_relative_path(filepath)
    for skip_path in skip_paths:
        if normalized == skip_path or normalized.startswith(f"{skip_path}/"):
            return skip_path
    return None


def apply_skip_paths(
    files_to_process: List[Tuple[str, str]],
    skip_paths: Optional[List[str]],
    wipe_first: bool,
) -> Tuple[List[Tuple[str, str]], dict]:
    normalized_skip_paths = normalize_skip_paths(skip_paths)
    if not normalized_skip_paths:
        return files_to_process, {}

    filtered_files: List[Tuple[str, str]] = []
    skip_summary: dict = {}

    for status, filepath in files_to_process:
        matched_skip_path = get_matching_skip_path(filepath, normalized_skip_paths)
        if not matched_skip_path:
            filtered_files.append((status, filepath))
            continue

        bucket = skip_summary.setdefault(matched_skip_path, {"omitted": 0, "delete_handled": 0})
        if wipe_first:
            bucket["omitted"] += 1
            continue

        bucket["delete_handled"] += 1
        filtered_files.append(("D", filepath))

    return filtered_files, skip_summary


def _run_git(args: List[str], cwd: str) -> str:
    # Git will refuse to run on repos owned by a different OS user unless marked safe.
    # We pass safe.directory via -c so local runs (and automation users) work without mutating global git config.
    def _norm_safe_dir(p: str) -> str:
        # Git reports dubious ownership paths with forward slashes on Windows.
        # Match that normalization so `safe.directory` actually applies.
        try:
            resolved = str(Path(p).resolve())
        except Exception:
            resolved = p
        return resolved.replace("\\", "/")

    safe_dirs: List[str] = [_norm_safe_dir(cwd)]

    def _maybe_add_path(flag: str) -> None:
        if flag in args:
            idx = args.index(flag)
            if idx + 1 < len(args) and str(args[idx + 1]).strip():
                raw = str(args[idx + 1])
                safe_dirs.append(_norm_safe_dir(raw))

    _maybe_add_path("-C")
    _maybe_add_path("--git-dir")

    # Dedup while preserving order
    seen = set()
    safe_dirs_dedup: List[str] = []
    for d in safe_dirs:
        if d not in seen:
            seen.add(d)
            safe_dirs_dedup.append(d)

    cmd: List[str] = ["git"]
    for d in safe_dirs_dedup:
        cmd.extend(["-c", f"safe.directory={d}"])
    cmd.extend(args)

    cp = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if cp.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {cp.stderr.strip()}")
    return cp.stdout


def _parse_submodule_short(diff_text: str) -> List[Tuple[str, str, str]]:
    results: List[Tuple[str, str, str]] = []
    for line in diff_text.splitlines():
        # `git diff --submodule=short` may use either `..` or `...` between SHAs.
        m = re.match(r"^Submodule\s+([^\s]+)\s+([0-9a-f]{7,})\.{2,3}([0-9a-f]{7,}).*$", line.strip())
        if m:
            results.append((m.group(1), m.group(2), m.group(3)))
    return results


def _get_submodule_paths(repo_root: str) -> List[str]:
    gm = Path(repo_root) / ".gitmodules"
    if not gm.exists():
        return []

    try:
        out = _run_git(
            ["config", "--file", ".gitmodules", "--get-regexp", r"submodule\..*\.path"],
            repo_root,
        )
    except Exception:
        return []

    paths: List[str] = []
    for line in out.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1].strip():
            # Normalize to forward slashes for Pinecone metadata consistency.
            paths.append(parts[1].strip().replace("\\", "/"))

    # Dedup while preserving order.
    seen = set()
    deduped: List[str] = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            deduped.append(p)
    return deduped


def compute_reindex_all_files(repo_root: str, errors_out: str) -> List[Tuple[str, str]]:
    """
    For a full re-index, enumerate tracked files across the superproject and all submodules.

    This avoids relying on empty-tree diffs which include submodule "gitlink" paths (directories)
    and ensures we index actual files (e.g. `team/src/...`) rather than submodule pointers.
    """
    submodules = set(_get_submodule_paths(repo_root))

    # Superproject tracked files (exclude submodule gitlink entries).
    super_out = _run_git(["ls-files"], repo_root)
    all_files: List[str] = []
    for fp in super_out.splitlines():
        fp = fp.strip()
        if not fp:
            continue
        if fp in submodules:
            continue
        all_files.append(fp.replace("\\", "/"))

    # Submodule tracked files (prefixed by submodule path).
    for sub_path in sorted(submodules):
        sub_abs = Path(repo_root) / sub_path
        if not sub_abs.is_dir():
            logger.error("Submodule path not found on disk while listing tracked files: %s", sub_path)
            append_error(errors_out, sub_path, "ls-files-submodule", "Submodule path not found on disk")
            continue
        try:
            out = _run_git(["-C", str(sub_abs), "ls-files"], repo_root)
        except Exception as e:
            logger.error("Failed to list tracked files for submodule %s: %s", sub_path, _compact_issue_message(str(e)))
            append_error(errors_out, sub_path, "ls-files-submodule", str(e))
            continue

        for fp in out.splitlines():
            fp = fp.strip()
            if not fp:
                continue
            all_files.append(f"{sub_path}/{fp}".replace("\\", "/"))

    # Dedup while preserving order.
    seen = set()
    deduped: List[Tuple[str, str]] = []
    for fp in all_files:
        if fp not in seen:
            seen.add(fp)
            deduped.append(("A", fp))
    return deduped


def compute_changes_from_git(repo_root: str, from_rev: str, to_rev: str) -> List[Tuple[str, str]]:
    changes: List[Tuple[str, str]] = []
    # Superproject changes (expand renames)
    super_out = _run_git(["diff", "--name-status", from_rev, to_rev], repo_root)
    for line in super_out.splitlines():
        cols = line.strip().split("\t")
        if not cols:
            continue
        st = cols[0]
        if st.startswith("R") and len(cols) >= 3:
            # rename: old -> new
            changes.append(("D", cols[1]))
            changes.append(("M", cols[2]))
        elif len(cols) >= 2:
            changes.append((st, cols[1]))

    # Submodule pointer changes
    sub_out = _run_git(["diff", "--submodule=short", from_rev, to_rev], repo_root)
    for sub_path, oldsha, newsha in _parse_submodule_short(sub_out):
        sub_abs = str(Path(repo_root) / sub_path)
        sub_gitdir = str(Path(repo_root) / ".git" / "modules" / sub_path)
        added = (oldsha == "0000000" or re.fullmatch(r"0+", oldsha) is not None)
        deleted = (newsha == "0000000" or re.fullmatch(r"0+", newsha) is not None)
        try:
            if added:
                # List all files at newsha as added
                if Path(sub_abs).is_dir():
                    out = _run_git(["-C", sub_abs, "ls-tree", "-r", "--name-only", newsha], repo_root)
                else:
                    out = _run_git(["--git-dir", sub_gitdir, "ls-tree", "-r", "--name-only", newsha], repo_root)
                for f in out.splitlines():
                    if f.strip():
                        changes.append(("A", f"{sub_path}/{f}"))
            elif deleted:
                if Path(sub_gitdir).is_dir():
                    out = _run_git(["--git-dir", sub_gitdir, "ls-tree", "-r", "--name-only", oldsha], repo_root)
                else:
                    out = _run_git(["-C", sub_abs, "ls-tree", "-r", "--name-only", oldsha], repo_root)
                for f in out.splitlines():
                    if f.strip():
                        changes.append(("D", f"{sub_path}/{f}"))
            else:
                # Regular diff inside submodule
                if Path(sub_abs).is_dir():
                    out = _run_git(["-C", sub_abs, "diff", "--name-status", oldsha, newsha], repo_root)
                else:
                    out = _run_git(["--git-dir", sub_gitdir, "diff", "--name-status", oldsha, newsha], repo_root)
                for line in out.splitlines():
                    cols = line.strip().split("\t")
                    if not cols:
                        continue
                    st = cols[0]
                    if st.startswith("R") and len(cols) >= 3:
                        changes.append(("D", f"{sub_path}/{cols[1]}"))
                        changes.append(("M", f"{sub_path}/{cols[2]}"))
                    elif len(cols) >= 2:
                        changes.append((st, f"{sub_path}/{cols[1]}"))
        except Exception as e:
            logger.error("Failed to diff submodule %s: %s", sub_path, _compact_issue_message(str(e)))
            append_error("chat/.vector_sync_errors.jsonl", sub_path, "diff-submodule", str(e))

    return changes


def main_entry():
    args = parse_args()

    # Validate required API keys
    missing_keys = []
    if not os.environ.get("PINECONE_API_KEY"):
        missing_keys.append("PINECONE_API_KEY")
    if not os.environ.get("VOYAGE_API_KEY"):
        missing_keys.append("VOYAGE_API_KEY")

    if missing_keys:
        if args.skip_on_missing_keys:
            logger.info(f"Skipping VectorDB sync due to missing API keys: {', '.join(missing_keys)}")
            sys.exit(0)
        else:
            raise RuntimeError(f"Missing required API keys: {', '.join(missing_keys)}")

    errors_out = args.errors_out
    files_to_process: List[Tuple[str, str]] = []

    # Validate --reindex-all is not combined with other input modes
    if args.reindex_all and (args.files or args.retry_errors or args.changed_files):
        raise RuntimeError("--reindex-all cannot be combined with --files, --retry-errors, or changed_files")

    if args.reindex_all:
        logger.info("--reindex-all: Will wipe all vectors and re-index everything")
        files_to_process = compute_reindex_all_files(args.repo_root, errors_out)
        if not files_to_process:
            raise RuntimeError(
                "No tracked files found to index. Make sure the superproject is a git repo and submodules are checked out."
            )
    elif args.files:
        def parse_token(tok: str) -> tuple:
            if ":" in tok:
                st, path = tok.split(":", 1)
                st = st.strip().upper()
                if st not in {"A", "M", "D"}:
                    raise RuntimeError(f"Invalid status prefix in --files token: {tok}")
                return (st, path)
            return ("M", tok)

        for tok in args.files:
            files_to_process.append(parse_token(tok))
    elif args.retry_errors:
        src = Path(args.retry_errors)
        if src.exists():
            for line in src.read_text(encoding="utf-8").splitlines():
                try:
                    obj = json.loads(line)
                    fp = obj.get("file_path")
                    st = (obj.get("status") or "M").upper()
                    if st not in {"A", "M", "D"}:
                        st = "M"
                    if fp:
                        files_to_process.append((st, fp))
                except Exception:
                    continue
        else:
            raise RuntimeError(f"Errors file not found: {args.retry_errors}")
    else:
        from_commit = args.from_commit
        to_commit = args.to_commit or "HEAD"

        # Auto-detect commit range from GitHub Actions if not explicitly provided
        if not from_commit and not args.changed_files:
            from_commit, to_commit = detect_github_commit_range()
            logger.info(f"Auto-detected commit range from GitHub Actions: {from_commit}..{to_commit}")

        if from_commit:
            changes = compute_changes_from_git(args.repo_root, from_commit, to_commit)
            for st, fp in changes:
                if st.startswith('R'):
                    continue
                files_to_process.append((st, fp))
        elif args.changed_files:
            # Parse changed files
            with open(args.changed_files, 'r', encoding='utf-8') as f:
                lines = [ln.strip() for ln in f.readlines() if ln.strip()]
            for line in lines:
                parts = line.split(None, 2)
                status = parts[0]
                if status.startswith('R'):
                    if len(parts) >= 3:
                        old_fp = parts[1];
                        new_fp = parts[2]
                        files_to_process.append(("D", old_fp))
                        files_to_process.append(("M", new_fp))
                    else:
                        raise RuntimeError(f"Malformed rename line: {line}")
                else:
                    fp = parts[1] if len(parts) > 1 else ""
                    if fp:
                        files_to_process.append((status, fp))
        else:
            raise RuntimeError("Usage: provide one of: --files, --retry-errors, --from-commit, --reindex-all, or changed_files path")

    files_to_process, skip_summary = apply_skip_paths(
        files_to_process,
        args.skip_paths,
        wipe_first=args.reindex_all,
    )

    if skip_summary:
        for skip_path in sorted(skip_summary.keys()):
            details = skip_summary[skip_path]
            omitted = int(details.get("omitted", 0))
            delete_handled = int(details.get("delete_handled", 0))
            if omitted:
                logger.warning(
                    "Omitting %d files under '%s' because they matched --skip-paths during this full reindex.",
                    omitted,
                    skip_path,
                )
            if delete_handled:
                logger.warning(
                    "Handling %d files under '%s' as delete-only because they matched --skip-paths.",
                    delete_handled,
                    skip_path,
                )

    run_sync(
        files_to_process,
        errors_out,
        repo_root=args.repo_root,
        wipe_first=args.reindex_all,
        skip_summary=skip_summary,
    )



def run_sync(
    files_to_process: List[Tuple[str, str]],
    errors_out: str,
    repo_root: str,
    wipe_first: bool = False,
    skip_summary: Optional[dict] = None,
):
    # Environment context - repo_name used for metadata tagging
    github_repo = (os.getenv("GITHUB_REPOSITORY") or "").strip()
    repo_name = github_repo.split("/")[-1] if github_repo else ""
    if not repo_name:
        # Local runs may not have GitHub env; fall back to the repo root directory name.
        repo_name = Path(repo_root).resolve().name or "unknown"
    commit_sha = os.getenv("GITHUB_SHA", "unknown")
    reset_timing_stats()
    run_started = time.perf_counter()

    # Initialize external clients and tokenizer lazily
    global index, tokenizer, pc
    index_name = os.getenv("PINECONE_INDEX", INDEX_NAME)
    api_key = os.environ.get("PINECONE_API_KEY", "")

    if USE_SERVERLESS:
        from pinecone import Pinecone, ServerlessSpec  # type: ignore
        pc = Pinecone(api_key=api_key)
        # Ensure index exists (serverless)
        try:
            idxs = pc.list_indexes()
            names = []
            if hasattr(idxs, "indexes"):
                names = [ix.name for ix in idxs.indexes]
            else:
                names = [getattr(ix, "name", None) or ix.get("name") for ix in idxs]  # type: ignore
            if index_name not in set([n for n in names if n]):
                cloud = os.getenv("PINECONE_CLOUD", "aws")
                region = os.getenv("PINECONE_REGION", "us-east-1")
                logger.info(
                    f"Creating Pinecone serverless index '{index_name}' (dim={DIMENSION}, metric={METRIC}, cloud={cloud}, region={region})")
                try:
                    pc.create_index(
                        name=index_name,
                        dimension=DIMENSION,
                        metric=METRIC,
                        spec=ServerlessSpec(cloud=cloud, region=region),
                    )
                except Exception as e:
                    logger.warning(f"create_index failed or already exists: {e}")
        except Exception as e:
            logger.warning(f"Could not list/create serverless index: {e}")
        index = pc.Index(index_name)
    else:
        if pinecone_client is None:
            raise RuntimeError(
                "Pinecone SDK not available. Install 'pinecone' for serverless or 'pinecone-client' for classic.")
        pinecone_client.init(
            api_key=api_key,
            environment=os.getenv("PINECONE_ENV", "us-west1-gcp")
        )
        # Ensure index exists (classic client)
        try:
            existing = []
            try:
                existing = pinecone_client.list_indexes()
            except Exception:
                existing = []
            if isinstance(existing, dict) and "indexes" in existing:
                existing = [ix.get("name") for ix in existing.get("indexes", [])]
            if index_name not in set(existing or []):
                logger.info(f"Creating Pinecone classic index '{index_name}' (dim={DIMENSION}, metric={METRIC})")
                try:
                    pinecone_client.create_index(index_name, dimension=DIMENSION, metric=METRIC)
                except Exception as e:
                    logger.warning(f"create_index failed: {e}")
        except Exception as e:
            logger.warning(f"Could not verify/create classic index '{index_name}': {e}")
        index = pinecone_client.Index(index_name)

    # Initialize Voyage AI embedding model via LlamaIndex
    voyage_key = os.environ.get("VOYAGE_API_KEY", "")
    if not voyage_key:
        raise RuntimeError("VOYAGE_API_KEY not set")
    global embed_model
    embed_model = VoyageEmbedding(
        model_name=EMBEDDING_MODEL,
        voyage_api_key=voyage_key
    )
    tokenizer = tiktoken.get_encoding("cl100k_base")

    # Initialize LlamaChunker for unified chunking
    global chunker
    chunker = LlamaChunker()

    logger.info(f"Starting VectorDB sync for {repo_name} (commit: {commit_sha[:8]})")
    logger.info("Using LlamaIndex for intelligent code-aware chunking")
    logger.info(f"Namespace: '{DEFAULT_NAMESPACE}' (default)" if DEFAULT_NAMESPACE == "" else f"Namespace: '{DEFAULT_NAMESPACE}'")
    logger.info(f"Metadata tag: repo_name='{repo_name}'")

    # Wipe all vectors before syncing (used by --reindex-all)
    if wipe_first:
        logger.warning(f"!!! WIPING ALL VECTORS IN NAMESPACE '{DEFAULT_NAMESPACE or '(default)'}' !!!")
        try:
            index.delete(delete_all=True, namespace=DEFAULT_NAMESPACE)
            logger.info("Namespace wiped successfully.")
        except Exception as e:
            if "namespace not found" in str(e).lower():
                logger.info("Namespace was empty, nothing to wipe.")
            else:
                raise RuntimeError(f"Failed to wipe namespace: {e}")

    total_files = len(files_to_process)
    file_stats = {"processed": 0, "errors": 0, "skipped": 0}
    failures: List[dict] = []
    deleted_files = 0
    upserted_ids: List[str] = []
    total_upserted = 0
    skip_summary = skip_summary or {}
    file_states: dict = {}
    next_file_id = 0
    worker_errors: List[dict] = []
    state_lock = threading.RLock()
    pipeline_stop = threading.Event()
    queue_sentinel = object()
    embedding_queue: Queue = Queue(maxsize=EMBEDDING_QUEUE_MAX_ITEMS)
    upsert_queue: Queue = Queue(maxsize=UPSERT_QUEUE_MAX_ITEMS)
    chunking_progress = ProgressReporter(desc="Chunking files", unit="file")
    embedding_progress = ProgressReporter(desc="Embedding chunks", unit="chunk")
    upsert_progress = ProgressReporter(desc="Upserting chunks", unit="chunk")

    def _log_file_timing(filepath: str, started: float, embed_elapsed: float, pinecone_elapsed: float) -> None:
        total_elapsed = time.perf_counter() - started
        attributed_total = max(total_elapsed, embed_elapsed + pinecone_elapsed)
        other_elapsed = max(0.0, attributed_total - embed_elapsed - pinecone_elapsed)
        if attributed_total > 0:
            embed_pct = (embed_elapsed / attributed_total) * 100.0
            pinecone_pct = (pinecone_elapsed / attributed_total) * 100.0
            other_pct = (other_elapsed / attributed_total) * 100.0
        else:
            embed_pct = 0.0
            pinecone_pct = 0.0
            other_pct = 0.0
        log_timing(
            f"file={filepath} embedding={embed_elapsed:.3f}s ({embed_pct:.1f}%) "
            f"pinecone={pinecone_elapsed:.3f}s ({pinecone_pct:.1f}%) "
            f"other={other_elapsed:.3f}s ({other_pct:.1f}%) total_time={total_elapsed:.3f}s"
        )

    def _log_direct_file_timing(
        filepath: str,
        file_started: float,
        embed_elapsed: float = 0.0,
        pinecone_elapsed: float = 0.0,
    ) -> None:
        _log_file_timing(filepath, file_started, embed_elapsed, pinecone_elapsed)

    def _finalize_file_success(file_id: int) -> None:
        snapshot: Optional[Tuple[str, float, float, float]] = None
        with state_lock:
            state = file_states.get(file_id)
            if not state or state["finalized"]:
                return
            state["finalized"] = True
            file_stats["processed"] += 1
            snapshot = (
                state["file_path"],
                float(state["started"]),
                float(state["embed_seconds"]),
                float(state["pinecone_seconds"]),
            )
        if snapshot is not None:
            _log_file_timing(*snapshot)

    def _finalize_file_error(file_id: int, operation: str, message: str) -> None:
        snapshot: Optional[Tuple[str, float, float, float]] = None
        file_path = ""
        status = "M"
        with state_lock:
            state = file_states.get(file_id)
            if not state or state["finalized"]:
                return
            state["finalized"] = True
            state["failed"] = True
            file_path = str(state["file_path"])
            status = str(state["status"])
            file_stats["errors"] += 1
            failures.append(
                {
                    "file_path": file_path,
                    "operation": operation,
                    "message": message,
                    "status": status,
                }
            )
            snapshot = (
                file_path,
                float(state["started"]),
                float(state["embed_seconds"]),
                float(state["pinecone_seconds"]),
            )
        logger.error(
            "File failed: file=%s operation=%s status=%s error=%s",
            file_path,
            operation,
            status,
            _compact_issue_message(message),
        )
        append_error(errors_out, file_path, operation, message, status=status)
        if snapshot is not None:
            _log_file_timing(*snapshot)

    def _file_is_finalized(file_id: int) -> bool:
        with state_lock:
            state = file_states.get(file_id)
            return bool(not state or state["finalized"])

    def _note_queue_elapsed(queue_items: List[dict], timing_field: str, elapsed: float) -> None:
        if not queue_items or elapsed <= 0:
            return
        per_item = elapsed / len(queue_items)
        with state_lock:
            for item in queue_items:
                state = file_states.get(item["file_id"])
                if not state or state["finalized"]:
                    continue
                state[timing_field] += per_item

    def _record_upsert_success(queue_items: List[dict], elapsed: float) -> None:
        nonlocal total_upserted
        if not queue_items:
            return
        _note_queue_elapsed(queue_items, "pinecone_seconds", elapsed)
        upsert_progress.update(len(queue_items))
        completed_files: List[int] = []
        with state_lock:
            total_upserted += len(queue_items)
            for item in queue_items:
                uid = item["entry"].get("id")
                if isinstance(uid, str):
                    upserted_ids.append(uid)
                state = file_states.get(item["file_id"])
                if not state or state["finalized"]:
                    continue
                state["completed_chunks"] += 1
                if state["completed_chunks"] >= state["expected_chunks"]:
                    completed_files.append(item["file_id"])
        for file_id in completed_files:
            _finalize_file_success(file_id)

    def _put_with_stop(target_queue: Queue, item: object, queue_name: str, allow_stop: bool = True) -> bool:
        while True:
            if allow_stop and pipeline_stop.is_set():
                return False
            try:
                target_queue.put(item, timeout=PIPELINE_QUEUE_PUT_TIMEOUT_SECONDS)
                return True
            except Full:
                continue

    def _register_worker_error(stage: str, exc: Exception) -> None:
        with state_lock:
            worker_errors.append({"stage": stage, "message": str(exc)})
        logger.exception("%s worker failed", stage)
        pipeline_stop.set()

    def _process_embedding_batch(batch_items: List[dict]) -> None:
        active_items = [item for item in batch_items if not _file_is_finalized(item["file_id"])]
        if not active_items:
            return
        active_tokens = sum(embedding_item_tokens(item) for item in active_items)
        with state_lock:
            batch_stats["embedding_batches"] += 1
            batch_stats["embedding_batch_texts_total"] += len(active_items)
            batch_stats["embedding_batch_tokens_total"] += active_tokens
            batch_stats["embedding_batch_texts_max"] = max(
                int(batch_stats["embedding_batch_texts_max"]),
                len(active_items),
            )
            batch_stats["embedding_batch_tokens_max"] = max(
                int(batch_stats["embedding_batch_tokens_max"]),
                active_tokens,
            )
        text_batch = [item["entry"]["metadata"]["content"] for item in active_items]
        try:
            started = time.perf_counter()
            embedding_batch = get_embeddings(text_batch)
            elapsed = time.perf_counter() - started
            _note_queue_elapsed(active_items, "embed_seconds", elapsed)
            embedding_progress.update(len(active_items))
            for item, embedding in zip(active_items, embedding_batch):
                if _file_is_finalized(item["file_id"]):
                    continue
                item["entry"]["values"] = embedding
                item["entry"]["metadata"]["embedded"] = True
                item["estimated_upsert_bytes"] = estimate_upsert_record_bytes(item["entry"])
                if not _put_with_stop(upsert_queue, item, "upsert"):
                    return
        except Exception as batch_error:
            with state_lock:
                batch_stats["embedding_batch_fallbacks"] += 1
            logger.warning(
                "Embedding batch fallback: records=%d est_tokens=%d reason=%s; retrying per file",
                len(active_items),
                active_tokens,
                _compact_issue_message(str(batch_error)),
            )
            for file_id, file_items in group_queue_items_by_file(active_items).items():
                if _file_is_finalized(file_id):
                    continue
                try:
                    started = time.perf_counter()
                    embedding_batch = get_embeddings([item["entry"]["metadata"]["content"] for item in file_items])
                    elapsed = time.perf_counter() - started
                    _note_queue_elapsed(file_items, "embed_seconds", elapsed)
                    embedding_progress.update(len(file_items))
                    for item, embedding in zip(file_items, embedding_batch):
                        if _file_is_finalized(file_id):
                            break
                        item["entry"]["values"] = embedding
                        item["entry"]["metadata"]["embedded"] = True
                        item["estimated_upsert_bytes"] = estimate_upsert_record_bytes(item["entry"])
                        if not _put_with_stop(upsert_queue, item, "upsert"):
                            return
                except Exception as file_error:
                    _finalize_file_error(file_id, "embed", str(file_error))

    def _process_upsert_batch(batch_items: List[dict]) -> None:
        active_items = [item for item in batch_items if not _file_is_finalized(item["file_id"])]
        if not active_items:
            return
        active_bytes = sum(upsert_item_bytes(item) for item in active_items)
        with state_lock:
            batch_stats["upsert_batches"] += 1
            batch_stats["upsert_batch_records_total"] += len(active_items)
            batch_stats["upsert_batch_bytes_total"] += active_bytes
            batch_stats["upsert_batch_records_max"] = max(
                int(batch_stats["upsert_batch_records_max"]),
                len(active_items),
            )
            batch_stats["upsert_batch_bytes_max"] = max(
                int(batch_stats["upsert_batch_bytes_max"]),
                active_bytes,
            )
        try:
            started = time.perf_counter()
            safe_upsert_batch([item["entry"] for item in active_items], repo_name)
            elapsed = time.perf_counter() - started
            with state_lock:
                timing_stats["pinecone_seconds"] += elapsed
            _record_upsert_success(active_items, elapsed)
        except Exception as batch_error:
            with state_lock:
                batch_stats["upsert_batch_fallbacks"] += 1
            logger.warning(
                "Upsert batch fallback: records=%d est_bytes=%d reason=%s; retrying per file",
                len(active_items),
                active_bytes,
                _compact_issue_message(str(batch_error)),
            )
            for file_id, file_items in group_queue_items_by_file(active_items).items():
                if _file_is_finalized(file_id):
                    continue
                try:
                    started = time.perf_counter()
                    safe_upsert_batch([item["entry"] for item in file_items], repo_name)
                    elapsed = time.perf_counter() - started
                    with state_lock:
                        timing_stats["pinecone_seconds"] += elapsed
                    _record_upsert_success(file_items, elapsed)
                except Exception as file_error:
                    _finalize_file_error(file_id, "upsert", str(file_error))

    def _embedding_worker() -> None:
        carry_item: Optional[dict] = None
        saw_sentinel = False
        try:
            while True:
                batch_items: List[dict] = []
                batch_tokens = 0
                while True:
                    if carry_item is not None:
                        item = carry_item
                        carry_item = None
                    else:
                        timeout = None if not batch_items and not saw_sentinel else PIPELINE_BATCH_WAIT_SECONDS
                        try:
                            item = embedding_queue.get(timeout=timeout)
                        except Empty:
                            break
                    if item is queue_sentinel:
                        saw_sentinel = True
                        break
                    if _file_is_finalized(item["file_id"]):
                        continue
                    item_tokens = embedding_item_tokens(item)
                    if batch_items and (
                        len(batch_items) >= EMBEDDING_MAX_TEXTS_PER_BATCH
                        or batch_tokens + item_tokens > EMBEDDING_MAX_TOKENS_PER_BATCH
                    ):
                        carry_item = item
                        break
                    batch_items.append(item)
                    batch_tokens += item_tokens
                    if (
                        len(batch_items) >= EMBEDDING_MAX_TEXTS_PER_BATCH
                        or batch_tokens >= EMBEDDING_MAX_TOKENS_PER_BATCH
                    ):
                        break
                if batch_items:
                    _process_embedding_batch(batch_items)
                    continue
                if saw_sentinel or pipeline_stop.is_set():
                    break
        except Exception as exc:
            _register_worker_error("embedding", exc)

    def _upsert_worker() -> None:
        carry_item: Optional[dict] = None
        saw_sentinel = False
        try:
            while True:
                batch_items: List[dict] = []
                batch_bytes = 0
                while True:
                    if carry_item is not None:
                        item = carry_item
                        carry_item = None
                    else:
                        timeout = None if not batch_items and not saw_sentinel else PIPELINE_BATCH_WAIT_SECONDS
                        try:
                            item = upsert_queue.get(timeout=timeout)
                        except Empty:
                            break
                    if item is queue_sentinel:
                        saw_sentinel = True
                        break
                    if _file_is_finalized(item["file_id"]):
                        continue
                    item_bytes = upsert_item_bytes(item)
                    if batch_items and (
                        len(batch_items) >= PINECONE_MAX_RECORDS_PER_BATCH
                        or batch_bytes + item_bytes > PINECONE_MAX_REQUEST_BYTES
                    ):
                        carry_item = item
                        break
                    batch_items.append(item)
                    batch_bytes += item_bytes
                    if (
                        len(batch_items) >= PINECONE_MAX_RECORDS_PER_BATCH
                        or batch_bytes >= PINECONE_MAX_REQUEST_BYTES
                    ):
                        break
                if batch_items:
                    _process_upsert_batch(batch_items)
                    continue
                if saw_sentinel or pipeline_stop.is_set():
                    break
        except Exception as exc:
            _register_worker_error("upsert", exc)

    embedding_thread = threading.Thread(target=_embedding_worker, name="vector-sync-embedding", daemon=True)
    upsert_thread = threading.Thread(target=_upsert_worker, name="vector-sync-upsert", daemon=True)
    embedding_thread.start()
    upsert_thread.start()

    try:
        for file_index, (status, filepath) in enumerate(files_to_process, start=1):
            if pipeline_stop.is_set():
                break
            file_started = time.perf_counter()
            queued_file_id: Optional[int] = None
            initial_pinecone_elapsed = 0.0

            try:
                path = Path(filepath)
                if path.exists() and path.is_dir():
                    with state_lock:
                        file_stats["skipped"] += 1
                    logger.warning("Skipping directory path during sync: %s", filepath)
                    _log_direct_file_timing(filepath, file_started)
                    continue

                if status == "D":
                    pinecone_started = time.perf_counter()
                    safe_delete_vectors(filepath, repo_name)
                    initial_pinecone_elapsed = time.perf_counter() - pinecone_started
                    with state_lock:
                        timing_stats["pinecone_seconds"] += initial_pinecone_elapsed
                        deleted_files += 1
                    _log_direct_file_timing(filepath, file_started, pinecone_elapsed=initial_pinecone_elapsed)
                    continue

                if not path.exists():
                    with state_lock:
                        file_stats["skipped"] += 1
                    raise FileNotFoundError(f"File marked as {status} but not found: {filepath}")

                if status in ("A", "M") and not wipe_first:
                    pinecone_started = time.perf_counter()
                    safe_delete_vectors(filepath, repo_name)
                    initial_pinecone_elapsed = time.perf_counter() - pinecone_started
                    with state_lock:
                        timing_stats["pinecone_seconds"] += initial_pinecone_elapsed
                        deleted_files += 1

                logger.info(
                    "[progress] Chunking file index=%d/%d path=%s",
                    file_index,
                    total_files,
                    filepath,
                )
                chunk_entries = prepare_file_chunks(filepath, status, repo_name, commit_sha)
                chunking_progress.update(1)
                next_file_id += 1
                queued_file_id = next_file_id
                with state_lock:
                    file_states[queued_file_id] = {
                        "file_path": filepath,
                        "status": status,
                        "started": file_started,
                        "embed_seconds": 0.0,
                        "pinecone_seconds": initial_pinecone_elapsed,
                        "expected_chunks": len(chunk_entries),
                        "completed_chunks": 0,
                        "finalized": False,
                        "failed": False,
                    }

                if not chunk_entries:
                    _finalize_file_success(queued_file_id)
                    continue

                for entry in chunk_entries:
                    metadata = entry.get("metadata", {})
                    should_embed = bool(metadata.get("should_embed")) and int(metadata.get("token_count", 0)) <= MAX_TOKENS
                    if metadata.get("chunk_type") == "content" and not should_embed:
                        raise RuntimeError(
                            f"Content chunk exceeds embedding token limit after re-chunking: {filepath}"
                        )

                    queue_item = {
                        "file_id": queued_file_id,
                        "file_path": filepath,
                        "status": status,
                        "entry": entry,
                        "estimated_upsert_bytes": 0,
                    }
                    if should_embed:
                        if not _put_with_stop(embedding_queue, queue_item, "embedding"):
                            raise RuntimeError("Embedding pipeline stopped while queueing chunks")
                    else:
                        queue_item["estimated_upsert_bytes"] = estimate_upsert_record_bytes(entry)
                        if not _put_with_stop(upsert_queue, queue_item, "upsert"):
                            raise RuntimeError("Upsert pipeline stopped while queueing chunks")
            except Exception as e:
                if queued_file_id is not None:
                    _finalize_file_error(queued_file_id, "process", str(e))
                else:
                    with state_lock:
                        file_stats["errors"] += 1
                        failures.append({"file_path": filepath, "operation": "process", "message": str(e), "status": status})
                    logger.error(
                        "File failed before queue registration: file=%s operation=process status=%s error=%s",
                        filepath,
                        status,
                        _compact_issue_message(str(e)),
                    )
                    append_error(errors_out, filepath, "process", str(e), status=status)
                    _log_direct_file_timing(filepath, file_started, pinecone_elapsed=initial_pinecone_elapsed)
    finally:
        _put_with_stop(embedding_queue, queue_sentinel, "embedding", allow_stop=False)
        embedding_thread.join()
        if upsert_thread.is_alive():
            _put_with_stop(upsert_queue, queue_sentinel, "upsert", allow_stop=False)
        upsert_thread.join()
        chunking_progress.close()
        embedding_progress.close()
        upsert_progress.close()

    logger.info(f"\nSync Complete for {repo_name}:")
    logger.info(f"  - Namespace: '{DEFAULT_NAMESPACE}' (default)" if DEFAULT_NAMESPACE == "" else f"  - Namespace: '{DEFAULT_NAMESPACE}'")
    logger.info(f"  - Files processed: {file_stats['processed']}")
    logger.info(f"  - Files skipped: {file_stats['skipped']}")
    if skip_summary:
        omitted_total = sum(int(details.get("omitted", 0)) for details in skip_summary.values())
        delete_handled_total = sum(int(details.get("delete_handled", 0)) for details in skip_summary.values())
        logger.info(f"  - Files omitted by --skip-paths: {omitted_total}")
        logger.info(f"  - Files handled as delete-only by --skip-paths: {delete_handled_total}")
        for skip_path in sorted(skip_summary.keys()):
            details = skip_summary[skip_path]
            logger.info(
                "    - skip path '%s': omitted=%d delete_handled=%d",
                skip_path,
                int(details.get("omitted", 0)),
                int(details.get("delete_handled", 0)),
            )
    logger.info(f"  - Files with errors: {file_stats['errors']}")
    logger.info(f"  - Vectors deleted: {deleted_files} files")
    logger.info(f"  - Chunks upserted: {total_upserted}")
    logger.info(f"  - Embedding model: {EMBEDDING_MODEL}")
    embedding_batches = int(batch_stats["embedding_batches"])
    upsert_batches = int(batch_stats["upsert_batches"])
    embedding_avg_texts = (
        float(batch_stats["embedding_batch_texts_total"]) / embedding_batches
        if embedding_batches else 0.0
    )
    embedding_avg_tokens = (
        float(batch_stats["embedding_batch_tokens_total"]) / embedding_batches
        if embedding_batches else 0.0
    )
    upsert_avg_records = (
        float(batch_stats["upsert_batch_records_total"]) / upsert_batches
        if upsert_batches else 0.0
    )
    upsert_avg_bytes = (
        float(batch_stats["upsert_batch_bytes_total"]) / upsert_batches
        if upsert_batches else 0.0
    )
    logger.info(
        "  - Embedding batches: %d (avg_texts=%.1f, max_texts=%d, avg_est_tokens=%.0f, max_est_tokens=%d, fallbacks=%d)",
        embedding_batches,
        embedding_avg_texts,
        int(batch_stats["embedding_batch_texts_max"]),
        embedding_avg_tokens,
        int(batch_stats["embedding_batch_tokens_max"]),
        int(batch_stats["embedding_batch_fallbacks"]),
    )
    logger.info(
        "  - Upsert batches: %d (avg_records=%.1f, max_records=%d, avg_est_bytes=%.0f, max_est_bytes=%d, fallbacks=%d)",
        upsert_batches,
        upsert_avg_records,
        int(batch_stats["upsert_batch_records_max"]),
        upsert_avg_bytes,
        int(batch_stats["upsert_batch_bytes_max"]),
        int(batch_stats["upsert_batch_fallbacks"]),
    )
    total_embed_seconds = float(timing_stats["embed_seconds"])
    total_pinecone_seconds = float(timing_stats["pinecone_seconds"])
    total_run_seconds = time.perf_counter() - run_started
    attributed_run_total = max(total_run_seconds, total_embed_seconds + total_pinecone_seconds)
    total_other_seconds = max(0.0, attributed_run_total - total_embed_seconds - total_pinecone_seconds)
    if attributed_run_total > 0:
        embed_pct = (total_embed_seconds / attributed_run_total) * 100.0
        pinecone_pct = (total_pinecone_seconds / attributed_run_total) * 100.0
        other_pct = (total_other_seconds / attributed_run_total) * 100.0
    else:
        embed_pct = 0.0
        pinecone_pct = 0.0
        other_pct = 0.0
    log_timing(
        f"summary embedding={total_embed_seconds:.3f}s ({embed_pct:.1f}%) "
        f"pinecone={total_pinecone_seconds:.3f}s ({pinecone_pct:.1f}%) "
        f"other={total_other_seconds:.3f}s ({other_pct:.1f}%) total_time={total_run_seconds:.3f}s"
    )
    if worker_errors:
        logger.error(f"{len(worker_errors)} pipeline worker failures encountered.")
        for worker_error in worker_errors:
            logger.error(
                f"  - worker failure: stage={worker_error['stage']} message={worker_error['message']}"
            )
        raise SystemExit(1)
    if failures:
        logger.error(
            f"{len(failures)} failures encountered. See {errors_out} for details. Use --retry-errors to re-run.")
        for f in failures:
            logger.error(
                f"  - failure: op={f.get('operation')} status={f.get('status')} file={f.get('file_path')} message={f.get('message')}")
        raise SystemExit(1)
    return {"namespace": DEFAULT_NAMESPACE, "repo_name": repo_name, "upserted_ids": upserted_ids}


if __name__ == "__main__":
    main_entry()

