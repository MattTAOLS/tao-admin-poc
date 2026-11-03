"""Loads seed/*.json into the database. The Data & API agent implements persistence; until then this prints what it would load."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parents[1] / "seed"
if __name__ == "__main__":
    for f in sorted(root.glob("*.json")):
        print(f.name, len(json.loads(f.read_text())), "rows")
