"""Read-only notebook access for the MCP server.

Deliberately does not import `app.main` or `app.database`: importing those
creates the engine, runs `init_db()` and can seed a default notebook. Every
connection here is opened SQLite read-only, so a tool call cannot modify a record.
"""
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

# Only the phase rules are reused from the app; app.db_service has no side effects.
from app.db_service import normalize_phases
from app.paths import DB_PATH as DEFAULT_DB_PATH

# section key -> (label, database column). Mirrors app.schemas.STANDARD_SECTIONS.
STANDARD_SECTIONS = {
    "purpose": ("Purpose", "purpose"),
    "expectedResults": ("Expected Results", "expected_results"),
    "experimentalDesign": ("Experimental Design", "experimental_design"),
    "experimentalProtocol": ("Experimental Protocol", "experimental_protocol"),
    "dataAcquisition": ("Data Acquisition", "data_acquisition"),
    "dataAnalysis": ("Data Analysis", "data_analysis"),
    "results": ("Results", "results"),
    "notes": ("Notes", "notes"),
}
BUILTIN_PHASE_SECTIONS = ("experimentalProtocol", "dataAcquisition", "dataAnalysis")

# Search ranking: name hits dominate, then the sections a researcher writes the
# method and the outcome in. Occurrence count is the tie-breaker.
NAME_WEIGHT = 8
SECTION_WEIGHTS = {
    "experimentalProtocol": 4,
    "experimentalDesign": 4,
    "results": 4,
    "purpose": 3,
    "dataAcquisition": 3,
    "dataAnalysis": 3,
    "expectedResults": 2,
    "notes": 2,
}
DEFAULT_SECTION_WEIGHT = 1

MAX_PAGE_SIZE = 50
DEFAULT_PAGE_SIZE = 10
MAX_SECTION_CHARS = 4000
MAX_TABLE_ROWS = 50
SNIPPET_CONTEXT = 120


class ProjectsPage(BaseModel):
    total: int
    limit: int
    offset: int
    next_offset: Optional[int] = None
    include_archived: bool = False
    projects: list[dict[str, Any]] = []


class SearchResults(BaseModel):
    query: str
    total_matches: int
    limit: int
    offset: int
    next_offset: Optional[int] = None
    truncated: bool = False
    searched_sections: list[str] = []
    hits: list[dict[str, Any]] = []


class ExperimentRecord(BaseModel):
    experiment_id: str
    experiment_name: str
    project_id: str
    project_name: str
    project_archived: bool = False
    status: str = ""
    priority: str = ""
    papers: list[str] = []
    linked_paper: str = ""
    updated_at: Optional[str] = None
    retrieved_at: str
    included_phases: list[str] = []
    excluded_phases: list[str] = []
    custom_phases: list[dict[str, Any]] = []
    dependencies: dict[str, list[dict[str, str]]] = {}
    sections: list[dict[str, Any]] = []
    missing_sections: list[str] = []
    notes_on_scope: list[str] = []


def source_ref(experiment_id: str, section_key: str, block_index: Optional[int] = None) -> str:
    ref = f"benchflow://experiments/{experiment_id}/sections/{section_key}"
    return f"{ref}#block-{block_index}" if block_index is not None else ref


