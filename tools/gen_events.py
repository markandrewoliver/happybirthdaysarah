"""Build repo/data/events.json from the story spec below.

Image references use the folder numbering as it was in the first repo commit
(before the Sept 2026 renumbering), and are resolved to current paths by the
unique photo id in each filename, so later renumbering never breaks them.
"""
import csv, io, json, re, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OLD_COMMIT = subprocess.run(["git", "-C", REPO, "rev-list", "--max-parents=0", "HEAD"], capture_output=True, text=True).stdout.split()[0]

PLACES = {
    "Jiamusi, Heilongjiang, China": (46.80, 130.32),
    "Qingdao, Shandong, China": (36.07, 120.38),
    "Beijing, China": (39.90, 116.41),
    "Shanghai, China": (31.23, 121.47),
    "Lindsay, Ontario, Canada": (44.36, -78.74),
    "Niagara Falls, Ontario, Canada": (43.09, -79.08),
    "Jonesborough, Tennessee, USA": (36.29, -82.47),
}

J12, J13, J14 = "2012/Jiamusi, Heilongjiang, China", "2013/Jiamusi, Heilongjiang, China", "2014/Jiamusi, Heilongjiang, China"
Q14, Q15, Q16 = "2014/Qingdao, Shandong, China", "2015/Qingdao, Shandong, China", "2016/Qingdao, Shandong, China"

EVENTS = [
    dict(date="2012-05-22", display="May 22, 2012", place="Jiamusi, Heilongjiang, China", label="Silas is born",
         main=(J12, 1), carousel=[(J12, "all"), (J13, "all")]),
    dict(date="2013-12-31", display="December 31, 2013", place="Jiamusi, Heilongjiang, China", label="We meet and fall in love.",
         main=(J14, 1), carousel=[(J14, [1]), ("id", "QVZlSnVabDZ5ckNYWU9UbQ"), (J14, range(2, 16))]),
    dict(date="2014-05-22", display="May 22, 2014", place="Jonesborough, Tennessee, USA", label="You fly to Jonesborough for Silas.",
         main=(J14, 17), carousel=[(J14, [16])]),
    dict(date="2014-05-28", display="May 28, 2014", place="Jiamusi, Heilongjiang, China", label="We’re a family for the first time.",
         main=(J14, 16), carousel=[(J14, range(18, 29))]),
    dict(date="2014-07", display="July 2014", place="Qingdao, Shandong, China", label="We move to Qingdao.",
         main=(Q14, 31), carousel=[(Q14, ("except", [49, 53, 54])), (Q15, ("except", [3, 9, 10, 23, 28, 29, 30, 31]))]),
    dict(date="2014-12-25", display="December 25, 2014", place="Qingdao, Shandong, China", label="Our first Christmas as a family.",
         main=(Q14, 54), carousel=[(Q14, [49, 53, 54])]),
    dict(date="2015-02-14", display="February 14, 2015", place="Beijing, China", label="I ask you to be my wife.",
         main=(Q15, 9), carousel=[]),
    dict(date="2015-02-17", display="February 17, 2015", place="Qingdao, Shandong, China", label="You say yes.",
         main=(Q15, 10), carousel=[]),
    dict(date="2015-05-22", display="May 22, 2015", place="Qingdao, Shandong, China", label="Silas turns 3.",
         main=(Q15, 28), carousel=[(Q15, [23, 28, 29, 30, 31]), (Q16, range(1, 19))]),
    dict(date="2015-08", display="August 2015", place="Qingdao, Shandong, China", label="You come to work with me at Qingdao No. 9 High School.",
         main=(Q16, 22), carousel=[(Q16, [*range(19, 23), *range(29, 32)])]),
    dict(date="2015-09", display="September 2015", place="Qingdao, Shandong, China", label="Guan Laoshi becomes Silas’s private tutor.",
         main=(Q16, 23), carousel=[(Q16, range(23, 29))]),
    dict(date="2016-07", display="July 2016", place="Shanghai, China", label="We start our journey back to America.",
         main=("2016/Shanghai, China", 7), carousel=[("2016/Shanghai, China", "all")]),
    dict(date="2016-08", display="August 2016", place="Lindsay, Ontario, Canada", label="We visit Canada as a family for the first time.",
         main=("2016/Lindsay, Ontario, Canada", 9), carousel=[("2016/Lindsay, Ontario, Canada", "all")]),
    dict(date="2016-08", display="August 2016", place="Niagara Falls, Ontario, Canada", label="We head home to Jonesborough.",
         main=("2016/Niagara Falls, Ontario, Canada", 21), carousel=[("2016/Niagara Falls, Ontario, Canada", "all")]),
    dict(date="2016-08", display="August 2016", place="Jonesborough, Tennessee, USA", label="We start our lives in America.",
         main=("2016/Jonesborough, Tennessee, USA", 1), carousel=[("2016/Jonesborough, Tennessee, USA", "all")]),
]

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

pid = lambda path: re.sub(r"^\d{4}-", "", Path(path).stem)
current = {pid(r["path"]): r["path"] for r in csv.DictReader(open(REPO / "data" / "photos.csv"))}
old_csv = subprocess.run(["git", "-C", REPO, "show", f"{OLD_COMMIT}:data/photos.csv"], capture_output=True, text=True).stdout
old = {}  # folder slug path -> {number: photo id}
for r in csv.DictReader(io.StringIO(old_csv)):
    p = Path(r["path"])
    old.setdefault(str(p.parent), {})[int(p.name[:4])] = pid(p)

missing = []

def resolve(folder, sel):
    if folder == "id":  # a single photo by id, independent of folder numbering
        return [current[sel]]
    key = f"images/{folder.split('/')[0]}/{slug(folder.split('/', 1)[1])}"
    nums = old[key]
    if sel == "all":
        picks = sorted(nums)
    elif isinstance(sel, tuple) and sel[0] == "except":
        picks = [n for n in sorted(nums) if n not in sel[1]]
    else:
        picks = [sel] if isinstance(sel, int) else list(sel)
    out = []
    for n in picks:
        i = nums.get(n)
        if i in current:
            out.append(current[i])
        else:
            missing.append(f"{folder} #{n:04d}")
    # files added to the folder since the old numbering (e.g. a moved photo) are included for "all"
    if sel == "all":
        out += sorted(p for p in current.values() if p.startswith(key + "/") and p not in out)
    return out

events = []
for e in EVENTS:
    main = resolve(*e["main"])[0]
    imgs = [main]
    for folder, sel in e["carousel"]:
        imgs += [p for p in resolve(folder, sel) if p not in imgs]
    lat, lng = PLACES[e["place"]]
    events.append(dict(date=e["date"], display=e["display"], place=e["place"], lat=lat, lng=lng,
                       label=e["label"], images=imgs))

(REPO / "data" / "events.json").write_text(json.dumps(events, indent=2, ensure_ascii=False) + "\n")
for e in events:
    print(f"{e['display']:20} {e['place']:32} {len(e['images']):3} images  {e['label']}")
print("references to photos no longer in the set (skipped):", missing or "none")
