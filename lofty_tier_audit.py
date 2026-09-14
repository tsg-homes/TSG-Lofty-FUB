#!/usr/bin/env python3
"""
Lofty legacy score/tier vs. TSG current-formula (ClientTierScoring.gs v2.1) comparison audit.

Inputs (all pulled from Drive on 2026-09-14, see README section in the run summary):
  --fub-cache        LFC FUB Cache tab of "Automations — Config & Script" (FUB people snapshot, 2026-09-10)
                     OR a live FUB API pull (run with FUB_API_KEY set and --fub-live).
  --comm-audit       LFC Comm Audit tab (col 9 = FUBPersonId, col 10 = live Lofty API `score` at audit time)
  --queue            LFC Queue tab (LoftyLeadId <-> FUBPersonId, MatchedOn = email|phone)
  --lofty-index      JSON index of every Lofty export CSV available in Drive (grade tag, email, phone per Lead Id)
  --readiness        Readiness Audit tab (per-person v2.1 scores, 2026-09-11T19:43Z, name-keyed - no ID column)
  --score-write-log  Score Write Log tab (v2.1 LIVE write 2026-09-07, ID-keyed)
  --fub-export       FUB "all-people" CSV export 2026-09-07 (Client Score / Client Tier custom fields, ID-keyed)

Outputs:
  <prefix> - Matched.csv       one row per FUB contact that carries a Lofty legacy score and/or tier, confidently matched
  <prefix> - Unresolved.csv    every FUB contact with legacy data that could NOT be confidently matched or scored
  <prefix> - Summary.md        counts, method, caveats

Matching policy (deliberately conservative):
  * Lofty->FUB link comes from the enrichment script's own discovery (Queue.MatchedOn = email or phone).
    We re-verify the link against the Lofty export index where the Lofty lead appears in an export we hold:
      VERIFIED-EMAIL : Lofty Primary Email (export) == one of the FUB person's emails
      VERIFIED-PHONE : Lofty Primary Phone digits == one of the FUB person's phone digits
      EMAIL / PHONE  : script matched on that key, but the Lofty lead is not in any export we hold, so not re-verified
  * One FUB person linked to >1 Lofty lead with DIFFERENT Lofty scores or grades -> AMBIGUOUS -> Unresolved.
  * The v2.1 Readiness Audit has no ID column; it is joined on exact full name and ONLY when that name is unique
    in both the FUB snapshot and the audit. Otherwise the 9/11 score is left blank and the row is flagged
    NAME-COLLISION (the ID-keyed 9/7 write-log score is still shown where it exists).
  * A link whose Lofty name and FUB name share no token (shared phone/email between different people) -> NAME-DISAGREE -> Unresolved.
  * QA/test contacts are excluded from Matched and listed in Unresolved with flag QA-TEST.
"""
import argparse, base64, csv, json, os, re, sys, collections, urllib.request

GRADES = ("A+", "A", "B", "C", "D")
PLACEHOLDER_NAME_RE = re.compile(r"(?i)^\s*(no name|unknown|n/?a)\s*$|\blead\b|zillow|homes\.com|realtor\.com|text lead|assl?stance")

def norm_phone(p):
    p = str(p or "").strip()
    if re.fullmatch(r"\d+\.0+", p):  # xlsx export renders numeric phones as floats
        p = p.split(".")[0]
    d = re.sub(r"\D", "", p)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d

def norm_email(e):
    return (e or "").strip().lower()

def tier_letter(t):
    t = (t or "").strip()
    return t[5:] if t.startswith("Tier ") else t

def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def fid(x):
    """FUB ids arrive as '33154.0' from the xlsx export - normalise to '33154'."""
    v = fnum(x)
    return str(int(v)) if v is not None else ""

def lid(x):
    """Lofty lead ids: exports wrap them in backticks; the Sheets tabs stored them as floats, which rounds
    16-digit ids to ~15 significant digits. Push BOTH sides through the same float rounding so they agree."""
    x = str(x or "").strip().strip("`")
    v = fnum(x)
    return str(int(v)) if v is not None else x

# ---------- loaders ----------

