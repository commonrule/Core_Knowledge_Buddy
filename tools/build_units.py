#!/usr/bin/env python3
"""Scan the Core Knowledge unit folders and write data/units.js.

Usage: python3 tools/build_units.py [CK_ROOT]
Default CK_ROOT: ~/Codex/Core_knowledge
"""
import json, os, re, sys, glob

CK_ROOT = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Codex/Core_knowledge")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "units.js")

SUBJECT_DIRS = {
    "math": "Core_KnowLedge_Math",
    "history": "Core_KnowLedge_History_Geography",
    "science": "Core_KnowLedge_Science",
    "ela": "Core_KnowLedge_English",
    "classics": "Core_KnowLedge_Core_classics",
    "music": "Core_KnowLedge_Music",
    "arts": "Core_KnowLedge_Visual_Arts",
}
GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8"]
SKIP_PDF = re.compile(r"terms|conditions", re.I)
SLUG_PREFIX = re.compile(r"^(ckmath|ckhg|cksci|ckla|ckmusic|ck-visual-arts)-(unit|domain|grade)-(\d+|k)-?", re.I)

def load_manifests():
    m = {}
    for path in glob.glob(os.path.join(CK_ROOT, "Grade*_download_manifest.json")):
        g = re.search(r"Grade(k|\d)", os.path.basename(path)).group(1).upper()
        for e in json.load(open(path)):
            m.setdefault((e["subject"], g, e["unit"]), []).append(e)
    return m

TYPO_FIX = {"Squtter": "Squatter", "Fredrick": "Frederick", "Lets": "Let's", "Whats": "What's", "Rattenboroughs": "Rattenborough's"}

def words_from_camel(s):
    s = re.sub(r"_+", " ", s)
    s = re.sub(r"(?<!\d)-|-(?!\d)", " ", s)          # keep hyphens only between digits (1-10)
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    s = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return " ".join(TYPO_FIX.get(w, w) for w in s.split(" "))

def title_from_slug(slug):
    s = SLUG_PREFIX.sub("", slug)
    s = re.sub(r"^(third|fourth|fifth|sixth|seventh|eighth)-grade-skills-?", "", s)
    s = s.replace("-g5", "").replace("_", "-")
    t = " ".join(w.capitalize() if w not in ("and", "of", "the", "to", "in", "on", "a", "for", "with", "at") else w for w in s.split("-") if w)
    t = re.sub(r"\bUs\b", "U.S.", t)
    t = " ".join(TYPO_FIX.get(w, w) for w in t.split(" "))
    return t[:1].upper() + t[1:]

def title_from_folder(name, subject):
    n = name
    n = re.sub(r"_(Unit|Grade)_Materials.*$", "", n)
    n = re.sub(r"_W\d+$", "", n)
    n = re.sub(r"^(CKMath_Lit|CKMath|CKHG|CKSci|CKLA|CC)_", "", n)
    n = re.sub(r"^G(K|\d+)_?U?\d*_?", "", n)
    n = re.sub(r"^(B\d_)?(U\d+(U\d+)?_)?", "", n)
    n = re.sub(r"_(Web|web|TG|SR)$", "", n)
    return words_from_camel(n)

def classify(fname):
    f = fname.lower()
    if re.search(r"(_|-)tg|teacher|_te_|_te\.pdf|_ts_|_anth", f): return "tg"
    if re.search(r"(_|-)sr|reader|_rdr|_anth|_fb_|_ccsr|_se_", f): return "sr"
    if re.search(r"_ab|_wb|_swp|_spg|activity|workbook", f): return "ab"
    if re.search(r"_tl\.pdf|timeline|_ic_|_vocab|_org", f): return "extra"
    return "other"

def rel(p):
    return os.path.relpath(p, CK_ROOT)

def scan_unit_dir(path):
    pdfs = [p for p in glob.glob(os.path.join(path, "**", "*.pdf"), recursive=True) if not SKIP_PDF.search(os.path.basename(p))]
    files = {"tg": [], "sr": [], "ab": [], "extra": [], "other": []}
    for p in sorted(pdfs):
        files[classify(os.path.basename(p))].append(rel(p))
    return files, pdfs