def connect(db_path: Path | str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Open the notebook read-only. Never creates a database."""
    path = Path(db_path)
    if not path.is_file():
        raise FileNotFoundError(
            f"Benchflow database not found at {path}. Start the app once to create it, "
            "or set BENCHFLOW_DB_PATH to the notebook file."
        )
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return value


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if isinstance(value, datetime) else value


def included_phase_keys(phases: Optional[list[str]], custom_ids: list[str]) -> tuple[list[str], list[str]]:
    """Mirror the UI's `getExperimentPhases`: None means all default + custom phases,
    [] means no phases. Returns (included, excluded)."""
    known = list(BUILTIN_PHASE_SECTIONS) + list(custom_ids)
    if phases is None:
        return known, []
    normalized = normalize_phases(phases) or []
    return [k for k in known if k in normalized], [k for k in known if k not in normalized]


def _table_text(rows: list[list[Any]]) -> str:
    kept = (rows or [])[:MAX_TABLE_ROWS]
    return "\n".join("\t".join(str(cell) for cell in row) for row in kept)


def extract_sections(exp: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """One shared section view for search and retrieval.

    Covers standard sections, custom phases, text blocks, table headers/cells and
    attachment names/metadata. Ownership matches the UI:
    `block.section || block.phase || 'results'`, so legacy blocks belong to Results
    and phase-owned attachments stay with their phase.
    """
    exp_id = exp["id"]
    custom_phases = _json(exp.get("custom_phases")) or []
    blocks = _json(exp.get("blocks")) or []
    phases = normalize_phases(_json(exp.get("phases")))
    custom_ids = [cp["id"] for cp in custom_phases if cp.get("id")]
    included, _ = included_phase_keys(phases, custom_ids)
    # The five narrative sections are always shown; only phase sections can be removed.
    phase_like = set(BUILTIN_PHASE_SECTIONS) | set(custom_ids)

    def is_included(key: str) -> bool:
        return key in included if key in phase_like else True

    sections: dict[str, dict[str, Any]] = {}
    for key, (label, column) in STANDARD_SECTIONS.items():
        phase_info = None
        if key in BUILTIN_PHASE_SECTIONS:
            phase_info = {
                "duration": exp.get(f"{column}_duration") or "",
                "completed": bool(exp.get(f"{column}_completed")),
                "start_date": exp.get(f"{column}_start_date") or "",
                "end_date": exp.get(f"{column}_end_date") or "",
            }
        sections[key] = {
            "key": key,
            "label": label,
            "text": (exp.get(column) or "").strip(),
            "included": is_included(key),
            "phase": phase_info,
            "blocks": [],
            "ref": source_ref(exp_id, key),
            "truncated": False,
        }

    for cp in custom_phases:
        key = cp.get("id")
        if not key:
            continue
        sections[key] = {
            "key": key,
            "label": cp.get("name") or key,
            "text": (cp.get("content") or "").strip(),
            "included": is_included(key),
            "phase": {
                "duration": cp.get("duration") or "",
                "completed": bool(cp.get("completed")),
                "start_date": cp.get("startDate") or "",
                "end_date": cp.get("endDate") or "",
            },
            "blocks": [],
            "ref": source_ref(exp_id, key),
            "truncated": False,
        }

    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            continue
        owner = block.get("section") or block.get("phase") or "results"
        section = sections.get(owner)
        if section is None:  # a block owned by a section the record no longer lists
            section = sections[owner] = {
                "key": owner,
                "label": owner,
                "text": "",
                "included": is_included(owner),
                "phase": None,
                "blocks": [],
                "ref": source_ref(exp_id, owner),
                "truncated": False,
            }
        block_type = block.get("type")
        name = block.get("name") or ""
        metadata = {
            "index": index,
            "type": block_type,
            "name": name,
            "section": owner,
            "mime_type": block.get("mimeType"),
            "size": block.get("size"),
            "format": block.get("format"),
            "metadata": block.get("metadata"),
            "app_url": block.get("src"),
            "ref": source_ref(exp_id, owner, index),
        }
        section["blocks"].append(metadata)
        if block_type == "txt":
            text = (block.get("text") or "").strip()
            section["text"] = "\n\n".join(part for part in (section["text"], f"{name}: {text}" if name else text) if part)
        elif block_type == "tbl":
            table = _table_text(block.get("rows") or [])
            section["text"] = "\n\n".join(part for part in (section["text"], f"{name}\n{table}" if table else name) if part)
        elif name:  # images and files contribute their name and scientific metadata
            section["text"] = "\n\n".join(part for part in (section["text"], f"{name} {json.dumps(block.get('metadata') or {})}") if part)

    return sections


def _load_experiments(conn: sqlite3.Connection, include_archived: bool) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT e.*, p.name AS project_name, p.archived AS project_archived
        FROM experiments e JOIN projects p ON p.id = e.project_id
        ORDER BY p.name, e.name
        """
    ).fetchall()
    return [dict(r) for r in rows if include_archived or not r["project_archived"]]


