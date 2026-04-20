# Private Repo Support & Public/Internal Two-Agent Response

## Goal

Add support for ingesting private/internal repositories and distinguish responses via two agents:
- **Public agent** — answers using only public-source vectors
- **Internal agent** — takes the public answer, then layers in private/internal details when the user has access

## Background

Two source paths already exist and need to be unified:
1. Pre-trained repo RAG (vectors in Pinecone `repo-chunks`, filtered by `repo_name`)
2. PAT-based GitHub repo context (ad hoc access via `x-github-pat` header → GitHub MCP)

The gap: private repo chunks cannot safely go into the shared vector pool without source-level ACLs. That is the load-bearing architectural change.

---

## 1. Source Registry

**New DB table: `ingested_sources`**

| column | type | notes |
|--------|------|-------|
| `source_id` | uuid PK | |
| `repo_name` | text | matches Pinecone `repo_name` metadata |
| `owner_org` | text | GitHub org or user |
| `visibility` | enum `public \| internal` | |
| `permitted_user_ids` | text[] | empty = public (all users) |
| `ingestion_status` | enum `pending \| active \| error` | |
| `last_ingested_at` | timestamp | |
| `commit_sha` | text | last ingested commit |

Expose via `/api/sources` (GET list, PATCH status). Use this as the single source of truth for what is trained and who can see it. Reuse the existing `github_repositories` table for PAT-based (ad hoc) repos — those stay out of the vector pool.

---

## 2. Ingestion Changes (`vector_db_sync.py`)

Add two new metadata fields to every vector at upsert time:

```python
metadata = {
    # existing
    "repo_name": repo_name,
    "file_path": file_path,
    "file_type": file_type,
    "chunk_type": chunk_type,
    "embedded": True,
    "commit_sha": commit_sha,
    "indexed_at": iso_timestamp,
    # new
    "visibility": "public" | "internal",   # from source registry
    "permitted_user_ids": [],               # empty list = public
}
```

Pull `visibility` and `permitted_user_ids` from the source registry at ingestion time (or pass as CLI flags). No private chunks go in without `visibility: "internal"` set.

**Do not backfill existing public vectors** — absence of `visibility` field can be treated as `"public"` during retrieval.

---

## 3. Retrieval Access Filter (`rag-context-builder.ts`)

Current filter:
```ts
{ $and: [{ chunk_type: "content" }, { embedded: true }, { repo_name: { $in: repoNames } }] }
```

New filter for **public-only** queries:
```ts
{ $and: [
  { chunk_type: "content" },
  { embedded: true },
  { repo_name: { $in: repoNames } },
  { $or: [{ visibility: { $eq: "public" } }, { visibility: { $exists: false } }] }
]}
```

New filter for **internal** queries (user has access):
```ts
{ $and: [
  { chunk_type: "content" },
  { embedded: true },
  { repo_name: { $in: repoNames } },
  { $or: [
    { visibility: { $eq: "public" } },
    { visibility: { $exists: false } },
    { $and: [{ visibility: { $eq: "internal" } }, { permitted_user_ids: { $in: [userId] } }] }
  ]}
]}
```

Add `buildPublicFilter()` and `buildInternalFilter(userId)` helpers alongside the existing `buildPineconeFilter()`. Apply the same filter for both the initial RAG context and any tool-based follow-up retrieval.

---

## 4. Two-Agent Response Flow (`/api/chat/route.ts`)

### Determine mode

```ts
type ResponseMode = "public" | "internal";
```

Mode is `"internal"` if the user is authenticated **and** has at least one permitted internal source in their repo selection. Otherwise `"public"`.

### Public mode (unchanged behavior)

1. Build RAG context with public filter
2. Pass to single `ChatAgent` — existing flow, no change

### Internal mode (new two-stage flow)

1. **Public agent** — build RAG context with public filter, run agent, collect full response
2. **Internal agent** — build RAG context with internal filter (adds private chunks), run second agent with:
   - The original user message
   - The public agent's response as prior context
   - The additional private-source RAG context
   - System instruction: *"The public answer is provided above. Add or correct based on internal sources only where you have additional information. Do not repeat what is already covered."*
3. Stream the internal agent response to the client

The public agent response can be streamed immediately; the internal agent response follows as a second message (or a continuation, depending on UX decision — see Sources section below).

---

## 5. Sources List (Mounika's component)

Extend `RagSource` type to carry visibility:

```ts
type RagSource = {
  id: string;
  score: number;
  filePath: string;
  lineRange?: string;
  content: string;
  visibility?: "public" | "internal"; // new
};
```

In the `Sources` component, render a badge on internal sources:
- Public: no badge (current behavior)
- Internal/private: `[private]` badge or lock icon

The Sources panel becomes the unified place to show both trained sources (from Pinecone) and ad hoc GitHub sources (from MCP tool calls), with private/internal clearly distinguished.

---

## 6. Ingestion Page Additions

Add a todo/roadmap section to the ingestion UI or admin page:

- [ ] Private repo source registry (table + `/api/sources` endpoint)
- [ ] Secure private-repo ingestion flow (ACL metadata in vectors)
- [ ] Retrieval access filters (`buildPublicFilter`, `buildInternalFilter`)
- [ ] Public/Internal two-stage response flow
- [ ] Unified Sources list with private badges

---

## Implementation Order

1. **DB + source registry** — add `ingested_sources` table, `/api/sources` route
2. **Ingestion metadata** — add `visibility`/`permitted_user_ids` to vector upsert
3. **Retrieval filters** — `buildPublicFilter` / `buildInternalFilter` in `rag-context-builder.ts`
4. **Two-agent flow** — update `/api/chat/route.ts` to route by mode
5. **Sources UI** — extend `RagSource` type + badge in `source.tsx`
6. **Repo picker** — reuse GitHub PAT flow for private repo discovery/selection in the Sources nav (no separate picker needed)

---

## What to Reuse

- GitHub PAT verification (`lib/verification/github-verification-service.ts`) — for repo discovery and access checking
- `github_repositories` table — tracks per-user ad hoc repos (PAT-based), keep separate from trained `ingested_sources`
- `rag-context-builder.ts` — extend, not replace; both filter helpers live here
- `source.tsx` — extend `RagSource` type + add badge; minimal change
- Existing Pinecone namespace and index — no migration needed, just add metadata fields going forward

## What NOT to Do

- Do not put private chunks into the shared vector pool without `visibility: "internal"` and `permitted_user_ids` set
- Do not merge `github_repositories` (ad hoc) and `ingested_sources` (trained) into one table — different lifecycle
- Do not run the internal agent if the user has no internal sources selected (fall back to public mode silently)
