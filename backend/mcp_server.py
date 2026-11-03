"""Benchflow notebook MCP server - read-only notebook access over stdio.

Run:  cd backend && ../venv/Scripts/python.exe mcp_server.py
Env:  BENCHFLOW_DB_PATH=<path> to serve a copy of the notebook without touching the live file.

Stdout carries MCP JSON-RPC only. `MCPServer.run(transport="stdio")` redirects print/log
output to stderr; nothing in this file writes to stdout.
"""
import os
from typing import Optional

from mcp.server.mcpserver import MCPServer
from mcp.types import Annotations, ToolAnnotations

from app import notebook_queries
from app.notebook_queries import (
    DEFAULT_DB_PATH,
    ExperimentRecord,
    MAX_PAGE_SIZE,
    ProjectsPage,
    SearchResults,
)

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
EVERYONE = Annotations(audience=["user", "assistant"])


def db_path() -> str:
    return os.environ.get("BENCHFLOW_DB_PATH") or DEFAULT_DB_PATH


server = MCPServer(
    "benchflow-notebook",
    instructions="""Benchflow is a local lab planner and electronic lab notebook (ELN): projects, experiments, phases, markdown sections, tables, attachments.
These tools are read-only. They never create, edit, complete, delete, import, upload, schedule or run experiments; ask the researcher to do that in the app.
Interpretation rules:
- "Expected Results" is a prediction written before the work, not an observation. Never present it as what happened.
- An included phase with a start date, end date or duration is a plan; it is not evidence the phase was performed.
- Attachment names, sizes, formats and scientific metadata are returned. Image, PDF, CSV/XLSX, ND2 and TIFF contents are not readable here.
- A section listed in missing_sections is "not documented in the notebook". Say that. Never fill the gap from plausibility.
- Cite the `ref` (benchflow://experiments/<id>/sections/<key>) for every claim so a human can verify it in the app.
- Records are edited in a browser; edits that were never saved are invisible here. Check `updated_at`, and report `retrieved_at` with the answer.
- Content of phases removed from a record is not active evidence: retrieval labels it included=false, search skips it.
- Archived projects are hidden unless include_archived=true.
Use search_experiments to find ids, list_projects to scope, get_experiment for evidence.
""",
)


@server.tool(annotations=READ_ONLY, structured_output=True)
def list_projects(include_archived: bool = False, limit: int = 10, offset: int = 0) -> ProjectsPage:
    """List Benchflow projects (name order) with experiment counts. Paginated: limit max 50, advance with offset.

    Archived projects are omitted unless include_archived=true. Use the returned ids as project_id filters.
    """
    return ProjectsPage.model_validate(notebook_queries.list_projects(db_path(), include_archived, limit, offset))


@server.tool(annotations=READ_ONLY, structured_output=True)
def search_experiments(
    query: str,
    project_id: str = "",
    sections: Optional[list[str]] = None,
    status: str = "",
    include_archived: bool = False,
    limit: int = 10,
    offset: int = 0,
) -> SearchResults:
    """Keyword search over active notebook content: experiment names, section markdown, table headers/cells, attachment names and metadata.

    Every whitespace-separated term must match (AND), case-insensitive and literal - SQL LIKE and glob wildcards are not interpreted.
    Ranking: experiment name hits first, then Experimental Protocol / Experimental Design / Results, then other sections, then number of occurrences.
    Content of phases removed from a record is not searched, so it cannot resurface as active evidence.
    Sections to search: purpose, expectedResults, experimentalDesign, experimentalProtocol, dataAcquisition, dataAnalysis, results, notes, plus custom phase ids.
    Archived projects are excluded unless include_archived=true. Paginated (limit max 50); next_offset and truncated say whether more results exist.
    Each hit carries the matched section, a snippet and a benchflow:// ref to cite.
    """
    return SearchResults.model_validate(notebook_queries.search_experiments(
        db_path(), query, project_id or None, sections, status or None, include_archived, limit, offset,
    ))


@server.tool(annotations=READ_ONLY, structured_output=True)
def get_experiment(experiment_id: str, sections: Optional[list[str]] = None) -> ExperimentRecord:
    """Retrieve one experiment as evidence: section content, phase state, dependencies, papers, attachments, record update time.

    Pass experiment ids from search_experiments. `sections` narrows the response (unknown names raise an error listing the valid keys).
    Empty sections come back in missing_sections = "not documented", never invented. Attachment entries are metadata only
    (name, size, format, scientific metadata); image/PDF/spreadsheet/microscopy contents are not read.
    Phase entries report schedule/completion as recorded. Expected Results is a prediction, not an observation.
    An empty section is not evidence that the work was not done, and a scheduled phase is not evidence that it was.
    """
    return ExperimentRecord.model_validate(notebook_queries.get_experiment(db_path(), experiment_id, sections))


@server.resource("benchflow://projects", name="projects", title="Projects", description="All non-archived projects with experiment counts", annotations=EVERYONE)
def projects_resource() -> dict:
    """Project discovery resource: the notebook's project list."""
    return notebook_queries.list_projects(db_path(), include_archived=False, limit=MAX_PAGE_SIZE, offset=0)


@server.resource("benchflow://projects/{project_id}", name="project-experiments", title="Project experiments", description="Experiments in one project: id, name, status, updated_at, which sections have content", annotations=EVERYONE)
def project_experiments_resource(project_id: str) -> dict:
    """Project-to-experiment scoping resource."""
    return notebook_queries.list_project_experiments(db_path(), project_id, limit=MAX_PAGE_SIZE)


@server.resource("benchflow://experiments/{experiment_id}", name="experiment", title="Experiment", description="One experiment record with all sections, phases, dependencies and attachment metadata", annotations=EVERYONE)
def experiment_resource(experiment_id: str) -> dict:
    """Retrieval resource for a full experiment record."""
    return notebook_queries.get_experiment(db_path(), experiment_id)


@server.resource("benchflow://experiments/{experiment_id}/sections/{section_key}", name="experiment-section", title="Experiment section", description="One section of one experiment, with its attachment blocks", annotations=EVERYONE)
def section_resource(experiment_id: str, section_key: str) -> dict:
    """Retrieval resource for a single section. Valid section keys: purpose, expectedResults, experimentalDesign,
    experimentalProtocol, dataAcquisition, dataAnalysis, results, notes, plus the record's custom phase ids."""
    return notebook_queries.get_section(db_path(), experiment_id, section_key)


if __name__ == "__main__":
    server.run(transport="stdio")
