#!/usr/bin/env python3
"""Parse the extracted Core Knowledge Sequence text into per-subject curriculum data files.

Usage: python3 tools/build_curriculum.py [build/ck_sequence.txt]
Writes data/{math,history,science,ela,music,arts}.js
"""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "build", "ck_sequence.txt")
DATA = os.path.join(HERE, "..", "data")
PAGE_OFFSET = 14  # printed page + 14 = PDF page (verified: Grade 5 overview printed 140 = PDF page 154)

GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8"]
TOC_SUBJECTS = {
    "English Language Arts": ("ela", "English Language Arts"),
    "World History and Geography": ("history", "World History and Geography"),
    "American History and Geography": ("history", "American History and Geography"),
    "History and Geography": ("history", "History and Geography"),
    "Visual Arts": ("arts", "Visual Arts"),
    "Music": ("music", "Music"),
    "Mathematics": ("math", "Mathematics"),
    "Science": ("science", "Science"),
}
# skills granularity: 'point' = every bullet is a skill (math); 'subsection' = each lettered subsection is a skill
GRANULARITY = {"math": "point", "history": "subsection", "science": "subsection", "ela": "subsection", "music": "subsection", "arts": "subsection"}

ROMAN = r"(?:X{0,3})(?:IX|IV|V?I{0,3})"
RE_PAGE = re.compile(r"^===== PDF PAGE (\d+) =====$")
RE_FOOTER = re.compile(r"^(Core Knowledge Sequence \| (Kindergarten|Grade \d)\s*\d+|\d+\s+(Kindergarten|Grade \d)\s*\|?\s*Core Knowledge Sequence|(Kindergarten|Grade \d) \| .*)$")
RE_SECTION = re.compile(rf"^({ROMAN})\.\s*(.*)$")
RE_SUBSECTION = re.compile(r"^([A-H])\.\s+(?:([A-H])\.\s+)?(.*)$")
RE_BULLET_ONLY = re.compile(r"^[•●]\s*$")
RE_BULLET_TEXT = re.compile(r"^[•●]\s+(.*)$")
RE_SUB = re.compile(r"^[-–]\s+(.*)$")
RE_SUBSUB = re.compile(r"^[Ź»›]\s*(.*)$")
RE_NOTE_START = re.compile(r"^(See also|See below|Teachers:|Note:|Teachers should)")
RE_GRADE_LINE = re.compile(r"^(Kindergarten|Grade \d)$")
RE_STRAND = re.compile(r"^(World History and Geography|American History and Geography|History and Geography|English Language Arts|Language Arts|Visual Arts|Music|Mathematics|Science)$")

def load_pages(path):
    pages = {}
    cur = None
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        m = RE_PAGE.match(line)
        if m:
            cur = int(m.group(1)); pages[cur] = []
        elif cur is not None:
            pages[cur].append(line)
    return pages

def parse_toc(pages):
    """Return {(grade, subjectName): (startPrinted, endPrinted)} using PDF pages 4-6."""
    entries = []
    grade = None
    for p in (4, 5, 6):
        for line in pages.get(p, []):
            line = line.strip()
            gm = RE_GRADE_LINE.match(line)
            if gm:
                grade = "K" if gm.group(1) == "Kindergarten" else gm.group(1).split()[1]
                continue
            if line.startswith("Appendix A"):
                grade = "APPENDIX"
            m = re.match(r"^(.*?)\s*\.?\s*\.{3,}\s*(\d+)$", line)
            if m and grade:
                entries.append((grade, m.group(1).strip().rstrip(" ."), int(m.group(2))))
    ranges = {}
    for i, (g, name, start) in enumerate(entries):
        end = entries[i + 1][2] - 1 if i + 1 < len(entries) else start + 6
        if g in GRADES and name in TOC_SUBJECTS:
            ranges[(g, name)] = (start, end)
    return ranges

def clean_lines(lines):
    out = []
    for raw in lines:
        s = raw.strip().replace(" ", " ")
        if not s or RE_FOOTER.match(s) or RE_GRADE_LINE.match(s) or s.startswith("Overview of Topics"):
            continue
        if re.fullmatch(r"\d{1,3}", s):  # bare page number
            continue
        # A page number can be glued to the heading that follows it on the same
        # line, e.g. "166 III. Modeling Earth's Systems" — strip it so the
        # section/subsection regexes still match.
        s = re.sub(r"^\d{1,3}\s+(?=[IVX]{1,7}\.\s)", "", s)
        s = re.sub(r"^\d{1,3}\s+(?=[A-H]\.\s)", "", s)
        out.append(s)
    return out

