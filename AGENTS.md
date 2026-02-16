# Repository Guidelines

## Project Structure & Module Organization
- `index.html` hosts the single-page UI (embedded styles and scripts).
- `latex-unicode.js` provides LaTeX-to-Unicode helpers used by the UI.
- `netlify/functions/` contains serverless endpoints:
  - `summarize.mjs` fetches playlist videos, transcripts, and Claude summaries.
  - `delete-video.mjs` removes a video from a playlist via OAuth.
- `youtube_playlist_summarizer.py` is the CLI workflow for batch summaries.
- `netlify.toml` configures Netlify function settings.

## Build, Test, and Development Commands
- `python youtube_playlist_summarizer.py <playlist_id> [days_back] [max_workers]`
  Runs the local batch summarizer (requires env vars below).
- `npm install`
  Installs JavaScript dependencies used by Netlify functions.

## Configuration & Secrets
- Python CLI uses `YOUTUBE_DATA_API_KEY`, `ANTHROPIC_API_TOKEN`, and optional `ANTHROPIC_BASE_URL`.
- Netlify delete function requires `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.
- The summarize function expects request-time keys: `youtubeApiKey`, `transcriptApiKey`, `claudeApiKey`.
Never commit secrets; use `.env` or Netlify environment settings.

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` functions, `PascalCase` classes.
- JavaScript/Netlify: 2-space indentation, `camelCase` variables/functions.
- Filenames are lowercase with hyphens for functions (e.g., `delete-video.mjs`).

## Testing Guidelines
- No automated test suite is present. If adding tests, note the framework and how to run it in this file.

## Commit & Pull Request Guidelines
- Commit messages follow short, imperative summaries (e.g., “Fix mobile UX...”, “Replace PDF export...”).
- Keep PRs focused: include a clear description, link related issues, and add UI screenshots for front-end changes.