def load_fub_cache(path):
    people = {}
    for r in csv.reader(open(path, encoding="utf-8")):
        if not r or r[0] in ("", "FUBPersonId"):
            continue
        pid = fid(r[0])
        emails = [norm_email(e) for e in (r[3] or "").split(",") if e.strip()]
        phones = [norm_phone(p) for p in (r[4] or "").split(",") if p.strip()]
        tags = [t.strip() for t in (r[6] or "").split(",") if t.strip()]
        people[pid] = dict(id=pid, first=(r[1] or "").strip(), last=(r[2] or "").strip(),
                           emails=emails, phones=phones, assigned=(r[5] or "").strip(), tags=tags)
    return people

def load_fub_live(api_key):
    """Live FUB pull. Same shape as load_fub_cache. Basic auth, key as username."""
    auth = base64.b64encode((api_key + ":").encode()).decode()
    url = "https://api.followupboss.com/v1/people?limit=100&fields=id,firstName,lastName,emails,phones,assignedTo,tags,stage"
    people = {}
    while url:
        req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
        for p in data.get("people", []):
            pid = str(p["id"])
            people[pid] = dict(id=pid, first=p.get("firstName") or "", last=p.get("lastName") or "",
                               emails=[norm_email(e.get("value")) for e in p.get("emails", [])],
                               phones=[norm_phone(ph.get("value")) for ph in p.get("phones", [])],
                               assigned=p.get("assignedTo") or "", tags=p.get("tags") or [], stage=p.get("stage") or "")
        nxt = (data.get("_metadata") or {}).get("next")
        url = nxt if nxt and nxt.startswith("http") else ("https://api.followupboss.com/v1/people?" + nxt.lstrip("?") if nxt else None)
    return people

def load_comm_audit(path):
    """Returns {lofty_id: {fub_id, score, name, agent}} - col 9/10 are unlabeled in the tab; verified against the
    enrichment Preview notes ('Lofty Score: N') in this session."""
    out = {}
    for r in csv.reader(open(path, encoding="utf-8")):
        if not r or r[0] in ("", "LoftyLeadId"):
            continue
        rec = dict(fub_id="", score=None, name=(r[1] or "").strip(), agent=(r[2] or "").strip(), error="")
        if len(r) >= 5 and str(r[3]).startswith("ERROR"):
            rec["error"] = r[3]
            rec["fub_id"] = fid(r[4]) if len(r) >= 5 else ""
        else:
            if len(r) >= 9:
                rec["fub_id"] = fid(r[8])
            if len(r) >= 10:
                rec["score"] = fnum(r[9])
        out[lid(r[0])] = rec
    return out

def load_queue(path):
    out = {}
    for r in csv.reader(open(path, encoding="utf-8")):
        if not r or r[0] in ("", "LoftyLeadId"):
            continue
        out[lid(r[0])] = dict(first=(r[1] or "").strip(), last=(r[2] or "").strip(), agent=(r[3] or "").strip(),
                              fub_id=fid(r[4]), matched_on=(r[5] or "").strip().lower())
    return out

def load_readiness(path):
    rows = list(csv.reader(open(path, encoding="utf-8")))
    start = next(i for i, r in enumerate(rows) if r and r[0].startswith("PER-PERSON SCORES"))
    hdr = rows[start + 1]
    run_stamp = rows[1][0] if len(rows) > 1 else ""
    recs = []
    for r in rows[start + 2:]:
        if not r or not r[0]:
            continue
        recs.append(dict(zip(hdr, r)))
    by_name = collections.defaultdict(list)
    for rec in recs:
        by_name[rec["Name"].strip().lower()].append(rec)
    return by_name, run_stamp

def load_score_write_log(path):
    rows = list(csv.reader(open(path, encoding="utf-8")))
    hdr = rows[0]
    out = {}
    for r in rows[1:]:
        if not r or not r[0]:
            continue
        rec = dict(zip(hdr, r))
        out[fid(rec["ID"])] = rec
    return out

def load_fub_export(path):
    out = {}
    for rec in csv.DictReader(open(path, encoding="utf-8-sig")):
        out[fid(rec.get("ID"))] = rec
    return out

# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fub-cache", required=True)
    ap.add_argument("--fub-live", action="store_true", help="pull FUB people live (needs FUB_API_KEY env)")
    ap.add_argument("--comm-audit", required=True)
    ap.add_argument("--queue", required=True)
    ap.add_argument("--lofty-index", required=True)
    ap.add_argument("--readiness", required=True)
    ap.add_argument("--score-write-log", required=True)
    ap.add_argument("--fub-export", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--out-dir", default=".")
    a = ap.parse_args()

    fub_source = "LFC FUB Cache tab snapshot (2026-09-10 12:57Z) - NOT a live API pull"
    if a.fub_live:
        key = os.environ.get("FUB_API_KEY")
        if not key:
            sys.exit("FUB_API_KEY not set")
        people = load_fub_live(key)
        fub_source = "live FUB API pull"
    else:
        people = load_fub_cache(a.fub_cache)

    comm = load_comm_audit(a.comm_audit)
    queue = load_queue(a.queue)
    lofty_idx = {lid(k): v for k, v in json.load(open(a.lofty_index)).items()}
    readiness, readiness_stamp = load_readiness(a.readiness)
    swl = load_score_write_log(a.score_write_log)
    fub_export = load_fub_export(a.fub_export)

    # Lofty leads linked to each FUB person (union of Comm Audit + Queue links)
    links = collections.defaultdict(set)
    for l, rec in comm.items():
        if rec["fub_id"]:
            links[rec["fub_id"]].add(l)
    for l, rec in queue.items():
        if rec["fub_id"]:
            links[rec["fub_id"]].add(l)

    # unique-name index of the FUB snapshot for the readiness join
    fub_names = collections.defaultdict(list)
    for p in people.values():
        fub_names[(p["first"] + " " + p["last"]).strip().lower()].append(p["id"])

    def lofty_grade_from_exports(l):
        grades = set()
        for row in lofty_idx.get(l, []):
            for g in row[1]:
                grades.add(g)
        return grades

    def verify_link(l, p, matched_on):
        rows = lofty_idx.get(l, [])
        if not rows:
            return (matched_on.upper() if matched_on else "UNKNOWN") + " (script-matched, Lofty lead not in any export we hold - not re-verified)"
        emails = {norm_email(r[3]) for r in rows if r[3]}
        phones = {norm_phone(r[4]) for r in rows if r[4]}
        if emails & set(p["emails"]):
            return "VERIFIED-EMAIL"
        if phones & set(p["phones"]):
            return "VERIFIED-PHONE"
        return "MISMATCH (export email/phone does not match FUB record)"

    matched, unresolved = [], []
    qa_re = re.compile(r"(?i)\bqa\b|test|mctesterson|probe")

    for pid, p in sorted(people.items(), key=lambda kv: int(kv[0])):
        fub_name = (p["first"] + " " + p["last"]).strip()
        fub_grade_tags = [t for t in p["tags"] if t in GRADES]
        lofty_ids = sorted(links.get(pid, set()))
        scores = {}
        for l in lofty_ids:
            s = comm.get(l, {}).get("score")
            if s is not None:
                scores[l] = s
        export_grades = set()
        for l in lofty_ids:
            export_grades |= lofty_grade_from_exports(l)

        has_legacy = bool(scores) or bool(fub_grade_tags) or bool(export_grades)
        if not has_legacy:
            continue  # audit scope = FUB contacts that carry a Lofty legacy score and/or tier

        flags = []
        if qa_re.search(fub_name):
            flags.append("QA-TEST")

        # --- match confidence ---
        methods = []
        for l in lofty_ids:
            mo = queue.get(l, {}).get("matched_on", "")
            methods.append(f"{l}:{verify_link(l, p, mo)}")
        if len(set(scores.values())) > 1:
            flags.append("AMBIGUOUS-LOFTY-SCORE (>1 Lofty lead with different scores linked to this FUB person)")
        if len(export_grades) > 1:
            flags.append("AMBIGUOUS-LOFTY-GRADE (exports disagree across linked Lofty leads)")
        if any("MISMATCH" in m for m in methods):
            flags.append("LINK-MISMATCH")
        # name sanity on every link: an email/phone hit whose names share no token is a shared-contact-point collision
        fub_tokens = {t for t in re.split(r"[^a-z0-9]+", fub_name.lower()) if len(t) > 1}
        for l in lofty_ids:
            ln = comm.get(l, {}).get("name") or (queue.get(l, {}).get("first", "") + " " + queue.get(l, {}).get("last", ""))
            l_tokens = {t for t in re.split(r"[^a-z0-9]+", ln.lower()) if len(t) > 1}
            if PLACEHOLDER_NAME_RE.search(ln):  # Lofty placeholder names carry no identity to disagree with
                continue
            if fub_tokens and l_tokens and not (fub_tokens & l_tokens):
                flags.append(f"NAME-DISAGREE (Lofty '{ln.strip()}' linked to FUB '{fub_name}' by email/phone but names share no token)")
        if not lofty_ids and (fub_grade_tags or export_grades):
            flags.append("NO-LOFTY-LINK (legacy tier comes from the FUB grade tag carried over at import - no Lofty lead id linked)")

        # legacy tier: FUB grade tag (carried over by the import transform) first, else export tag
        if fub_grade_tags:
            legacy_tier = "/".join(sorted(set(fub_grade_tags)))
            tier_src = "FUB tag (carried from Lofty at import)"
            if export_grades and set(fub_grade_tags) != export_grades:
                flags.append(f"TIER-SOURCE-DISAGREE (FUB tag {sorted(set(fub_grade_tags))} vs Lofty export {sorted(export_grades)})")
        elif export_grades:
            legacy_tier = "/".join(sorted(export_grades))
            tier_src = "Lofty export Tag column"
        else:
            legacy_tier, tier_src = "", ""

        legacy_score = list(scores.values())[0] if len(set(scores.values())) == 1 else ""

        # --- current formula (v2.1) ---
        key = fub_name.lower()
        r911 = readiness.get(key, [])
        tsg_score_911 = tsg_tier_911 = tsg_seg = tsg_stage = ""
        if len(r911) == 1 and len(fub_names.get(key, [])) == 1:
            rr = r911[0]
            tsg_score_911, tsg_tier_911 = fnum(rr.get("Total")), rr.get("Tier", "")
            tsg_seg, tsg_stage = rr.get("Segment", ""), rr.get("Stage", "")
        elif len(r911) > 1 or len(fub_names.get(key, [])) > 1:
            flags.append("NAME-COLLISION (9/11 readiness audit is name-keyed and this name is not unique - 9/11 score withheld)")
        else:
            flags.append("NOT-IN-9/11-AUDIT")

        s907 = swl.get(pid)
        tsg_score_907 = fnum(s907.get("New Score")) if s907 else ""
        tsg_tier_907 = s907.get("Tier", "") if s907 else ""

        exp = fub_export.get(pid, {})
        fub_field_score = exp.get("Client Score", "")
        fub_field_tier = tier_letter(exp.get("Client Tier", ""))

        cur_score = tsg_score_911 if tsg_score_911 != "" else tsg_score_907
        cur_tier = tsg_tier_911 or tsg_tier_907 or fub_field_tier
        delta = (round(cur_score - legacy_score, 1) if cur_score != "" and legacy_score != "" else "")
        tier_moved = ""
        if legacy_tier and cur_tier:
            tier_moved = "NO" if legacy_tier == cur_tier else f"YES ({legacy_tier} -> {cur_tier})"

        row = {
            "FUB Person ID": pid,
            "FUB Name": fub_name,
            "FUB Assigned To": p["assigned"],
            "FUB Stage (9/11 audit)": tsg_stage,
            "Lofty Lead Id(s)": " | ".join(lofty_ids),
            "Lofty Name": " | ".join(sorted({comm.get(l, {}).get("name") or (queue.get(l, {}).get("first", "") + " " + queue.get(l, {}).get("last", "")).strip() for l in lofty_ids})),
            "Lofty Agent": " | ".join(sorted({comm.get(l, {}).get("agent") or queue.get(l, {}).get("agent", "") for l in lofty_ids})),
            "Match Method": " | ".join(methods),
            "Lofty Legacy Score": legacy_score,
            "Lofty Legacy Score (all linked)": " | ".join(f"{l}:{s:g}" for l, s in scores.items()),
            "Lofty Legacy Tier": legacy_tier,
            "Legacy Tier Source": tier_src,
            "TSG Segment": tsg_seg,
            "TSG Score v2.1 (9/11 audit)": tsg_score_911,
            "TSG Tier v2.1 (9/11 audit)": tsg_tier_911,
            "TSG Score v2.1 (9/7 live write)": tsg_score_907,
            "TSG Tier v2.1 (9/7 live write)": tsg_tier_907,
            "FUB Client Score field (9/7 export)": fub_field_score,
            "FUB Client Tier field (9/7 export)": fub_field_tier,
            "Score Delta (TSG - Lofty)": delta,
            "Tier Moved": tier_moved,
            "Flags": "; ".join(flags),
        }
        hard = any(f.startswith(("AMBIGUOUS", "LINK-MISMATCH", "QA-TEST", "NAME-COLLISION", "NAME-DISAGREE", "NOT-IN-9/11")) for f in flags)
        (unresolved if hard else matched).append(row)

    cols = list((matched or unresolved)[0].keys())
    os.makedirs(a.out_dir, exist_ok=True)
    mp = os.path.join(a.out_dir, f"{a.prefix} - Matched.csv")
    up = os.path.join(a.out_dir, f"{a.prefix} - Unresolved.csv")
    for path, rows in ((mp, matched), (up, unresolved)):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)

    # ---- summary ----
    def cnt(rows, fn):
        return sum(1 for r in rows if fn(r))
    moved = [r for r in matched if str(r["Tier Moved"]).startswith("YES")]
    moves = collections.Counter(r["Tier Moved"] for r in moved)
    legacy_tiers = collections.Counter(r["Lofty Legacy Tier"] for r in matched if r["Lofty Legacy Tier"])
    cur_tiers = collections.Counter((r["TSG Tier v2.1 (9/11 audit)"] or r["TSG Tier v2.1 (9/7 live write)"]) for r in matched)
    unres_flags = collections.Counter(f.split(" ")[0] for r in unresolved for f in r["Flags"].split("; ") if f)
    lines = [
        f"# {a.prefix}",
        "",
        f"FUB population source: {fub_source} ({len(people)} people).",
        f"Current-formula source: ClientTierScoring.gs v2.1 output - Readiness Audit tab ({readiness_stamp}); fallback Score Write Log 2026-09-07 LIVE write (ID-keyed, {len(swl)} people).",
        "Legacy Lofty score source: LFC Comm Audit tab, unlabeled col 10 = Lofty API `score` at audit time (verified against enrichment Preview notes).",
        "Legacy Lofty tier source: FUB grade tag A/A+/B/C/D carried over at import, else Tag column of the Lofty exports held in Drive.",
        "",
        f"FUB contacts carrying a Lofty legacy score and/or tier: {len(matched) + len(unresolved)}",
        f"  Matched (confident): {len(matched)}",
        f"    with a numeric Lofty score: {cnt(matched, lambda r: r['Lofty Legacy Score'] != '')}",
        f"    with a Lofty grade tier:    {cnt(matched, lambda r: r['Lofty Legacy Tier'] != '')}",
        f"    with a v2.1 score (9/11):   {cnt(matched, lambda r: r['TSG Score v2.1 (9/11 audit)'] != '')}",
        f"    tier moved:                 {len(moved)}",
        f"  Unresolved / low-confidence: {len(unresolved)}",
        "",
        "Unresolved reasons: " + ", ".join(f"{k}={v}" for k, v in unres_flags.most_common()),
        "",
        "Legacy tier distribution (matched): " + ", ".join(f"{k}={v}" for k, v in sorted(legacy_tiers.items())),
        "Current v2.1 tier distribution (matched): " + ", ".join(f"{k}={v}" for k, v in sorted(cur_tiers.items())),
        "Tier moves: " + ", ".join(f"{k}={v}" for k, v in moves.most_common()),
    ]
    sp = os.path.join(a.out_dir, f"{a.prefix} - Summary.md")
    open(sp, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print("\nwrote:", mp, up, sp)

if __name__ == "__main__":
    main()