def is_boundary(s):
    return bool(RE_SECTION.match(s) and RE_SECTION.match(s).group(1)) or bool(RE_SUBSECTION.match(s)) or bool(RE_BULLET_ONLY.match(s)) or bool(RE_BULLET_TEXT.match(s)) or bool(RE_STRAND.match(s))

def ends_point(line):
    """Heuristic: does this line end a sentence/phrase (as opposed to wrapping)?"""
    return bool(re.search(r"[.!?;:)]$|[.!?][”\"]$", line)) or len(line) < 62

def boundary_score(a, b):
    """How likely is it that line b starts a new bullet point after line a?"""
    score = 0
    if re.search(r"[.!?;:)]$|[.!?][”\"]$", a): score += 3
    if len(a) < 62: score += 2
    if re.match(r"^[A-Z0-9“\"(]", b): score += 1
    if re.search(r"(,|\b(and|or|of|the|a|an|to|with|in|for|but|as|by|into|from|on|at|that|which|such|—|-))$", a): score -= 3
    if re.match(r"^(and|or|but|of|the|a|an|to|with|in|for|as|by|into|from|on|at|that|which|such)\b", b): score -= 3
    return score

class Run:
    """A bullet run: k bullet glyphs followed by text lines (main points with optional sub-bullets)."""
    def __init__(self):
        self.k = 0
        self.mains = []   # each: {"lines": [...], "subs": [ [line, ...], ... ]}
        self.mode = None  # 'main' or 'sub'

    def add_bullet(self):
        self.k += 1

    def _cur(self):
        if not self.mains:
            self.mains.append({"lines": [], "subs": []})
        return self.mains[-1]

    def add_main_line(self, line):
        cur = self._cur()
        if not cur["lines"] and not cur["subs"]:
            cur["lines"].append(line); self.mode = "main"; return
        if self.mode == "sub":
            last_sub = cur["subs"][-1]
            if not ends_point(last_sub[-1]):
                last_sub.append(line); return
            self.mains.append({"lines": [line], "subs": []}); self.mode = "main"; return
        # mode main: continuation or new point
        if cur["lines"] and not ends_point(cur["lines"][-1]):
            cur["lines"].append(line)
        else:
            self.mains.append({"lines": [line], "subs": []})
        self.mode = "main"

    def add_sub(self, text):
        cur = self._cur()
        cur["subs"].append([text]); self.mode = "sub"

    def add_subsub(self, text):
        cur = self._cur()
        if not cur["subs"]:
            cur["subs"].append([text])
        else:
            cur["subs"][-1].append("; " + text)
        self.mode = "sub"

    def finish(self):
        """Return list of point strings, honoring the bullet count k where possible."""
        mains = [m for m in self.mains if m["lines"] or m["subs"]]
        k = self.k if self.k > 0 else len(mains)
        # too many mains: merge across the weakest boundaries (only mains without subs in between)
        while len(mains) > k and len(mains) > 1:
            best, best_i = None, None
            for i in range(1, len(mains)):
                if mains[i-1]["subs"] or not mains[i]["lines"] or not mains[i-1]["lines"]: continue
                sc = boundary_score(mains[i-1]["lines"][-1], mains[i]["lines"][0])
                if best is None or sc < best: best, best_i = sc, i
            if best_i is None: break
            mains[best_i-1]["lines"] += mains[best_i]["lines"]
            mains[best_i-1]["subs"] = mains[best_i]["subs"]
            del mains[best_i]
        # too few mains: split multi-line mains at the strongest boundary
        while len(mains) < k:
            best, best_ij = None, None
            for i, m in enumerate(mains):
                for j in range(1, len(m["lines"])):
                    sc = boundary_score(m["lines"][j-1], m["lines"][j])
                    if best is None or sc > best: best, best_ij = sc, (i, j)
            if best_ij is None or best < 2: break
            i, j = best_ij
            m = mains[i]
            mains[i:i+1] = [{"lines": m["lines"][:j], "subs": []}, {"lines": m["lines"][j:], "subs": m["subs"]}]
        out = []
        for m in mains:
            text = re.sub(r"\s+", " ", " ".join(m["lines"])).strip()
            if text: out.append(text)
            for sub in m["subs"]:
                st = re.sub(r"\s+", " ", " ".join(sub)).replace(" ;", ";").strip()
                if st: out.append("– " + st)
        return out

