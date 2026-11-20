from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON, event, inspect
from sqlalchemy.orm import Session

from app.mobile_sync.merge import ensure_block_ids

# Bumped when a notebook gains something an older build would drop on save. Stored as
# PRAGMA user_version; app/backup.py refuses to pull a notebook newer than this build.
NOTEBOOK_SCHEMA_VERSION = 1

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class PaperDB(SQLModel, table=True):
    __tablename__ = "papers"
    id: str = Field(primary_key=True)
    name: str
    color: str = Field(default="#4a6fa5")
    archived: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)

class ProjectDB(SQLModel, table=True):
    __tablename__ = "projects"
    id: str = Field(primary_key=True)
    name: str
    archived: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    rev: int = Field(default=0, index=True)
    device_id: str = Field(default="")

class ProjectPaperLinkDB(SQLModel, table=True):
    __tablename__ = "project_papers"
    project_id: str = Field(foreign_key="projects.id", primary_key=True)
    paper_id: str = Field(primary_key=True)

class ExperimentDB(SQLModel, table=True):
    __tablename__ = "experiments"
    id: str = Field(primary_key=True)
    project_id: str = Field(foreign_key="projects.id", index=True)
    name: str
    status: str = Field(default="Planned")
    priority: Optional[str] = Field(default="")
    paper: Optional[str] = Field(default="")
    purpose: Optional[str] = Field(default="")
    expected_results: Optional[str] = Field(default="")
    experimental_design: Optional[str] = Field(default="")
    experimental_protocol: Optional[str] = Field(default="")
    experimental_protocol_duration: Optional[str] = Field(default="")
    experimental_protocol_completed: bool = Field(default=False)
    experimental_protocol_start_date: Optional[str] = Field(default="")
    experimental_protocol_end_date: Optional[str] = Field(default="")
    data_acquisition: Optional[str] = Field(default="")
    data_acquisition_duration: Optional[str] = Field(default="")
    data_acquisition_completed: bool = Field(default=False)
    data_acquisition_start_date: Optional[str] = Field(default="")
    data_acquisition_end_date: Optional[str] = Field(default="")
    data_analysis: Optional[str] = Field(default="")
    data_analysis_duration: Optional[str] = Field(default="")
    data_analysis_completed: bool = Field(default=False)
    data_analysis_start_date: Optional[str] = Field(default="")
    data_analysis_end_date: Optional[str] = Field(default="")
    results: Optional[str] = Field(default="")
    notes: Optional[str] = Field(default="")
    phases: Optional[List[str]] = Field(default=None, sa_column=Column(JSON))
    custom_phases: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    blocks: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    # {phaseKey: [{id, at, device_id, text}, ...]}, append-only, merged by union on id
    deviations: Optional[Dict[str, List[Dict[str, Any]]]] = Field(default=None, sa_column=Column(JSON))
    px: Optional[float] = Field(default=None)
    py: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    # notebook-wide counter, set by _stamp_revisions on every content change
    rev: int = Field(default=0, index=True)
    device_id: str = Field(default="")  # last writer

class ExperimentDependencyDB(SQLModel, table=True):
    __tablename__ = "experiment_dependencies"
    experiment_id: str = Field(foreign_key="experiments.id", primary_key=True)
    depends_on_id: str = Field(primary_key=True)

class SettingDB(SQLModel, table=True):
    __tablename__ = "settings"
    key: str = Field(primary_key=True)
    value: str = Field(default="")


# -- mobile sync (docs/adr/0002-mobile-sync.md) ------------------------------------------
# These live in the notebook (not settings), so they travel with OneDrive snapshots and a second
# PC never re-applies what the first one already did.

class TombstoneDB(SQLModel, table=True):
    """A deleted experiment/project, so a sync peer learns of the delete and a phone edit to it
    can be restored from `data` instead of dropped."""
    __tablename__ = "tombstones"
    id: str = Field(primary_key=True)
    kind: str = Field(primary_key=True)  # experiment | project
    rev: int = Field(default=0, index=True)
    deleted_at: datetime = Field(default_factory=utc_now)
    data: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))

class SyncConflictDB(SQLModel, table=True):
    """The side that lost a merge. Values are JSON text; nothing here is ever deleted by sync."""
    __tablename__ = "sync_conflicts"
    id: str = Field(primary_key=True)
    experiment_id: str = Field(index=True)
    unit: str  # merge unit, e.g. experimentalProtocol or blocks/<id>
    kept: str = Field(default="null")
    parked: str = Field(default="null")
    base: str = Field(default="null")
    source: str = Field(default="phone")  # side parked: phone | desktop; or restored | rejected | replaced (audit)
    device_id: str = Field(default="")
    op_id: str = Field(default="")
    created_at: datetime = Field(default_factory=utc_now)
    resolved_at: Optional[datetime] = Field(default=None)

