"""Builds the Chrome Web Store upload ZIP, and refuses to build a broken one.

    python package.py

Writes dist/liquid-glass-tab-<version>.zip containing only what should ship —
no dev harness, no generator scripts, no docs, no editor config.

The checks matter more than the zipping. Every one of them corresponds to
something that either gets an upload rejected or silently breaks the extension
after install, and all of them have caught something at least once:

  * a root-level file starting with "_"      -> Chrome refuses to load it
  * a missing icon                           -> listing won't submit
  * a description over 132 characters        -> listing won't submit
  * a manifest that isn't valid JSON         -> load fails
  * the _favicon web_accessible_resources    -> every dock icon breaks
  * a dev file that slipped into the build   -> dead weight and review noise
  * a source file referencing a dev file     -> broken in the published build
"""
import json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")

# Anything matching these is development-only and must not ship.
EXCLUDE_DIRS = {".git", ".claude", "dist", "__pycache__", ".vscode", ".idea"}
EXCLUDE_FILES = {
    "dev-preview.html", "dev-preview-stub.js",
    "package.py", "STORE.md", "README.md",
    ".DS_Store", "Thumbs.db",
}
# Nothing at the root starting with "." belongs in an upload — .gitignore,
# .gitattributes and friends are repository metadata, not extension files.
EXCLUDE_DOTFILES = True
EXCLUDE_SUFFIX = (".py", ".md", ".zip", ".log", ".bak", ".orig")
# PRIVACY.md is excluded by the .md rule; it is published as a URL, not shipped.

problems, warnings = [], []


def fail(msg):
    problems.append(msg)


def warn(msg):
    warnings.append(msg)


def included(rel):
    parts = rel.split(os.sep)
    if any(p in EXCLUDE_DIRS for p in parts[:-1]):
        return False
    name = parts[-1]
    if name in EXCLUDE_FILES:
        return False
    if EXCLUDE_DOTFILES and name.startswith("."):
        return False
    if name.lower().endswith(EXCLUDE_SUFFIX):
        return False
    return True


def collect():
    out = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            rel = os.path.relpath(os.path.join(base, f), ROOT)
            if included(rel):
                out.append(rel)
    return sorted(out)


def check_manifest():
    path = os.path.join(ROOT, "manifest.json")
    if not os.path.exists(path):
        fail("manifest.json is missing")
        return None
    raw = open(path, encoding="utf-8").read()
    try:
        m = json.loads(raw)
    except json.JSONDecodeError as e:
        fail(f"manifest.json is not valid JSON: {e}")
        return None

    # A real comment, not the "//" inside every https:// host permission.
    if '"//"' in raw or re.search(r"^\s*(//|/\*)", raw, re.M):
        warn("manifest.json contains a comment — JSON has none and Chrome "
             "warns on every key it doesn't recognise, including the \"//\" convention")

    desc = m.get("description", "")
    if not desc:
        fail("manifest has no description")
    elif len(desc) > 132:
        fail(f"description is {len(desc)} chars; the store limit is 132")

    if not re.fullmatch(r"\d+(\.\d+){0,3}", str(m.get("version", ""))):
        fail(f"version {m.get('version')!r} is not a valid store version string")

    for size in ("16", "48", "128"):
        icon = m.get("icons", {}).get(size)
        if not icon:
            fail(f"manifest is missing the {size}px icon")
        elif not os.path.exists(os.path.join(ROOT, icon)):
            fail(f"icon file missing on disk: {icon}")

    war = json.dumps(m.get("web_accessible_resources", []))
    if "_favicon/*" not in war:
        fail("web_accessible_resources no longer exposes _favicon/* — "
             "every dock icon will render as a broken image")

    csp = m.get("content_security_policy", {}).get("extension_pages", "")
    if csp and "'unsafe-eval'" in csp:
        fail("CSP allows 'unsafe-eval', which the store rejects")

    return m


def check_reserved_names(files):
    for rel in files:
        if os.sep not in rel and rel.startswith("_"):
            fail(f"root-level file starts with '_': {rel} — Chrome will refuse to load")


def check_no_dev_references(files):
    """A published build must not reference files that were excluded."""
    shipped = set(files)
    dev_names = ["dev-preview.html", "dev-preview-stub.js"]
    for rel in files:
        if not rel.lower().endswith((".js", ".html", ".css", ".json")):
            continue
        try:
            text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for dev in dev_names:
            if dev in text and rel not in dev_names:
                warn(f"{rel} mentions {dev}, which is not shipped")


def check_assets_present(files):
    shipped = set(files)
    for needed in ("assets/refract-map.png", "assets/grain.png"):
        if needed.replace("/", os.sep) not in shipped:
            fail(f"missing generated asset: {needed} — run "
                 f"`python assets/make_assets.py`")


def main():
    files = collect()
    m = check_manifest()
    check_reserved_names(files)
    check_assets_present(files)
    check_no_dev_references(files)

    for w in warnings:
        print(f"  warning: {w}")
    if problems:
        for p in problems:
            print(f"  PROBLEM: {p}")
        print(f"\nRefusing to package — {len(problems)} problem(s) to fix first.")
        return 1

    os.makedirs(DIST, exist_ok=True)
    version = m.get("version", "0")
    out = os.path.join(DIST, f"liquid-glass-tab-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in files:
            z.write(os.path.join(ROOT, rel), rel)

    size = os.path.getsize(out)
    print(f"packaged {len(files)} files -> {os.path.relpath(out, ROOT)} "
          f"({size / 1024:.0f} KB)")
    print("\nshipped:")
    for rel in files:
        print(f"  {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
