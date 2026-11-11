"""Contract check: OpenAPI validates, schemas are valid, rules.yaml is well-formed, the 12 reference
dashboard.json objects validate against extraction.schema.json, and the fixtures validate."""
import json, sys, glob, pathlib, yaml, jsonschema
from openapi_spec_validator import validate as validate_openapi
root = pathlib.Path(__file__).resolve().parents[1]
ok = True
def report(name, good, detail=""):
    global ok; ok &= good; print(("PASS " if good else "FAIL ") + name + (f": {detail}" if detail else ""))
try: validate_openapi(yaml.safe_load((root/"contracts/openapi.yaml").read_text())); report("openapi.yaml", True)
except Exception as e: report("openapi.yaml", False, str(e)[:200])
ext = json.loads((root/"contracts/extraction.schema.json").read_text()); fin = json.loads((root/"contracts/finding.schema.json").read_text())
for n, s in [("extraction.schema.json", ext), ("finding.schema.json", fin)]:
    try: jsonschema.Draft202012Validator.check_schema(s); report(n, True)
    except Exception as e: report(n, False, str(e)[:200])
rules = yaml.safe_load((root/"contracts/rules.yaml").read_text())
ids = [r["id"] for r in rules["rules"]]
report("rules.yaml ids R01..R22", ids == [f"R{i:02d}" for i in range(1, 23)])
report("rules.yaml fields", all({"id","layer","severity","phase","title","fields","message"} <= set(r) for r in rules["rules"]))
meta = {"upload_id": "00000000-0000-4000-8000-000000000000", "pass": 1, "template_id": "fpil-2.0-settrep-v1", "page_count": 16,
        "extracted_at": "2026-10-28T00:00:00Z", "engine": {"text_layer": "pdfplumber", "model": "claude"}}
files = [f for f in sorted(glob.glob(str(root/"docs/dashboard-json/*.dashboard.json"))) if not pathlib.Path(f).name.startswith("program-")]
bad = []
for f in files:
    try: jsonschema.validate({"meta": meta, "deal": json.load(open(f, encoding="utf-8")), "sources": {}}, ext)
    except Exception as e: bad.append(pathlib.Path(f).name + ": " + str(e)[:120])
report(f"{len(files)} reference deals validate", not bad, "; ".join(bad))
for f in sorted(glob.glob(str(root/"rules/tests/fixtures/findings/*.json"))):
    try: jsonschema.validate(json.load(open(f, encoding="utf-8")), fin); report(pathlib.Path(f).name, True)
    except Exception as e: report(pathlib.Path(f).name, False, str(e)[:150])
sys.exit(0 if ok else 1)