def parse_body(lines, strand_names):
    """Parse cleaned lines into strands -> sections -> subsections -> points."""
    strands = []
    state = {"strand": None, "sec": None, "sub": None, "run": None, "note": None, "pending": None}

    def new_strand(name):
        st = {"name": name, "note": "", "sections": []}
        strands.append(st); state.update(strand=st, sec=None, sub=None)

    def ensure_strand():
        if state["strand"] is None: new_strand(strand_names[0])

    def ensure_sub():
        if state["sec"] is None:
            ensure_strand()
            sec = {"num": "", "title": "", "note": "", "subsections": []}
            state["strand"]["sections"].append(sec); state["sec"] = sec
        if state["sub"] is None:
            sub = {"letter": "", "title": "", "points": []}
            state["sec"]["subsections"].append(sub); state["sub"] = sub
        return state["sub"]

    def flush_run():
        run = state["run"]
        if run is not None:
            pts = run.finish()
            if pts: ensure_sub()["points"].extend(pts)
        state["run"] = None

    def flush_note():
        nb = state["note"]
        if nb:
            text = re.sub(r"\s+", " ", " ".join(nb)).strip()
            if not text.startswith("See") and len(text) > 20:
                target = state["sec"] or state["strand"]
                if target is None: ensure_strand(); target = state["strand"]
                target["note"] = (target["note"] + " " + text).strip()
        state["note"] = None

    for line in lines:
        pend = state["pending"]
        if pend is not None:
            state["pending"] = None
            if not is_boundary(line):
                pend["title"] = line.strip(" •●"); continue
        if RE_NOTE_START.match(line):
            flush_run(); flush_note(); state["note"] = [line]; continue
        if state["note"] is not None:
            nb = state["note"]
            if is_boundary(line) or (nb[0].startswith("See") and len(line) > 48):
                flush_note()
            else:
                nb.append(line); continue
        sm = RE_STRAND.match(line)
        if sm and (sm.group(1) in strand_names or len(strand_names) == 1):
            flush_run(); flush_note()
            name = sm.group(1) if sm.group(1) in strand_names else strand_names[0]
            st = state["strand"]
            if st is not None and st["name"] == name and not st["sections"]: continue
            new_strand(name); continue
        m = RE_SECTION.match(line)
        if m and m.group(1):
            flush_run(); flush_note(); ensure_strand()
            title = m.group(2).strip()
            sec = {"num": m.group(1), "title": title, "note": "", "subsections": []}
            state["strand"]["sections"].append(sec); state.update(sec=sec, sub=None)
            sm2 = RE_SUBSECTION.match(title)
            if sm2:
                sec["title"] = ""
                sub = {"letter": sm2.group(1), "title": sm2.group(3).strip(), "points": []}
                sec["subsections"].append(sub); state["sub"] = sub
            elif not title or title in ("•", "●"):
                sec["title"] = ""; state["pending"] = sec
            continue
        m = RE_SUBSECTION.match(line)
        if m and state["sec"] is not None:
            flush_run(); flush_note()
            sub = {"letter": m.group(1), "title": m.group(3).strip(), "points": []}
            state["sec"]["subsections"].append(sub); state["sub"] = sub
            if not sub["title"] or sub["title"] in ("•", "●"):
                sub["title"] = ""; state["pending"] = sub
            continue
        run = state["run"]
        if RE_BULLET_ONLY.match(line):
            if run is not None and run.mains: flush_run(); run = None
            if run is None: run = Run(); state["run"] = run
            run.add_bullet(); continue
        m = RE_BULLET_TEXT.match(line)
        if m:
            if run is not None and run.mains: flush_run(); run = None
            if run is None: run = Run(); state["run"] = run
            run.add_bullet(); run.add_main_line(m.group(1)); continue
        m = RE_SUB.match(line)
        if m:
            if run is None: run = Run(); state["run"] = run
            run.add_sub(m.group(1)); continue
        m = RE_SUBSUB.match(line)
        if m:
            if run is None: run = Run(); state["run"] = run
            run.add_subsub(m.group(1)); continue
        # plain text line
        if run is not None:
            run.add_main_line(line); continue
        # no bullet context: sub-heading or intro sentence
        if state["sec"] is not None and (state["sub"] is not None or state["sec"]["subsections"]):
            sub = ensure_sub()
            if sub["points"] and sub["points"][-1].startswith("§") and not ends_point(sub["points"][-1]):
                sub["points"][-1] += " " + line
            else:
                sub["points"].append("§ " + line)
        elif state["sec"] is not None:
            state["sec"]["note"] = (state["sec"]["note"] + " " + line).strip()
        elif state["strand"] is not None:
            state["strand"]["note"] = (state["strand"]["note"] + " " + line).strip()
        else:
            ensure_strand(); state["strand"]["note"] = (state["strand"]["note"] + " " + line).strip()
    flush_run(); flush_note()
    for st in strands:
        st["sections"] = [s for s in st["sections"] if s["subsections"] or s["title"]]
        for s in st["sections"]:
            s["subsections"] = [ss for ss in s["subsections"] if ss["points"] or ss["title"]]
            for ss in s["subsections"]:
                ss["points"] = [p.replace("§ ", "").strip() for p in ss["points"] if len(p.strip("§ ")) > 1]
    return [st for st in strands if st["sections"]]

