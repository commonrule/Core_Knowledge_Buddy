# Study Buddy — Core Knowledge K-8 Tutor

A multi-subject AI tutor for kids (History & Geography, Math, Science, English, Core Classics) built on the
Core Knowledge curriculum. It is the successor to Math Buddy (Eureka Math): same owl, same login, avatars,
PIN codes, XP and leaderboard — now with a subject picker, real Core Knowledge units, and lesson-by-lesson
detail for Grade 6.

## How it works
- Static site: `index.html`, `styles.css`, `js/`, `data/`. No build step, no framework. Deployed to GitHub Pages
  by `.github/workflows/deploy.yml`.
- The Anthropic API key is **not** in this site. The app calls a Cloudflare Worker (`worker/`) that holds the
  key as a secret and forwards requests. Nothing sensitive appears in the page source.
- `js/subjects.js` — subject registry (colors, tutoring style, test guidance) and all prompt builders. DOM-free.
- `js/curriculum.js` — curriculum accessors, mastery keys (`masteredSkills[subject][grade]`), XP. DOM-free.
- `js/app.js` — screens, auth, student picker, chat, skills test, report card, leaderboard.
- `data/*.js` — GENERATED from the Core Knowledge Sequence and unit folders (see `tools/README.md`).
- `data/briefs-6.js` — hand-authored Grade 6 unit briefs (lessons, big ideas, vocabulary, tips).

## Run locally
```bash
python3 -m http.server 8080
```
Then open http://localhost:8080. It calls the deployed worker, which allows `http://localhost:8080` as an origin,
so local runs work without any key on your machine.

## Tests
```bash
node tools/test_prompts.js
```
Builds prompts against the real data and checks the skills/XP/migration helpers.

## Migrating from Math Buddy
Use **Profile → Download Backup** on the old site and **Restore from Backup** here. Old math mastery moves under
`math`, sessions are re-keyed, and XP carries over.

## Content licensing
Curriculum text is derived from Core Knowledge Foundation materials made available under the
Creative Commons Attribution-NonCommercial-ShareAlike 4.0 license. CKMath 6–8 is adapted from
Illustrative Mathematics (CC BY 4.0). This project is for personal, noncommercial use.
