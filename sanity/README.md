# Sanity Mount Setup

The `sanity/` submodule is not edited directly by this integration.

`node chat/server.mjs` prepares a derived runtime copy outside the submodule, then mounts it at:

- `http://localhost:8888/sanity/`
- `http://localhost:8888/sanity/admin`

If Sanity env vars are missing or invalid, the combined server stays up and `/sanity` serves a local fallback status/setup page from `chat/server.mjs` instead of crashing the shared dev host.

Use the local env file (the one `automation/paths.yaml` points at) as the shared local config source for Sanity values. Add these placeholders to `automation/.env.example` and set real values in your local env file:

```env
NEXT_PUBLIC_SANITY_PROJECT_ID=your_sanity_project_id
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_READ_TOKEN=your_sanity_viewer_token
NEXT_PUBLIC_BASE_URL=http://localhost:8888/sanity
```

What comes from Sanity:

- `NEXT_PUBLIC_SANITY_PROJECT_ID`: your Sanity project ID
- `NEXT_PUBLIC_SANITY_DATASET`: your dataset name, often `production`
- `SANITY_API_READ_TOKEN`: a Sanity API token with Viewer permissions

What does not come from Sanity:

- `NEXT_PUBLIC_BASE_URL`: local mounted URL for this webroot setup

Injected automatically by `chat/server.mjs` for the mounted runtime:

- `NEXT_PUBLIC_BASE_PATH=/sanity`

Notes:

- `projectId` and `dataset` are public identifiers and safe to expose as `NEXT_PUBLIC_*`.
- `SANITY_API_READ_TOKEN` is a secret and should only live in your local env file, not in committed config with a real value.
- The mounted runtime copy is rebuilt from the pristine `sanity/` source when `start chat` runs.
- You can usually discover `projectId` and `dataset` from existing Sanity project config or the Sanity CLI.
- Existing token secrets generally cannot be retrieved later; if needed, create a new Viewer token in Sanity.
