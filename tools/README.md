# Regenerating curriculum data

Source material lives at `~/Codex/Core_knowledge` (change the paths below if it moves):
- `SequenceK_8/CK_Sequence2023_GK8_W3.pdf` — the Core Knowledge Sequence (all subjects, K-8)
- `Core_KnowLedge_<Subject>/Grade<k|1-8>/Unit*/...` — unit PDFs (teacher guides `*_TG*.pdf`, student readers `*_SR*.pdf`, activity books)

All tools use only what ships with macOS (Swift + PDFKit, Python 3).

## 1. Sequence → data/{math,history,science,ela,music,arts}.js
```bash
swift tools/pdf2txt.swift ~/Codex/Core_knowledge/SequenceK_8/CK_Sequence2023_GK8_W3.pdf build/ck_sequence.txt
python3 tools/build_curriculum.py
```
The builder reads page ranges from the PDF's table of contents (PDF page = printed page + 14), parses roman-numeral
sections, lettered subsections and bullet points, strips footers and margin notes, and prints a table of
sections/subsections/skills per subject and grade. Skill granularity: every bullet for math (Common Core
standards), every subsection for the other subjects. Known limitation: math fraction typography from the PDF
is mangled (e.g. "a/b" comes out as "ba").

## 2. Unit folders → data/units.js
```bash
python3 tools/build_units.py
```
Scans every subject/grade/unit folder, classifies PDFs (teacher guide, student reader, activity book), and takes
titles from folder names or the `Grade*_download_manifest.json` slugs. Extras (Connecting Math to Our World,
Science in Action, Primary Source Activity Books, ancillary materials) are marked `kind: "extra"`; the Core
Classics library (readers without a grade tag) is under `units.classics.any`.

## 3. Unit briefs (data/briefs-<grade>.js) — hand-authored
For each unit, dump the front matter of its teacher guide and read it:
```bash
swift tools/pdf2txt.swift "<path to TG.pdf>" build/tg/<unitId>.txt 1 32
```
Useful pages: CKHG — "The Big Idea", "What Students Need to Learn", "Big Questions", "Core Vocabulary" tables;
CKSci — the "Unit Storyline" table (lesson questions and "what we figure out"); CKLA — the Introduction and
Pacing Guide; CKMath — the table of contents and "Student Learning Targets" (the CKMath teacher guides are
image-based PDFs except for their first pages; the lesson list matches Illustrative Mathematics 6–8).
Then write an entry per unit in the shape used by `data/briefs-6.js`. Optional: automate the summarizing step
with the Anthropic Python SDK reading `ANTHROPIC_API_KEY` from the environment and the same excerpts as input.

## 4. Check
```bash
node tools/test_prompts.js
grep -c "Ź" data/*.js   # should be 0
```
Mastery keys are `sectionIndex:skillIndex` per subject and grade, so regenerating data can shift which skill a
saved key points to; counts and XP are unaffected.