def main():
    manifests = load_manifests()
    units = {s: {g: [] for g in GRADES} for s in SUBJECT_DIRS}
    for subject, sdir in SUBJECT_DIRS.items():
        base = os.path.join(CK_ROOT, sdir)
        for gdir in sorted(glob.glob(os.path.join(base, "Grade*"))):
            g = re.search(r"Grade(k|\d)", os.path.basename(gdir)).group(1).upper()
            if g not in GRADES: continue
            for udir in sorted(glob.glob(os.path.join(gdir, "*/"))):
                uname = os.path.basename(os.path.normpath(udir))
                if uname.startswith("."): continue
                files, pdfs = scan_unit_dir(udir)
                if not pdfs: continue
                mlist = manifests.get((sdir, g, uname), [])
                # prefer the knowledge "domain" entry when a unit has both a domain and a skills entry (CKLA Grade 3)
                m = next((e for e in mlist if "domain" in e.get("page", "")), mlist[0] if mlist else None)
                num_match = re.match(r"^Unit(\d+)$", uname) or re.match(r"^ckla_domain_(\d+)_", uname)
                number = int(num_match.group(1)) if num_match else None
                if subject == "history" and g in ("7", "8") and uname.startswith(("ckhg_", "world_")):
                    number = len(units[subject][g]) + 1
                kind = "unit" if number else "extra"
                slug = m["page"].rstrip("/").split("/")[-1] if m and m.get("page") else None
                if slug: slug = re.sub(r"^ckhg-(?!unit)", "", slug)
                inner = [d for d in os.listdir(udir) if os.path.isdir(os.path.join(udir, d)) and not d.startswith(".")]
                folder = inner[0] if inner else uname
                if subject == "classics":
                    reader = next((os.path.basename(p) for p in pdfs if "_Reader" in p), None)
                    title = words_from_camel(re.sub(r"^CC_|_Reader.*$", "", reader)) if reader else title_from_folder(folder, subject)
                elif slug and (subject in ("ela", "history", "science", "music", "arts") or kind == "extra"):
                    title = title_from_slug(slug)
                else:
                    title = title_from_folder(folder, subject) if inner else (title_from_slug(slug) if slug else words_from_camel(uname))
                if not title.strip():
                    title = words_from_camel(folder)
                units[subject][g].append({
                    "id": f"{subject}-{g}-{uname.lower()}",
                    "subject": subject, "grade": g, "number": number, "kind": kind,
                    "title": title, "folder": uname,
                    "tg": files["tg"][0] if files["tg"] else None,
                    "sr": files["sr"][0] if files["sr"] else None,
                    "files": files,
                    "source": m["page"] if m else None,
                })
            units[subject][g].sort(key=lambda u: (u["kind"] != "unit", u["number"] or 0, u["folder"]))
    # Core Classics library: readers without a grade tag
    library = []
    cc_manifest = os.path.join(CK_ROOT, "Core_KnowLedge_Core_classics", "Core_Classics_manifest.json")
    if os.path.exists(cc_manifest):
        series = os.path.join(CK_ROOT, "Core_KnowLedge_Core_classics", "Core_Classics_Series")
        for e in json.load(open(cc_manifest)):
            if e["collection"].endswith("Readers") and not e.get("gradeTags"):
                path = os.path.join(series, "Readers", e["file"])
                tg_name = None
                library.append({
                    "id": "classics-lib-" + re.sub(r"[^a-z0-9]", "", e["file"].lower().replace("_reader_w1.pdf", "")),
                    "subject": "classics", "grade": "any", "number": None, "kind": "library",
                    "title": words_from_camel(re.sub(r"^CC_|_Reader.*$", "", e["file"])),
                    "sr": rel(path) if os.path.exists(path) else None, "tg": None, "files": {}, "source": e.get("sourcePage"),
                })
    units["classics"]["any"] = library
    with open(OUT, "w") as f:
        f.write("// GENERATED by tools/build_units.py — do not edit by hand.\n")
        f.write("window.CURRICULUM = window.CURRICULUM || {};\n")
        f.write("window.CURRICULUM.units = " + json.dumps(units, ensure_ascii=False, indent=1) + ";\n")
    for s in SUBJECT_DIRS:
        print(f"{s:8s} " + " ".join(f"G{g}:{len([u for u in units[s][g] if u['kind']=='unit'])}+{len([u for u in units[s][g] if u['kind']!='unit'])}" for g in GRADES))
    print("classics library:", len(library))
    print("wrote", os.path.normpath(OUT))

if __name__ == "__main__":
    main()
