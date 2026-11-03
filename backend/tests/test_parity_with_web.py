"""Does this repo still match the web app it was copied from?

Standalone:  python backend/tests/test_parity_with_web.py
Pytest:      pytest backend/tests        (skipped when the web checkout is not next to this repo)

The web app stays the reference implementation: a bug fixed there is expected to arrive here, and
a bug fixed here is expected to go back. That only works if the two trees can be compared, so this
test does the comparing. It points at the checkout recorded in UPSTREAM.md, or at the folder in
BENCHFLOW_WEB_REPO.

What fails the test: a file the web app has that this repo lost (a dropped rename, a file deleted
by accident). Content differences are reported, not failed - this repo differs on purpose where
being a desktop app forces it (app/paths.py, app/database.py, app/main.py's first run, the
Settings page). Read the list; anything in it you did not choose is a bug.
"""
import ast
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def _web_checkout() -> Path:
    """The reference checkout: BENCHFLOW_WEB_REPO, else the sibling folder named in UPSTREAM.md."""
    candidates = [os.environ.get("BENCHFLOW_WEB_REPO") or "",
                  str(ROOT.parent / "Lab Planner and ELN" / "Lab-Planner-ELN"),
                  str(ROOT.parent / "Lab Planner and ELN")]
    for candidate in candidates:
        if candidate and (Path(candidate) / "backend" / "app" / "main.py").is_file():
            return Path(candidate)
    return Path(candidates[0] or candidates[1])


WEB = _web_checkout()

# Folders whose files must exist on both sides, and must be laid out the same way.
SHARED = ["backend/app", "frontend/src", "frontend/public"]
# Single files that must exist on both sides.
SHARED_FILES = ["backend/mcp_server.py", "backend/requirements.txt", "frontend/package.json",
                "frontend/vite.config.ts", "backend/tests/test_backup.py",
                "backend/tests/test_sharepoint_export.py"]


def _read(path: Path) -> bytes:
    """Line endings are checkout noise (git autocrlf), not a real difference."""
    return path.read_bytes().replace(b"\r\n", b"\n")


def _files(folder: Path) -> set[str]:
    return {
        p.relative_to(folder).as_posix()
        for p in folder.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
        and not p.name.startswith(".")
    }


def _missing_from_desktop() -> tuple[list[str], list[str], list[str]]:
    """(missing shared files, extra desktop files, differing files)."""
    missing, extra, differing = [], [], []
    for rel_folder in SHARED:
        here, there = ROOT / rel_folder, WEB / rel_folder
        if not here.is_dir() or not there.is_dir():
            missing.append(f"{rel_folder}/ (present in one repo, not the other)")
            continue
        web_files, desk_files = _files(there), _files(here)
        missing += [f"{rel_folder}/{f}" for f in sorted(web_files - desk_files)]
        extra += [f"{rel_folder}/{f}" for f in sorted(desk_files - web_files)]
        for name in sorted(web_files & desk_files):
            if _read(there / name) != _read(here / name):
                differing.append(f"{rel_folder}/{name}")
    for rel_file in SHARED_FILES:
        here, there = ROOT / rel_file, WEB / rel_file
        if not here.is_file():
            missing.append(rel_file)
        elif there.is_file() and _read(here) != _read(there):
            differing.append(rel_file)
    return missing, extra, differing


def _decorated_names(path: Path, suffix: str) -> set[str]:
    """Function names under `@server.<suffix>` ("tool", "resource") - the decorator is a call."""
    out = set()
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for decorator in node.decorator_list:
            called = decorator.func if isinstance(decorator, ast.Call) else decorator
            if (isinstance(called, ast.Attribute) and called.attr == suffix.lstrip(".")
                    and isinstance(called.value, ast.Name) and called.value.id == "server"):
                out.add(node.name)
    return out


def test_mcp_serves_the_same_tools_as_the_web_app() -> None:
    """The plan's acceptance row: `Benchflow.exe --mcp` serves the same tools as the web repo's
    mcp_server.py. Same names, same resources, all of them declared read-only."""
    here, there = ROOT / "backend" / "mcp_server.py", WEB / "backend" / "mcp_server.py"
    if not here.is_file() or not there.is_file():
        return _skip("no mcp_server.py to compare")
    for suffix in ("tool", "resource"):
        assert _decorated_names(here, suffix) == _decorated_names(there, suffix), (
            f"{suffix} definitions differ from the web app's"
        )
    tools = _decorated_names(here, "tool")
    declared = here.read_text(encoding="utf-8").count("@server.tool(annotations=READ_ONLY")
    assert declared == len(tools), "every MCP tool must declare READ_ONLY annotations"
    # The read-only claim is enforced in the query layer, not just announced to the client.
    queries = (ROOT / "backend" / "app" / "notebook_queries.py").read_text(encoding="utf-8")
    assert "?mode=ro" in queries and "query_only=ON" in queries, "notebook reads must be read-only"


def _skip(why: str) -> None:
    try:
        import pytest

        pytest.skip(why)
    except Exception:
        print(f"skipped: {why}")


def test_no_shared_file_was_lost() -> None:
    if not WEB.is_dir():
        try:
            import pytest

            pytest.skip(f"no web checkout at {WEB} (set BENCHFLOW_WEB_REPO to point at one)")
        except Exception:
            print(f"skipped: no web checkout at {WEB}")
            return
    missing, extra, differing = _missing_from_desktop()
    assert not missing, "the desktop repo is missing files the web app has:\n  " + "\n  ".join(missing)
    print(f"\nparity against {WEB}")
    print(f"  desktop-only files ({len(extra)}):")
    for name in extra:
        print(f"    {name}")
    print(f"  different content ({len(differing)}) - desktop changes are allowed, review this list:")
    for name in differing:
        print(f"    {name}")


if __name__ == "__main__":
    if not WEB.is_dir():
        print(f"No web checkout at {WEB}.\nSet BENCHFLOW_WEB_REPO to the Lab Planner & ELN folder.")
        sys.exit(0)
    test_no_shared_file_was_lost()
    test_mcp_serves_the_same_tools_as_the_web_app()
    print("\ntest_parity_with_web passed (no shared file lost, MCP tools match)")
