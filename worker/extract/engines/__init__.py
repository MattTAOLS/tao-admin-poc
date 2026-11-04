"""Optional per-template engines. A template sets `engine: <module>` to use one; each module provides
parse(pages, page_count, tpl) -> mapper.Parsed and build(parsed, recorder, *, prior=None, partial=False).
Engines are named by document layout, never by deal or servicer."""