def build_skills(subject, strands):
    skills = []
    gran = GRANULARITY[subject]
    for st in strands:
        short = {"World History and Geography": "World History", "American History and Geography": "American History"}.get(st["name"], "")
        for sec in st["sections"]:
            sec_label = (short + ": " if short else "") + (f"{sec['num']}. " if sec["num"] else "") + sec["title"]
            for ss in sec["subsections"]:
                if gran == "point":
                    for p in ss["points"]:
                        skills.append({"section": sec_label, "skill": p})
                else:
                    head = (f"{ss['letter']}. " if ss["letter"] else "") + ss["title"]
                    body = "; ".join(ss["points"])
                    text = (head + (": " if head and body else "") + body).strip()
                    if text:
                        skills.append({"section": sec_label, "skill": text})
    return skills

def main():
    pages = load_pages(SRC)
    ranges = parse_toc(pages)
    result = collections.defaultdict(dict)  # subject -> grade -> {strands, skills}
    for g in GRADES:
        by_subject = collections.defaultdict(list)
        for (gg, name), (start, end) in ranges.items():
            if gg != g: continue
            sid, strand = TOC_SUBJECTS[name]
            by_subject[sid].append((start, name))
        for sid, items in by_subject.items():
            items.sort()
            strand_names = [n for _, n in items]
            lines = []
            first = items[0][0]
            last_end = max(ranges[(g, n)][1] for _, n in items)
            for p in range(first + PAGE_OFFSET, last_end + PAGE_OFFSET + 1):
                lines.extend(clean_lines(pages.get(p, [])))
            strands = parse_body(lines, strand_names)
            result[sid][g] = {"strands": strands, "skills": build_skills(sid, strands)}
    os.makedirs(DATA, exist_ok=True)
    print(f"{'subject':8s} " + " ".join(f"{'G'+g:>9s}" for g in GRADES) + "   (sections/subsections/skills)")
    for sid in ["math", "history", "science", "ela", "music", "arts"]:
        cells = []
        for g in GRADES:
            d = result[sid].get(g)
            if not d: cells.append(f"{'-':>9s}"); continue
            secs = sum(len(st["sections"]) for st in d["strands"])
            subs = sum(len(s["subsections"]) for st in d["strands"] for s in st["sections"])
            cells.append(f"{secs}/{subs}/{len(d['skills']):<3d}".rjust(9))
        print(f"{sid:8s} " + " ".join(cells))
        with open(os.path.join(DATA, f"{sid}.js"), "w", encoding="utf-8") as f:
            f.write("// GENERATED by tools/build_curriculum.py from the Core Knowledge Sequence (2023) — do not edit by hand.\n")
            f.write("window.CURRICULUM = window.CURRICULUM || {};\n")
            f.write(f"window.CURRICULUM.{sid} = " + json.dumps(result[sid], ensure_ascii=False, indent=1) + ";\n")
    print("wrote data/*.js")

if __name__ == "__main__":
    main()
