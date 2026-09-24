"""Build src/data/admission-rates.json from the College Scorecard bulk download.

The U.S. Department of Education's College Scorecard is public-domain data. This keeps every
U.S. college with a published overall admission rate, plus its average SAT and median ACT
where reported, so the Strategy page has a baseline for any college without an AI connected.

    python scripts/build_admission_rates.py path/to/Most-Recent-Cohorts-Institution_*.zip

Download the zip from https://collegescorecard.ed.gov/data/ ("Most Recent Institution-Level Data").
"""

import csv
import io
import json
import sys
import zipfile
from datetime import date
from pathlib import Path


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main(zip_path: str) -> None:
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv") and not n.startswith("__MACOSX"))
        with z.open(name) as f:
            rows = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
            schools = []
            for r in rows:
                rate = num(r.get("ADM_RATE"))
                if rate is None or not 0 < rate <= 1:
                    continue
                s = {"id": int(r["UNITID"]), "name": r["INSTNM"], "city": r["CITY"], "state": r["STABBR"], "rate": round(rate, 3)}
                if r.get("ALIAS") and r["ALIAS"] not in ("NULL", "NA", "N/A"):
                    s["alias"] = r["ALIAS"]
                sat, act = num(r.get("SAT_AVG")), num(r.get("ACTCMMID"))
                if sat:
                    s["sat"] = int(sat)
                if act:
                    s["act"] = int(act)
                # Yearly cost of attendance, and the average net price after grants and aid.
                cost = num(r.get("COSTT4_A"))
                net = num(r.get("NPT4_PUB")) or num(r.get("NPT4_PRIV"))
                if cost:
                    s["cost"] = int(round(cost, -2))
                if net:
                    s["net"] = int(round(net, -2))
                s["public"] = r.get("CONTROL") == "1"
                schools.append(s)
    schools.sort(key=lambda s: s["name"])
    out = Path(__file__).resolve().parent.parent / "src" / "data" / "admission-rates.json"
    out.write_text(
        json.dumps(
            {
                "source": "U.S. Department of Education College Scorecard, Most Recent Institution-Level Data (public domain)",
                "built": date.today().isoformat(),
                "schools": schools,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"{len(schools)} colleges -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
