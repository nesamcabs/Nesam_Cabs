"""Run: python scripts/build-customer-form-css.py src/styles/customerForm.css

Builds admin/src/styles/customerForm.css from the three customer sites' own stylesheets.

For each site (in that site's real load order) it keeps the rules that style the booking form (.bf*, .btn*, .tabs/.tab,
.input/.select/.textarea) and all :root tokens, and scopes them under .cf--<platform> so nothing leaks into the admin.
"""
import re, sys, io

import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")).replace("\\", "/") + "/"
SITES = {
    "nesam": ROOT + "Project/user/web/",
    "people_taxi": ROOT + "People_Taxi/",
    "onewaycarrentals": ROOT + "One_Way_Car_Rentals/",
}
KEEP = re.compile(r"\.(bf(-[\w-]+)?|btn(--[\w-]+)?|btn-[\w-]+|tabs(--\w+)?|tab(__\w+)?|tab|input(-affix)?|select|textarea|timepick[\w_-]*|overlay(--[\w-]+)?|dialog(--[\w-]+|__[\w-]+)?|field(--[\w-]+|__[\w-]+)?|num|flow-page(--[\w-]+|__[\w-]+)?|flow-bar(--[\w-]+|__[\w-]+)?|wrap|choose(__[\w-]+)?|cabs|cab(--[\w-]+|__[\w-]+)?|cabx-[\w-]+|sel-card(--[\w-]+|__[\w-]+)?|trip-sum(--[\w-]+|__[\w-]+)?|route-title|badge(--[\w-]+)?|muted|skeleton|cab-skel|review(__[\w-]+)?|card|rv-[\w-]+|pay-opts?|pay-opt(__[\w-]+)?|promo(-[\w-]+)?|fare-[\w-]+|check(__[\w-]+)?)(?![\w-])")

FORM_OK = re.compile(r"^(bf(-[\w-]+)?|btn(--[\w-]+)?|btn-[\w-]+|tabs(--\w+)?|tab(__\w+)?|tab|input(-affix)?|select|textarea|timepick[\w_-]*|overlay(--[\w-]+)?|dialog(--[\w-]+|__[\w-]+)?|field(--[\w-]+|__[\w-]+)?|num|flow-page(--[\w-]+|__[\w-]+)?|flow-bar(--[\w-]+|__[\w-]+)?|wrap|choose(__[\w-]+)?|cabs|cab(--[\w-]+|__[\w-]+)?|cabx-[\w-]+|sel-card(--[\w-]+|__[\w-]+)?|trip-sum(--[\w-]+|__[\w-]+)?|route-title|badge(--[\w-]+)?|muted|skeleton|cab-skel|review(__[\w-]+)?|card|rv-[\w-]+|pay-opts?|pay-opt(__[\w-]+)?|promo(-[\w-]+)?|fare-[\w-]+|check(__[\w-]+)?|icon|is-[\w-]+)$")
def only_form(sel):
    classes = re.findall(r"\.([A-Za-z_][\w-]*)", sel)
    return bool(classes) and any(KEEP.search("." + c) for c in classes) and all(FORM_OK.match(c) for c in classes)

def read(p):
    return open(p, encoding="utf-8").read()

def strip_comments(s):
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)

def parse_blocks(s):
    i, n, out = 0, len(s), []
    while i < n:
        j = i
        while j < n and s[j] not in "{;":
            j += 1
        if j >= n:
            break
        if s[j] == ";":
            out.append((s[i:j].strip(), None)); i = j + 1; continue
        depth, k = 1, j + 1
        while k < n and depth:
            if s[k] == "{": depth += 1
            elif s[k] == "}": depth -= 1
            k += 1
        out.append((s[i:j].strip(), s[j + 1:k - 1])); i = k
    return out

def split_commas(sel):
    parts, depth, cur = [], 0, ""
    for ch in sel:
        if ch in "([": depth += 1
        elif ch in ")]": depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur); cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]

def css_files(site):
    main = read(site + "src/main.tsx")
    files = [site + "src/styles/" + m for m in re.findall(r"import '\./styles/([\w.-]+\.css)'", main)]
    import os
    extra = site + "src/components/cabParts.css"
    return files + ([extra] if os.path.exists(extra) else [])

def collect(site, prefix):
    tokens, rules, fonts = [], [], []
    def process(text):
        out = []
        for pre, body in parse_blocks(text):
            if body is None:
                continue
            if re.match(r"@(media|supports)", pre):
                inner = process(body)
                if inner.strip():
                    out.append(f"{pre} {{\n{inner}\n}}")
                continue
            if pre.startswith("@"):
                continue
            sels = split_commas(pre)
            if sels == [":root"]:
                tokens.append(body.strip()); continue
            kept = [x for x in sels if only_form(x) and not re.match(r"^(:root|html|body)\b", x)]
            if kept:
                out.append(", ".join(f"{prefix} {x}" for x in kept) + " {" + body + "}")
        return "\n".join(out)
    for f in css_files(site):
        rules.append(f"/* {f.split('/')[-1]} */\n" + process(strip_comments(read(f))))
    return tokens, rules

out = io.StringIO()
out.write("/* Customer booking form, as on the three customer sites.\n"
          "   GENERATED from each site's own stylesheets (tokens, shared button / input / tab styles, bookform and the theme layers),\n"
          "   in that site's load order, and scoped under .cf--<platform> so nothing here touches the rest of the admin. */\n\n")
for key, site in SITES.items():
    prefix = f".cf--{key}"
    tokens, rules = collect(site, prefix)
    tok = "\n".join(t for t in tokens)
    tok = re.sub(r"color-scheme:[^;]*;", "", tok)
    out.write(f"/* ═══ {key} ═══ */\n{prefix} {{\n{tok}\n  font-family: var(--font);\n  color: var(--text);\n  font-size: 16px;\n  line-height: 1.5;\n  -webkit-font-smoothing: antialiased;\n}}\n")
    out.write(f"{prefix} *, {prefix} *::before, {prefix} *::after {{ box-sizing: border-box; }}\n")
    out.write(f"{prefix} button {{ font: inherit; cursor: pointer; }}\n{prefix} input, {prefix} select {{ font: inherit; }}\n{prefix} p, {prefix} h1, {prefix} h2, {prefix} h3 {{ margin: 0; }}\n\n")
    out.write("\n".join(r for r in rules if r.strip()) + "\n\n")
open(sys.argv[1], "w", encoding="utf-8").write(out.getvalue())
print("written", len(out.getvalue().split("\n")), "lines")
