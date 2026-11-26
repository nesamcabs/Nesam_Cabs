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
  admin/src/domain/areas/<GST state code>.json      every post office (village / area) of each district for the local fare page:
                                                    { "areas": { "Theni": [["625531","Allinagaram","<Tamil name or ''>"], ...] },
                                                      "zones": { "Theni": [["Theni", ["625531", ...]], ...] } }
  Tamil names come from tools/data/osm-tamil-places.json (OpenStreetMap contributors, ODbL): an area gets one only when a place
  of the same name lies within TAMIL_KM of the post office. Suggested zones come from placeZones.ts: each pincode of the
  district joins the nearest of the listed towns; the office confirms them before they are used.

Rules this follows:
  * Every pincode belongs to ONE district: the one with most of its post offices (a pincode sometimes spans a boundary; 1,100 of
    19,300 do). So "all pincodes of Theni" never overlaps "all pincodes of Dindigul".
  * A city the admin already lists that is only spelled differently (Thoothukudi / TUTICORIN) uses the district's pincodes.
  * A town that is not a district (Hosur, Ooty) gets the pincodes of the post offices named after it. Nothing is guessed: a town
    with no post office of that name is reported and left out, and the picker then says so.
Run it again whenever India Post publishes a new directory.

Each pincode in a city's list is [pincode, name, km, tier]: tier 0 = a post office named after the city itself, tier 1 = nearest
to it (within NEAR_KM, at most NEAR_MAX), tier 2 = the rest of the district; km is the distance from the city's own pincode(s)
(null when India Post has no coordinates). The admin picker shows tiers 0-1 on top and tier 2 below.
"""
import collections, csv, json, math, os, re, statistics, sys, urllib.request

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


NEAR_KM = 15   # a pincode this close to the city's own pincode(s) counts as "nearby"
NEAR_MAX = 12  # ... but only the nearest few, so the top group stays short


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def coord(r):
    try:
        la, lo = float(r["Latitude"]), float(r["Longitude"])
    except (TypeError, ValueError):
        return None
    return (la, lo) if 6 <= la <= 38 and 68 <= lo <= 98 else None


def clean(office):
    s = re.sub(r"\(.*?\)", "", office)
    s = re.sub(r"\s+(h\.?o|s\.?o|b\.?o)\.?$", "", s.strip(), flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def title(s):
    return re.sub(r"\b([a-z])([a-z']*)", lambda m: m.group(1).upper() + m.group(2), s.lower()).replace(" And ", " and ")


TAMIL_KM = 12
# Spellings the zone list and India Post disagree on.
ZONE_SPELLING = {"andipatti": "aundipatti"}
# Names of city corporation zones that say nothing about a place.
VAGUE_ZONES = {"central", "east", "north", "south", "west"}


def slug(name):
    """The same comparison key as areaSlug() in functions/src/domain/localPricing.ts."""
    s = re.sub(r"\(.*?\)", " ", name.lower())
    s = re.sub(r"[^a-z]+", "", s)
    return re.sub(r"patty$", "patti", s)


def tamil_places():
    path = os.path.join(ROOT, "tools/data/osm-tamil-places.json")
    out = collections.defaultdict(list)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for names, ta, la, lo in json.load(f)["places"]:
                for n in names:
                    if slug(n):
                        out[slug(n)].append((ta, (la, lo)))
    return out


def zone_names():
    """city (lower case) -> the zone / town names listed for it (placeZones.ts)."""
    src = open(os.path.join(ROOT, "admin/src/domain/placeZones.ts"), encoding="utf-8").read()
    body = src[src.index("ZONES_BY_CITY"):]
    body = body[:body.index("\n};")]
    return {m.group(1): re.findall(r'"([^"]+)"', m.group(2)) for m in re.finditer(r'^\s+"?([a-z][a-z .]*?)"?:\s*\[(.*?)\]', body, re.M | re.S)}


def write_areas(rows, home, by_district, labels, xy):
    """Every post office of every district, with a Tamil name where one is certain, and the suggested zones."""
    tamil, zones_of = tamil_places(), zone_names()
    offices = collections.defaultdict(dict)  # pin -> {slug: [name, type, point]}
    for r in rows:
        pin = r["Pincode"].strip()
        if pin not in home:
            continue
        name = clean(r["OfficeName"])
        name = title(name) if name.isupper() else name
        key = slug(name)
        if not key:
            continue
        kind, point = r["OfficeType"].strip(), coord(r)
        held = offices[pin].get(key)
        rank = {"HO": 0, "PO": 1}.get(kind, 2)
        if held is None or rank < held[1]:
            offices[pin][key] = [name, rank, point or (held[2] if held else None)]
        elif held[2] is None:
            held[2] = point
    adir = os.path.join(ROOT, "admin/src/domain/areas")
    os.makedirs(adir, exist_ok=True)
    for f in os.listdir(adir):
        if f.endswith(".json"):
            os.remove(os.path.join(adir, f))
    totals = collections.Counter()
    for code in sorted(by_district):
        areas, zones = {}, {}
        for d, pins in sorted(by_district[code].items(), key=lambda kv: labels[code][kv[0]]):
            district = labels[code][d]
            entries = []
            for pin in pins:
                for key, (name, _, point) in offices[pin].items():
                    ta = ""
                    at = point or xy.get(pin)
                    # A post office point far from its own pincode is a data error: the pincode's point is used.
                    if point and pin in xy and hav(point, xy[pin]) > 40:
                        at = xy[pin]
                    if code == "33" and at:
                        near = sorted((hav(at, p), t) for t, p in tamil.get(key, []))
                        if near and near[0][0] <= TAMIL_KM:
                            ta = near[0][1]
                    entries.append([pin, name, ta])
                    totals["areas"] += 1
                    totals["tamil"] += bool(ta)
            areas[district] = sorted(entries, key=lambda e: (e[1].lower(), e[0]))
            # Suggested zones: the district town and its listed towns; every pincode joins the nearest.
            listed = [z for z in zones_of.get(district.lower(), []) if z.lower() not in VAGUE_ZONES]
            if not listed:
                continue
            anchors, used = [], set()
            for z in [district] + [z for z in listed if z.lower() != district.lower()]:
                want = ZONE_SPELLING.get(slug(z), slug(z))
                found = sorted((offices[p][want][1], p) for p in pins if want in offices[p] and p in xy and p not in used)
                if found:
                    anchors.append((z, found[0][1]))
                    used.add(found[0][1])
            if len(anchors) < 2:
                continue
            members = collections.defaultdict(list)
            for p in sorted(pins):
                own = next((z for z, a in anchors if a == p), None)
                if own is None:
                    own = min(anchors, key=lambda za: hav(xy[p], xy[za[1]]))[0] if p in xy else anchors[0][0]
                members[own].append(p)
            zones[district] = [[z, members[z]] for z, _ in anchors if members[z]]
            totals["zoned districts"] += 1
        with open(os.path.join(adir, f"{code}.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump({"areas": areas, "zones": zones}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{totals['areas']} areas ({totals['tamil']} with a Tamil name), suggested zones for {totals['zoned districts']} districts")


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
    best, r_type = {}, {}
    home_offices, pin_pts = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        pin = r["Pincode"].strip()
        if pin not in home:
            continue
        nm = clean(r["OfficeName"])
        offices[pin].append(nm)
        k = (r["StateName"].strip(), r["District"].strip().upper())
        if k != home[pin]:
            continue
        home_offices[pin].append(nm.lower())
        r_type[(pin, nm.lower())] = r_type.get((pin, nm.lower()), r["OfficeType"].strip()) if r_type.get((pin, nm.lower())) == "HO" else r["OfficeType"].strip()
        if coord(r):
            pin_pts[pin].append(coord(r))
        pr = {"HO": 0, "PO": 1}.get(r["OfficeType"].strip(), 2)
        if pin not in best or (pr, len(nm), nm) < best[pin][:3]:
            best[pin] = (pr, len(nm), nm)
    name_of = {p: title(b[2]) if b[2].isupper() else b[2] for p, b in best.items()}

    # One point per pincode: the median of its post offices. A point far from the rest of its district is a data error: dropped.
    xy = {p: (statistics.median(a for a, _ in pts), statistics.median(b for _, b in pts)) for p, pts in pin_pts.items()}
    by_dist_pts = collections.defaultdict(list)
    for p, pt in xy.items():
        by_dist_pts[home[p]].append(pt)
    for p in list(xy):
        pts = by_dist_pts[home[p]]
        mid = (statistics.median(a for a, _ in pts), statistics.median(b for _, b in pts))
        if hav(mid, xy[p]) > 150:
            del xy[p]

    def describe(pins, core):
        """[pincode, name, km, tier] for each pin: the city's own pincodes, then the nearest, then the rest by distance."""
        # The reference is the city's head office when it has one (the lowest pincode if several: a big city's own pincodes are spread out), else the middle of its own pincodes.
        heads = [p for p in core if any(r_type.get((p, o)) == "HO" for o in home_offices[p])]
        located = sorted(h for h in heads if h in xy)
        pts = [xy[located[0]]] if located else [xy[p] for p in core if p in xy]
        ref = (statistics.median(a for a, _ in pts), statistics.median(b for _, b in pts)) if pts else None
        km = {p: round(hav(ref, xy[p]), 1) for p in pins if ref and p in xy}
        near = sorted((p for p in pins if p not in core and p in km and km[p] <= NEAR_KM), key=lambda p: (km[p], p))[:NEAR_MAX]
        tier = {p: 0 if p in core else 1 if p in near else 2 for p in pins}
        if not core:
            tier = {p: 2 for p in pins}
        order = sorted(pins, key=lambda p: (tier[p], km.get(p, 1e9), p))
        return [[p, name_of[p], km.get(p), tier[p]] for p in order]

    by_district = collections.defaultdict(lambda: collections.defaultdict(list))  # code -> district(dir name) -> [pins]
    for pin, (st, dist) in home.items():
        by_district[CODE_OF[st]][dist].append(pin)

    mine = app_cities()
    out_pins, out_districts, unresolved, report, towns, labels = {}, {}, [], [], {}, {}
    for code in sorted(by_district):
        names = DISTRICT_NAME.get(code, {})
        dist_label = {d: names.get(d, title(d)) for d in by_district[code]}
        labels[code] = dist_label
        table = {}  # display city -> [pins]
        for d, pins in by_district[code].items():
            table[dist_label[d]] = sorted(pins)
        out_districts[code] = sorted(table)
        label_ds = {v: k for k, v in dist_label.items()}
        core_of = {}
        def named_core(pins, prefixes):
            hit = {p for p in pins if any(o == x or o.startswith(x + " ") for o in home_offices[p] for x in prefixes)}
            return hit or {p for p in pins if any(r_type[(p, o)] == "HO" for o in home_offices[p] if (p, o) in r_type)}
        for label, d in label_ds.items():
            core_of[label] = named_core(table[label], [label.lower(), d.lower()])
        # Admin cities that are not districts: the union of districts (Mumbai), else the towns' post offices.
        for city in mine.get(code, []):
            if city in table:
                continue
            union = CITY_DISTRICTS.get((code, city))
            if union:
                table[city] = sorted(p for d in union for p in by_district[code].get(d, []))
                core_of[city] = named_core(table[city], [city.lower()])
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
            core_of[city] = set(hit)
            towns.setdefault(code, {})[city] = dist_label[parent]
            report.append(f"{code} {city}: {len(hit)} pincodes from post offices named {prefixes}, in {dist_label[parent]}")
        out_pins[code] = {"cities": {c: describe(pins, core_of.get(c, set())) for c, pins in sorted(table.items())}, "towns": towns.get(code, {})}

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
            cities[f"{code}|{city.lower()}"] = " ".join(sorted(e[0] for e in pins))
    with open(os.path.join(ROOT, "functions/src/domain/pincodeCities.ts"), "w", encoding="utf-8") as f:
        f.write("// GENERATED by tools/build-pincodes.py from the India Post pincode directory. Do not edit by hand.\n")
        f.write("// Key: `${GST state code}|${city or district, lower case}`. Value: the six-digit pincodes inside it, space separated.\n")
        f.write("export const PINCODES_BY_CITY: Record<string, string> = " + json.dumps(cities, ensure_ascii=False, indent=0) + ";\n")

    write_areas(rows, home, by_district, labels, xy)
    print(f"{len(home)} pincodes, {sum(len(v) for v in out_districts.values())} districts, {len(cities)} city keys")
    print("\n".join(report))
    print("UNRESOLVED (no post office carries this name; the picker lists no pincodes for them):")
    print("\n".join(unresolved))


if __name__ == "__main__":
    main()
