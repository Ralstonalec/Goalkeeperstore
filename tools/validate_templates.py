#!/usr/bin/env python3
"""
Validate JSON templates and section groups against section schemas.

Shopify rejects a theme upload if a template references a setting, block type
or select value that the section schema doesn't define. theme-check doesn't
catch these, so run this before pushing:

    python3 tools/validate_templates.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_RE = re.compile(r"{%-?\s*schema\s*-?%}(.*?){%-?\s*endschema\s*-?%}", re.S)


def load_json(path):
    text = path.read_text()
    # Shopify JSON files may start with a /* comment */ header.
    text = re.sub(r"^\s*/\*.*?\*/", "", text, flags=re.S)
    return json.loads(text)


def section_schemas():
    schemas = {}
    for f in (ROOT / "sections").glob("*.liquid"):
        m = SCHEMA_RE.search(f.read_text())
        if not m:
            schemas[f.stem] = None  # schema-less sections (e.g. main-404) are valid
            continue
        try:
            schemas[f.stem] = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            print(f"ERROR {f.name}: schema is not valid JSON ({e})")
            schemas[f.stem] = None
    return schemas


def check_settings(where, values, definitions, errors):
    defs = {d["id"]: d for d in definitions if "id" in d}
    for key, val in (values or {}).items():
        d = defs.get(key)
        if d is None:
            errors.append(f"{where}: unknown setting '{key}'")
            continue
        t = d.get("type")
        if t in ("select", "radio"):
            allowed = [o["value"] for o in d.get("options", [])]
            if val not in allowed:
                errors.append(f"{where}: '{key}' = {val!r} not in {allowed}")
        elif t == "range":
            if not isinstance(val, (int, float)):
                errors.append(f"{where}: '{key}' must be a number")
            elif not (d["min"] <= val <= d["max"]) or round((val - d["min"]) / d.get("step", 1), 6) % 1:
                errors.append(f"{where}: '{key}' = {val} outside {d['min']}..{d['max']} step {d.get('step', 1)}")
        elif t == "checkbox" and not isinstance(val, bool):
            errors.append(f"{where}: '{key}' must be true/false")


def check_section(where, sec, schemas, errors):
    stype = sec.get("type")
    if stype not in schemas:
        errors.append(f"{where}: unknown section type '{stype}'")
        return
    schema = schemas[stype]
    if schema is None:
        return
    check_settings(where, sec.get("settings"), schema.get("settings", []), errors)
    block_defs = {b["type"]: b for b in schema.get("blocks", [])}
    accepts_app = "@app" in block_defs
    blocks = sec.get("blocks", {}) or {}
    for bid, block in blocks.items():
        btype = block.get("type")
        if btype not in block_defs:
            if not (accepts_app and btype.startswith("shopify://apps")):
                errors.append(f"{where} block '{bid}': unknown block type '{btype}'")
            continue
        check_settings(f"{where} block '{bid}'", block.get("settings"), block_defs[btype].get("settings", []), errors)
    for bid in sec.get("block_order", []):
        if bid not in blocks:
            errors.append(f"{where}: block_order references missing block '{bid}'")
    for btype, bdef in block_defs.items():
        limit = bdef.get("limit")
        if limit and sum(1 for b in blocks.values() if b.get("type") == btype) > limit:
            errors.append(f"{where}: more than {limit} '{btype}' blocks")


def main():
    schemas = section_schemas()
    errors = []

    for f in sorted((ROOT / "templates").rglob("*.json")):
        data = load_json(f)
        sections = data.get("sections", {})
        for sid in data.get("order", []):
            if sid not in sections:
                errors.append(f"{f.name}: order references missing section '{sid}'")
        for sid, sec in sections.items():
            check_section(f"{f.name} [{sid}]", sec, schemas, errors)

    for f in sorted((ROOT / "sections").glob("*.json")):
        data = load_json(f)
        for sid, sec in data.get("sections", {}).items():
            check_section(f"{f.name} [{sid}]", sec, schemas, errors)

    # Presets must only use defined settings/blocks too.
    for name, schema in schemas.items():
        if not schema:
            continue
        for i, preset in enumerate(schema.get("presets", [])):
            block_defs = {b["type"]: b for b in schema.get("blocks", [])}
            check_settings(f"{name} preset {i}", preset.get("settings"), schema.get("settings", []), errors)
            for j, block in enumerate(preset.get("blocks", [])):
                bdef = block_defs.get(block.get("type"))
                if not bdef:
                    errors.append(f"{name} preset {i} block {j}: unknown type '{block.get('type')}'")
                else:
                    check_settings(f"{name} preset {i} block {j}", block.get("settings"), bdef.get("settings", []), errors)

    for e in errors:
        print("ERROR", e)
    print(f"{len(errors)} problem(s) across {len(schemas)} section schemas")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
