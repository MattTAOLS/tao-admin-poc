"""Reset a compose stack to a clean demo state in one command.

Wipes the stack's database and file store (docker compose down -v), starts it again, waits for the API, loads master
data (partners, programs, deals, covenant definitions), and optionally loads a demo profile. Nothing else is touched.

  python scripts/reset_demo.py                         # default stack (project tao-admin-poc): master data only
  python scripts/reset_demo.py --profile review        # ... plus the review demo state (scripts/demo_data.py)
  python scripts/reset_demo.py --profile partner       # ... plus all 12 reference deals published (no uploads)
  python scripts/reset_demo.py -p my-stack --agent --api-port 18100 --profile admin   # a private stack (compose.agent.yml)

It asks before wiping unless you pass --yes.
"""
import argparse
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def compose(args: argparse.Namespace) -> list[str]:
    cmd = ["docker", "compose", "-p", args.project, "-f", "docker-compose.yml"]
    if args.agent:
        cmd += ["-f", "scripts/compose.agent.yml"]
    return cmd


def run(cmd: list[str], env: dict) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, env=env, check=True)


def wait_for(url: str, seconds: int) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return
        except Exception:
            pass
        time.sleep(2)
    sys.exit(f"timed out after {seconds}s waiting for {url}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Wipe a compose stack and reload master data (and optionally a demo profile).")
    ap.add_argument("-p", "--project", default="tao-admin-poc", help="compose project name (default: tao-admin-poc)")
    ap.add_argument("--agent", action="store_true", help="add scripts/compose.agent.yml (private stack on --api-port / --web-port)")
    ap.add_argument("--api-port", type=int, default=None, help="host port of the API (default 8000, or 18000 with --agent)")
    ap.add_argument("--web-port", type=int, default=None, help="host port of the web app, with --agent")
    ap.add_argument("--profile", choices=["none", "admin", "review", "partner"], default="none")
    ap.add_argument("--yes", action="store_true", help="do not ask before wiping")
    args = ap.parse_args()

    api_port = args.api_port or (18000 if args.agent else 8000)
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    if args.agent:
        env["API_PORT"] = str(api_port)
        if args.web_port:
            env["WEB_PORT"] = str(args.web_port)
    api = f"http://127.0.0.1:{api_port}"

    if not args.yes:
        answer = input(f"This deletes every upload, finding and publication in compose project '{args.project}'. Continue? [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            sys.exit("cancelled")

    run(compose(args) + ["down", "-v"], env)
    run(compose(args) + ["up", "-d"], env)
    wait_for(f"{api}/api/v1/openapi.json", 180)
    seed = compose(args) + ["exec", "-T", "api", "python", "-m", "app.seed"]
    run(seed + (["--reference-publications"] if args.profile == "partner" else []), env)
    if args.profile in ("admin", "review"):
        run([sys.executable, "scripts/demo_data.py", "--api", api, "--profile", args.profile], env)
    print(f"done: project {args.project}, API {api}, profile {args.profile}")


if __name__ == "__main__":
    main()
