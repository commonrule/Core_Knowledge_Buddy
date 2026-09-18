# Study Buddy – Project Instructions

## API Keys
Do not ask the user for API keys. Do not prompt for, request, or discuss Anthropic API keys when working on this project.

## Stack
- Plain HTML, CSS and JavaScript served as a static site (GitHub Pages). No npm, no bundler, no framework.
- Script load order in `index.html`: `data/*.js` (generated curriculum), `js/subjects.js`, `js/curriculum.js`, `js/app.js`.
- `js/subjects.js` and `js/curriculum.js` must stay DOM-free so `node tools/test_prompts.js` can run them.

## Curriculum data
- Source material lives at `~/Codex/Core_knowledge` (Core Knowledge Sequence PDF + per-subject unit PDFs).
- Everything under `data/` except `data/briefs-*.js` is GENERATED. Regenerate with the scripts in `tools/` (see `tools/README.md`); never hand-edit generated files.
- Unit briefs (`data/briefs-<grade>.js`) are authored from teacher-guide excerpts in `build/tg/` and may be edited by hand.

## Local preview
- `python3 -m http.server 8080` from the project root (or the `study-buddy` entry in `.claude/launch.json`).
