"""Rule engine: loads contracts/rules.yaml, evaluates rules against an extraction + context, returns findings.
Owned by the Rules agent. Importable by both worker and api. Keep it free of DB and HTTP."""
from .engine import run, load_rules