def _load_names(conn: sqlite3.Connection, table: str) -> dict[str, str]:
    return {row["id"]: row["name"] for row in conn.execute(f"SELECT id, name FROM {table}")}  # noqa: S608 - fixed table names


def _paper_names(conn: sqlite3.Connection) -> dict[str, str]:
    return _load_names(conn, "papers")


def _project_papers(conn: sqlite3.Connection) -> dict[str, list[str]]:
    links: dict[str, list[str]] = {}
    names = _paper_names(conn)
    for row in conn.execute("SELECT project_id, paper_id FROM project_papers"):
        links.setdefault(row["project_id"], []).append(names.get(row["paper_id"], row["paper_id"]))
    return links


def _dependencies(conn: sqlite3.Connection, exp_id: str, names: dict[str, str]) -> dict[str, list[dict[str, str]]]:
    depends_on = [
        {"id": row["depends_on_id"], "name": names.get(row["depends_on_id"], row["depends_on_id"])}
        for row in conn.execute("SELECT depends_on_id FROM experiment_dependencies WHERE experiment_id = ?", (exp_id,))
    ]
    depended_by = [
        {"id": row["experiment_id"], "name": names.get(row["experiment_id"], row["experiment_id"])}
        for row in conn.execute("SELECT experiment_id FROM experiment_dependencies WHERE depends_on_id = ?", (exp_id,))
    ]
    return {"depends_on": depends_on, "depended_by": depended_by}


def _page(items: list[Any], limit: int, offset: int) -> tuple[int, Optional[int]]:
    limit = max(1, min(int(limit), MAX_PAGE_SIZE))
    offset = max(0, int(offset))
    next_offset = offset + limit if offset + limit < len(items) else None
    return limit, next_offset


def list_projects(
    db_path: Path | str = DEFAULT_DB_PATH,
    include_archived: bool = False,
    limit: int = DEFAULT_PAGE_SIZE,
    offset: int = 0,
) -> dict[str, Any]:
    conn = connect(db_path)
    try:
        rows = conn.execute(
            "SELECT id, name, archived, updated_at FROM projects ORDER BY name"
        ).fetchall()
        projects = [r for r in rows if include_archived or not r["archived"]]
        counts = {r["id"]: r["count"] for r in conn.execute(
            "SELECT project_id AS id, COUNT(*) AS count FROM experiments GROUP BY project_id"
        )}
        limit, next_offset = _page(projects, limit, offset)
        return ProjectsPage(
            total=len(projects),
            limit=limit,
            offset=offset,
            next_offset=next_offset,
            include_archived=include_archived,
            projects=[
                {
                    "id": p["id"],
                    "name": p["name"],
                    "archived": bool(p["archived"]),
                    "experiment_count": counts.get(p["id"], 0),
                    "updated_at": _iso(p["updated_at"]),
                }
                for p in projects[offset: offset + limit]
            ],
        ).model_dump()
    finally:
        conn.close()


def _validate_sections(keys: Optional[list[str]], valid: list[str]) -> list[str]:
    if not keys:
        return valid
    unknown = [k for k in keys if k not in valid]
    if unknown:
        raise ValueError(f"Unknown section(s): {', '.join(unknown)}. Valid: {', '.join(valid)}")
    return [k for k in valid if k in keys]


def _snippet(text: str, tokens: list[str]) -> str:
    lowered = text.lower()
    position = min((lowered.find(token) for token in tokens if lowered.find(token) != -1), default=-1)
    if position == -1:
        return text[: SNIPPET_CONTEXT * 2]
    start = max(0, position - SNIPPET_CONTEXT)
    end = min(len(text), position + SNIPPET_CONTEXT * 3)
    return f"{'...' if start else ''}{text[start:end]}{'...' if end < len(text) else ''}"