class AppliedOpDB(SQLModel, table=True):
    """Phone op ids already applied: a replayed push is a no-op."""
    __tablename__ = "applied_ops"
    op_id: str = Field(primary_key=True)
    device_id: str = Field(default="", index=True)
    experiment_id: str = Field(default="")
    result: str = Field(default="applied")
    applied_at: datetime = Field(default_factory=utc_now)


# -- API dict <-> row ----------------------------------------------------------------------

def normalize_phases(phases: Optional[List[str]]) -> Optional[List[str]]:
    if phases is None:
        return None
    mapping = {
        "Protocol": "experimentalProtocol",
        "Acquisition": "dataAcquisition",
        "Analysis": "dataAnalysis",
    }
    return [mapping.get(p, p) for p in phases]

# (API key, column) for every experiment field that is notebook content
EXP_FIELDS = [
    ("name", "name"), ("status", "status"), ("priority", "priority"), ("paper", "paper"),
    ("purpose", "purpose"), ("expectedResults", "expected_results"),
    ("experimentalDesign", "experimental_design"),
    *[(key + suffix, col + col_suffix)
      for key, col in (("experimentalProtocol", "experimental_protocol"),
                       ("dataAcquisition", "data_acquisition"), ("dataAnalysis", "data_analysis"))
      for suffix, col_suffix in (("", ""), ("Duration", "_duration"), ("Completed", "_completed"),
                                 ("StartDate", "_start_date"), ("EndDate", "_end_date"))],
    ("results", "results"), ("notes", "notes"), ("phases", "phases"),
    ("customPhases", "custom_phases"), ("blocks", "blocks"), ("deviations", "deviations"),
    ("px", "px"), ("py", "py"),
]
_NULLABLE = {"phases", "customPhases", "deviations", "px", "py"}


def exp_to_dict(e: "ExperimentDB") -> Dict[str, Any]:
    """An experiment row in API form (camelCase), without deps (they live in their own table)."""
    d: Dict[str, Any] = {"id": e.id}
    for key, col in EXP_FIELDS:
        v = getattr(e, col, None)
        if key.endswith("Completed"):
            v = bool(v)
        elif key == "phases":
            v = normalize_phases(v)
        elif key == "blocks":
            v = v or []
        elif key not in _NULLABLE:
            v = v or ("Planned" if key == "status" else "")
        d[key] = v
    return d


def apply_exp_dict(e: "ExperimentDB", d: Dict[str, Any]) -> None:
    """Write API-form fields present in d onto the row."""
    for key, col in EXP_FIELDS:
        if key not in d:
            continue
        v = d[key]
        if key.endswith("Completed"):
            v = bool(v)
        elif key == "phases":
            v = normalize_phases(v)
        elif key == "blocks":
            v = ensure_block_ids(v)
        elif key not in _NULLABLE:
            v = v or ("Planned" if key == "status" else "")
        setattr(e, col, v)


# -- revisions and tombstones, for every writer -------------------------------------------
# A session hook rather than calls in each writer: the window's save, the position PATCH, the
# OneNote importer and the phone ops all bump `rev` the same way, and none can forget to.

_NOT_CONTENT = {"rev", "device_id", "updated_at", "created_at"}


def next_rev(connection) -> int:
    return (connection.exec_driver_sql(
        "SELECT MAX(m) FROM (SELECT MAX(rev) m FROM experiments UNION ALL "
        "SELECT MAX(rev) FROM projects UNION ALL SELECT MAX(rev) FROM tombstones)").scalar() or 0) + 1


def content_changed(obj) -> bool:
    state = inspect(obj)
    return any(state.attrs[a.key].history.has_changes()
               for a in state.mapper.column_attrs if a.key not in _NOT_CONTENT)


@event.listens_for(Session, "before_flush")
def _stamp_revisions(session, _flush_context, _instances):
    tracked = (ExperimentDB, ProjectDB)
    new = [o for o in session.new if isinstance(o, tracked)]
    changed = new + [o for o in session.dirty if isinstance(o, tracked) and content_changed(o)]
    gone = [o for o in session.deleted if isinstance(o, tracked)]
    if not changed and not gone:
        return
    conn = session.connection()
    rev, now = next_rev(conn), utc_now()
    for o in changed:
        o.rev, o.updated_at = rev, now
    for o in new:  # re-created: no longer deleted
        conn.exec_driver_sql("DELETE FROM tombstones WHERE id = ? AND kind = ?",
                             (o.id, "experiment" if isinstance(o, ExperimentDB) else "project"))
    with session.no_autoflush:
        for o in gone:
            if isinstance(o, ExperimentDB):
                data = {**exp_to_dict(o), "projectId": o.project_id}
                session.merge(TombstoneDB(id=o.id, kind="experiment", rev=rev, deleted_at=now, data=data))
            else:
                session.merge(TombstoneDB(id=o.id, kind="project", rev=rev, deleted_at=now,
                                          data={"id": o.id, "name": o.name, "archived": o.archived}))
