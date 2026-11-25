#!/usr/bin/env python3
"""
Builds the pincode data used by the admin "Places & cabs" picker and by the booking server.

Source: India Post "All India Pincode Directory" (data.gov.in, Government Open Data License - India), every post office with its
pincode, district and state. The data.gov.in download is flaky, so a GitHub republication of the same file is the default:
    python tools/build-pincodes.py [path-to-pincode.csv]        (downloads it when no path is given)

Writes:
  admin/src/domain/pincodes/<GST state code>.json   { "cities": { "Theni": [["625203","Name"], ...] }, "towns": { "Hosur": "Krishnagiri" } }
  admin/src/domain/pincodeDistricts.ts              the district names of each state (so the City list can offer all of them)
  functions/src/domain/pincodeCities.ts             city -> pincodes, what the booking server uses to place an address

Rules this follows:
  * Every pincode belongs to ONE district: the one with most of its post offices (a pincode sometimes spans a boundary; 1,100 of
    19,300 do). So "all pincodes of Theni" never overlaps "all pincodes of Dindigul".
  * A city the admin already lists that is only spelled differently (Thoothukudi / TUTICORIN) uses the district's pincodes.
  * A town that is not a district (Hosur, Ooty) gets the pincodes of the post offices named after it. Nothing is guessed: a town
    with no post office of that name is reported and left out, and the picker then says so.
Run it again whenever India Post publishes a new directory.
"""
import collections, csv, json, os, re, sys, urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SOURCE = "https://raw.githubusercontent.com/dropdevrahul/pincodes-india/main/pincode.csv"

GST = {"01": "JAMMU AND KASHMIR", "02": "HIMACHAL PRADESH", "03": "PUNJAB", "04": "CHANDIGARH", "05": "UTTARAKHAND", "06": "HARYANA", "07": "DELHI",
       "08": "RAJASTHAN", "09": "UTTAR PRADESH", "10": "BIHAR", "11": "SIKKIM", "12": "ARUNACHAL PRADESH", "13": "NAGALAND", "14": "MANIPUR",
       "15": "MIZORAM", "16": "TRIPURA", "17": "MEGHALAYA", "18": "ASSAM", "19": "WEST BENGAL", "20": "JHARKHAND", "21": "ODISHA", "22": "CHHATTISGARH",
       "23": "MADHYA PRADESH", "24": "GUJARAT", "26": "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "27": "MAHARASHTRA", "29": "KARNATAKA", "30": "GOA",
       "31": "LAKSHADWEEP", "32": "KERALA", "33": "TAMIL NADU", "34": "PUDUCHERRY", "35": "ANDAMAN AND NICOBAR ISLANDS", "36": "TELANGANA",
       "37": "ANDHRA PRADESH", "38": "LADAKH"}
CODE_OF = {v: k for k, v in GST.items()}

# The district's name in the directory -> the name the admin and the booking server already use for it.
DISTRICT_NAME = {
    "33": {"KANNIYAKUMARI": "Kanyakumari", "THE NILGIRIS": "Nilgiris", "TUTICORIN": "Thoothukudi", "THIRUVALLUR": "Tiruvallur", "THIRUVARUR": "Tiruvarur",
           "VILLUPURAM": "Viluppuram"},
    "29": {"BAGALKOTE": "Bagalkot", "CHIKKABALLAPURA": "Chikkaballapur", "DAVANGERE": "Davanagere", "BENGALURU URBAN": "Bengaluru"},
    "37": {"Y.S.R.": "Kadapa", "SPSR NELLORE": "Nellore", "VISAKHAPATANAM": "Visakhapatnam"},
    "03": {"FIROZEPUR": "Firozpur", "S.A.S NAGAR": "Mohali"},
    "09": {"KANPUR NAGAR": "Kanpur"},
    "18": {"KAMRUP METRO": "Guwahati"},
    "19": {"MALDAH": "Malda", "COOCHBEHAR": "Cooch Behar"},
    "21": {"BALESHWAR": "Balasore"},
    "24": {"AHMADABAD": "Ahmedabad", "MAHESANA": "Mehsana"},
    "34": {"PONDICHERRY": "Puducherry"},
    "36": {"WARANGAL URBAN": "Warangal"},
}
# City the admin lists -> directory districts that together are that city (the admin's Mumbai is the island city and the suburbs).
CITY_DISTRICTS = {("27", "Mumbai"): ["MUMBAI", "MUMBAI SUBURBAN"]}
# A listed town that is not a district -> the post-office names it is made of (matched as whole leading words). The default is the
# town's own name; these are the ones the directory spells differently, each checked by hand against the directory.
TOWN_OFFICES = {
    "33|Mahabalipuram": ["Mamallapuram"], "33|Ooty": ["Udagamandalam"], "05|Kotdwar": ["Kotdwara"], "10|Bodh Gaya": ["Bodhgaya"],
    "16|Kailasahar": ["Kailashahar"], "17|Cherrapunji": ["Cherrapunjee"], "19|Bardhaman": ["Burdwan"], "27|Mahabaleshwar": ["Mahableshwar"],
    "27|Pimpri Chinchwad": ["Pimpri", "Chinchwad"], "29|Mangaluru": ["Mangaluru", "Mangalore"], "29|Hubballi": ["Hubballi", "Hubli"],
    "29|Hosapete": ["Hosapete", "Hospet"], "32|Kochi": ["Kochi", "Cochin"], "35|Havelock Island": ["Havelock"], "37|Amaravati": ["Amaravathi"],
    "08|Mount Abu": ["Abu"], "02|Dharamshala": ["Dharamsala"],
}