def search_experiments(
    db_path: Path | str = DEFAULT_DB_PATH,
    query: str = "",
    project_id: Optional[str] = None,
    sections: Optional[list[str]] = None,
    status: Optional[str] = None,
    include_archived: bool = False,
    limit: int = DEFAULT_PAGE_SIZE,
    offset: int = 0,
) -> dict[str, Any]:
    """Literal (non-SQL, non-glob) keyword search over active notebook sections.

    All whitespace-separated terms must match (AND), case-insensitive. Experiment-name
    matching always applies; `sections` limits section content only. Ranking:
    NAME_WEIGHT for the experiment name, SECTION_WEIGHTS per section, times
    occurrences. Archived projects are excluded unless requested.

    shortcut: literal case-insensitive substring matching, no fuzzy or semantic
    matching; add SQLite FTS5 if real searches prove slow or imprecise.
    """
    tokens = [t.lower() for t in re.findall(r"\S+", query or "")]
    if not tokens:
        raise ValueError("query must contain at least one word")
    conn = connect(db_path)
    try:
        experiments = _load_experiments(conn, include_archived)
        if project_id:
            experiments = [e for e in experiments if e["project_id"] == project_id]
        if status:
            experiments = [e for e in experiments if (e["status"] or "").lower() == status.strip().lower()]

        hits = []
        searched: set[str] = set()
        for exp in experiments:
            all_sections = extract_sections(exp)
            wanted = _validate_sections(sections, list(all_sections))
            matches = []
            score = 0
            matched_tokens: set[str] = set()
            name = exp["name"] or ""
            name_counts = {token: name.lower().count(token) for token in tokens}
            name_hits = sum(name_counts.values())
            if name_hits:
                score += NAME_WEIGHT * name_hits
                matched_tokens |= {token for token, count in name_counts.items() if count}
                matches.append({
                    "section": "name",
                    "label": "Experiment name",
                    "ref": source_ref(exp["id"], "name"),
                    "occurrences": name_hits,
                    "snippet": name,
                })
            for key in wanted:
                section = all_sections[key]
                searched.add(key)
                if not section["text"] or not section["included"]:
                    continue  # excluded-phase text is not active evidence
                text = section["text"]
                lowered = text.lower()
                counts = {token: lowered.count(token) for token in tokens}
                occurrences = sum(counts.values())
                if occurrences:
                    matched_tokens |= {token for token, count in counts.items() if count}
                    score += SECTION_WEIGHTS.get(key, DEFAULT_SECTION_WEIGHT) * occurrences
                    matches.append({
                        "section": key,
                        "label": section["label"],
                        "ref": section["ref"],
                        "occurrences": occurrences,
                        "snippet": _snippet(text, tokens),
                    })
            if score and matched_tokens == set(tokens):  # AND: every term must appear in active content
                hits.append({
                    "experiment_id": exp["id"],
                    "experiment_name": name,
                    "project_id": exp["project_id"],
                    "project_name": exp["project_name"],
                    "status": exp["status"],
                    "priority": exp.get("priority") or "",
                    "updated_at": _iso(exp["updated_at"]),
                    "score": score,
                    "matches": matches,
                })

        hits.sort(key=lambda hit: (-hit["score"], hit["experiment_name"].lower()))
        limit, next_offset = _page(hits, limit, offset)
        return SearchResults(
            query=query,
            total_matches=len(hits),
            limit=limit,
            offset=offset,
            next_offset=next_offset,
            truncated=next_offset is not None,
            searched_sections=sorted(searched),
            hits=hits[offset: offset + limit],
        ).model_dump()
    finally:
        conn.close()


