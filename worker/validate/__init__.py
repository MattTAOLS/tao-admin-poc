"""Thin adapter: loads prior published deal + master data from the database, calls rules.run(), returns findings
for the worker / API to persist. See adapter.py."""
from .adapter import SqlStore, build_context, validate_extraction, retry_pages, resolved_by_pass_2, counts, insert_findings