def clean(office):
    s = re.sub(r"\(.*?\)", "", office)
    s = re.sub(r"\s+(h\.?o|s\.?o|b\.?o)\.?$", "", s.strip(), flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def title(s):
    return re.sub(r"\b([a-z])([a-z']*)", lambda m: m.group(1).upper() + m.group(2), s.lower()).replace(" And ", " and ")


def load(path):
    if not path:
        path = os.path.join(os.environ.get("TEMP", "."), "pincode.csv")
        if not os.path.exists(path):
            print("downloading", SOURCE)
            urllib.request.urlretrieve(SOURCE, path)
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def app_cities():
    """The cities the admin already lists, by GST code (placeDirectory.ts)."""
    src = open(os.path.join(ROOT, "admin/src/domain/placeDirectory.ts"), encoding="utf-8").read()
    body = src[src.index("CITIES_BY_STATE"):src.index("export { ZONES_BY_CITY }")]
    return {m.group(1): re.findall(r'"([^"]+)"', m.group(2)) for m in re.finditer(r'"(\d\d)":\s*\[(.*?)\]', body, re.S)}


def main():
    rows = load(sys.argv[1] if len(sys.argv) > 1 else None)
    
    # 1. Each pincode -> its one (state, district): the most post offices; ties go to a head/sub office, then the name.
    seen = collections.defaultdict(collections.Counter)
    rank = collections.defaultdict(dict)
    for r in rows:
        key = (r["StateName"].strip(), r["District"].strip().upper())
        pin = r["Pincode"].strip()
        if not re.fullmatch(r"[1-9]\d{5}", pin) or key[0] not in CODE_OF:
            continue
        seen[pin][key] += 1
        if r["OfficeType"].strip() in ("HO", "PO"):
            rank[pin][key] = rank[pin].get(key, 0) + 1
    home = {}
    for pin, c in seen.items():
        home[pin] = sorted(c, key=lambda k: (-c[k], -rank[pin].get(k, 0), k[1]))[0]

    # 2. A name for each pincode: its head office, else a sub office, else the first branch office, inside its home district.
    name_of, offices = {}, collections.defaultdict(list)  # offices: pin -> [clean office names] (any district), for town matching
    best = {}
    for r in rows:
        pin = r["Pincode"].strip()
        if pin not in home:
            continue
        nm = clean(r["OfficeName"])
        offices[pin].append(nm)
        k = (r["StateName"].strip(), r["District"].strip().upper())
        if k != home[pin]:
            continue
        pr = {"HO": 0, "PO": 1}.get(r["OfficeType"].strip(), 2)
        if pin not in best or (pr, len(nm), nm) < best[pin][:3]:
            best[pin] = (pr, len(nm), nm)
    name_of = {p: title(b[2]) if b[2].isupper() else b[2] for p, b in best.items()}

    by_district = collections.defaultdict(lambda: collections.defaultdict(list))  # code -> district(dir name) -> [pins]
    for pin, (st, dist) in home.items():
        by_district[CODE_OF[st]][dist].append(pin)

    mine = app_cities()
    out_pins, out_districts, unresolved, report, towns = {}, {}, [], [], {}
    for code in sorted(by_district):
        names = DISTRICT_NAME.get(code, {})
        dist_label = {d: names.get(d, title(d)) for d in by_district[code]}
        table = {}  # display city -> [pins]
        for d, pins in by_district[code].items():
            table[dist_label[d]] = sorted(pins)
        out_districts[code] = sorted(table)
        # Admin cities that are not districts: the union of districts (Mumbai), else the towns' post offices.
        for city in mine.get(code, []):
            if city in table:
                continue
            union = CITY_DISTRICTS.get((code, city))
            if union:
                table[city] = sorted(p for d in union for p in by_district[code].get(d, []))
                continue
            prefixes = [x.lower() for x in TOWN_OFFICES.get(f"{code}|{city}", [city])]
            # The post offices named after the town, in this state. A village of the same name in another district is a branch
            # office; the town is where the head / sub offices are, so only that district's pincodes are used.
            def named(o):
                return any(o.lower() == x or o.lower().startswith(x + " ") for x in prefixes)
            score = collections.Counter()
            for r in rows:
                if r["StateName"].strip() != GST[code] or not named(clean(r["OfficeName"])):
                    continue
                pin = r["Pincode"].strip()
                if pin in home and home[pin][0] == GST[code]:
                    score[home[pin][1]] += 10 if r["OfficeType"].strip() in ("HO", "PO") else 1
            if not score:
                unresolved.append(f"{code} {city}")
                continue
            parent = score.most_common(1)[0][0]
            hit = sorted({r["Pincode"].strip() for r in rows if r["StateName"].strip() == GST[code] and named(clean(r["OfficeName"]))
                          and r["Pincode"].strip() in home and home[r["Pincode"].strip()] == (GST[code], parent)})
            table[city] = hit
            towns.setdefault(code, {})[city] = dist_label[parent]
            report.append(f"{code} {city}: {len(hit)} pincodes from post offices named {prefixes}, in {dist_label[parent]}")
        out_pins[code] = {"cities": {c: [[p, name_of[p]] for p in pins] for c, pins in sorted(table.items())}, "towns": towns.get(code, {})}

    # 3. Write.
    pdir = os.path.join(ROOT, "admin/src/domain/pincodes")
    os.makedirs(pdir, exist_ok=True)
    for f in os.listdir(pdir):
        if f.endswith(".json"):
            os.remove(os.path.join(pdir, f))
    for code, table in out_pins.items():
        with open(os.path.join(pdir, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(table, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(ROOT, "admin/src/domain/pincodeDistricts.ts"), "w", encoding="utf-8") as f:
        f.write("// GENERATED by tools/build-pincodes.py from the India Post pincode directory. Do not edit by hand.\n")
        f.write("/** Every district of each state / union territory (GST code), as named in the City list; each has its pincodes in ./pincodes/<code>.json. */\n")
        f.write("export const DISTRICTS_BY_STATE: Record<string, string[]> = " + json.dumps(out_districts, ensure_ascii=False, indent=1) + ";\n")
    cities = {}
    for code, data in out_pins.items():
        for city, pins in data["cities"].items():
            cities[f"{code}|{city.lower()}"] = " ".join(p for p, _ in pins)
    with open(os.path.join(ROOT, "functions/src/domain/pincodeCities.ts"), "w", encoding="utf-8") as f:
        f.write("// GENERATED by tools/build-pincodes.py from the India Post pincode directory. Do not edit by hand.\n")
        f.write("// Key: `${GST state code}|${city or district, lower case}`. Value: the six-digit pincodes inside it, space separated.\n")
        f.write("export const PINCODES_BY_CITY: Record<string, string> = " + json.dumps(cities, ensure_ascii=False, indent=0) + ";\n")

    print(f"{len(home)} pincodes, {sum(len(v) for v in out_districts.values())} districts, {len(cities)} city keys")
    print("\n".join(report))
    print("UNRESOLVED (no post office carries this name; the picker lists no pincodes for them):")
    print("\n".join(unresolved))


if __name__ == "__main__":
    main()