def list_project_experiments(
    db_path: Path | str = DEFAULT_DB_PATH,
    project_id: str = "",
    include_archived: bool = False,
    limit: int = DEFAULT_PAGE_SIZE,
    offset: int = 0,
) -> dict[str, Any]:
    """Project scoping: which experiments exist in a project and which of their sections have content."""
    conn = connect(db_path)
    try:
        project = conn.execute("SELECT id, name, archived FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            raise LookupError(f"No project with id {project_id!r}. Use list_projects to find ids.")
        experiments = [e for e in _load_experiments(conn, include_archived) if e["project_id"] == project_id]
        limit, next_offset = _page(experiments, limit, offset)
        return {
            "project_id": project["id"],
            "project_name": project["name"],
            "project_archived": bool(project["archived"]),
            "total": len(experiments),
            "limit": limit,
            "offset": offset,
            "next_offset": next_offset,
            "experiments": [
                {
                    "id": e["id"],
                    "name": e["name"],
                    "status": e["status"],
                    "priority": e.get("priority") or "",
                    "updated_at": _iso(e["updated_at"]),
                    "sections_with_content": sorted(k for k, s in extract_sections(e).items() if s["text"] or s["blocks"]),
                }
                for e in experiments[offset: offset + limit]
            ],
        }
    finally:
        conn.close()


def get_section(db_path: Path | str = DEFAULT_DB_PATH, experiment_id: str = "", section_key: str = "") -> dict[str, Any]:
    """One section of one experiment. Raises for an unknown key (message lists valid keys) or an empty section."""
    record = get_experiment(db_path, experiment_id, sections=[section_key])
    if not record["sections"]:
        raise LookupError(f"Section {section_key!r} of experiment {experiment_id} has no content - it is not documented in the notebook.")
    return {
        "experiment_id": record["experiment_id"],
        "experiment_name": record["experiment_name"],
        "updated_at": record["updated_at"],
        "retrieved_at": record["retrieved_at"],
        "section": record["sections"][0],
        "notes_on_scope": record["notes_on_scope"],
    }


def get_experiment(
    db_path: Path | str = DEFAULT_DB_PATH,
    experiment_id: str = "",
    sections: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Retrieve one record's evidence: sections, phases, dependencies, attachments."""
    conn = connect(db_path)
    try:
        row = conn.execute(
            """
            SELECT e.*, p.name AS project_name, p.archived AS project_archived
            FROM experiments e JOIN projects p ON p.id = e.project_id WHERE e.id = ?
            """,
            (experiment_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"No experiment with id {experiment_id!r}. Use search_experiments to find ids.")
        exp = dict(row)
        all_sections = extract_sections(exp)
        wanted = _validate_sections(sections, list(all_sections))

        payload: dict[str, Any] = {
            "experiment_id": exp["id"],
            "experiment_name": exp["name"],
            "project_id": exp["project_id"],
            "project_name": exp["project_name"],
            "project_archived": bool(exp["project_archived"]),
            "status": exp["status"],
            "priority": exp.get("priority") or "",
            "papers": _project_papers(conn).get(exp["project_id"], []),
            "linked_paper": _paper_names(conn).get(exp.get("paper") or "", exp.get("paper") or ""),
            "updated_at": _iso(exp["updated_at"]),
            "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "included_phases": [k for k, s in all_sections.items() if s["phase"] and s["included"]],
            "excluded_phases": [k for k, s in all_sections.items() if s["phase"] and not s["included"]],
            "custom_phases": _json(exp.get("custom_phases")) or [],
            "dependencies": _dependencies(conn, exp["id"], _load_names(conn, "experiments")),
            "sections": [],
            "missing_sections": [],
            "notes_on_scope": [
                "Expected Results is a prediction, not an observation.",
                "An included phase with a schedule is a plan; it is not evidence the phase was performed.",
                "Attachment contents (images, PDFs, spreadsheets, ND2/TIFF) are not read; only names and metadata are returned.",
                "Browser edits that failed to sync to the database are not visible here.",
            ],
        }
        for key in wanted:
            section = all_sections[key]
            if not section["text"] and not section["blocks"]:
                payload["missing_sections"].append(key)
                continue
            shown = dict(section)
            # shortcut: only section text is truncated, not block metadata or table cells;
            # cap blocks/cells with an indicator if table-heavy records bloat responses.
            if len(shown["text"]) > MAX_SECTION_CHARS:
                shown["text"] = shown["text"][:MAX_SECTION_CHARS]
                shown["truncated"] = True
            payload["sections"].append(shown)
        return ExperimentRecord(**payload).model_dump()
    finally:
        conn.close()
