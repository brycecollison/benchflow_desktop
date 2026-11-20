import json
import threading
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional
from sqlmodel import Session, select, delete

from app.mobile_sync.merge import merge_experiment
from app.models import (
    ProjectDB,
    PaperDB,
    ProjectPaperLinkDB,
    ExperimentDB,
    ExperimentDependencyDB,
    SettingDB,
    SyncConflictDB,
    TombstoneDB,
    apply_exp_dict,
    content_changed,
    exp_to_dict,
    next_rev,
    normalize_phases,  # noqa: F401  (re-exported: notebook_queries imports it from here)
)
from app.schemas import LabState, Project, Paper, Experiment

# The window's save and phone ops (app/mobile_sync) are both read-modify-write on the same rows,
# from different server threads. One lock, so neither writes over a row the other just changed.
WRITE_LOCK = threading.RLock()


def get_setting(session: Session, key: str) -> Optional[str]:
    s = session.get(SettingDB, key)
    return s.value if s else None

def set_setting(session: Session, key: str, value: str) -> None:
    s = session.get(SettingDB, key)
    if s:
        s.value = value
    else:
        s = SettingDB(key=key, value=value)
        session.add(s)
    session.commit()


def get_device_id(session: Session) -> str:
    """This PC's sync identity. In settings, so it stays with the machine, not the notebook.
    Commits when it creates one: call it before making other changes in the session."""
    device_id = get_setting(session, "device_id")
    if not device_id:
        device_id = "desktop-" + uuid.uuid4().hex[:12]
        set_setting(session, "device_id", device_id)
    return device_id


def current_rev(session: Session) -> int:
    return next_rev(session.connection()) - 1


def _deps(session: Session, exp_id: str) -> List[str]:
    return list(session.exec(
        select(ExperimentDependencyDB.depends_on_id).where(ExperimentDependencyDB.experiment_id == exp_id)
    ).all())


def _set_deps(session: Session, exp_id: str, deps: List[str]) -> None:
    session.exec(delete(ExperimentDependencyDB).where(ExperimentDependencyDB.experiment_id == exp_id))
    for dep_id in deps:
        session.add(ExperimentDependencyDB(experiment_id=exp_id, depends_on_id=dep_id))


def experiment_api(session: Session, e: ExperimentDB) -> Experiment:
    return Experiment(**exp_to_dict(e), deps=_deps(session, e.id))


def canonical(exp: Dict[str, Any]) -> Dict[str, Any]:
    """One shape for comparing experiments: what the API model dumps (None keys included)."""
    return Experiment.model_validate(exp).model_dump()


def record_conflict(session: Session, exp_id: str, conflict: Dict[str, Any], source: str,
                    device_id: str = "", op_id: str = "") -> None:
    session.add(SyncConflictDB(
        id=uuid.uuid4().hex, experiment_id=exp_id, unit=conflict["unit"],
        kept=json.dumps(conflict.get("kept")), parked=json.dumps(conflict.get("parked")),
        base=json.dumps(conflict.get("base")), source=source, device_id=device_id, op_id=op_id,
    ))


def get_lab_state(session: Session) -> LabState:
    rev = current_rev(session)  # before reading rows: a later write must look newer, not be skipped
    papers = session.exec(select(PaperDB)).all()
    paper_list = [
        Paper(
            id=p.id,
            name=p.name,
            color=p.color,
            archived=p.archived,
        )
        for p in papers
    ]

    project_list = []
    for proj in session.exec(select(ProjectDB)).all():
        links = session.exec(
            select(ProjectPaperLinkDB).where(ProjectPaperLinkDB.project_id == proj.id)
        ).all()
        exps = session.exec(select(ExperimentDB).where(ExperimentDB.project_id == proj.id)).all()
        project_list.append(
            Project(
                id=proj.id,
                name=proj.name,
                paperIds=[l.paper_id for l in links],
                exps=[experiment_api(session, e) for e in exps],
                archived=proj.archived,
            )
        )

    return LabState(projects=project_list, papers=paper_list, rev=rev)


def changes_since(session: Session, since: int) -> Dict[str, Any]:
    """Records changed after rev `since`, and deletes, for a window or phone catching up."""
    rev = current_rev(session)  # first, as in get_lab_state
    projects = session.exec(select(ProjectDB).where(ProjectDB.rev > since)).all()
    exps = session.exec(select(ExperimentDB).where(ExperimentDB.rev > since)).all()
    tombs = session.exec(select(TombstoneDB).where(TombstoneDB.rev > since)).all()
    return {
        "rev": rev,
        "projects": [{
            "id": p.id, "name": p.name, "archived": p.archived, "rev": p.rev,
            "paperIds": list(session.exec(select(ProjectPaperLinkDB.paper_id)
                                          .where(ProjectPaperLinkDB.project_id == p.id)).all()),
        } for p in projects],
        "experiments": [{**experiment_api(session, e).model_dump(), "projectId": e.project_id, "rev": e.rev}
                        for e in exps],
        "deleted": [{"kind": t.kind, "id": t.id, "rev": t.rev} for t in tombs],
    }


def save_lab_state(session: Session, state: LabState) -> None:
    """Write the window's whole state.

    A merge-aware window (state.since set) only writes the experiments it sends a base for, merges
    each against the stored row field by field (its own edits win; what it overwrote is parked in
    sync_conflicts), and never deletes a record changed after `since` - it has not seen it.
    Without `since` (imports, seeding, older callers) the state replaces the notebook, as before.
    """
    with WRITE_LOCK:
        desktop_id = get_device_id(session)
        _save_lab_state(session, state, desktop_id)


def _save_lab_state(session: Session, state: LabState, desktop_id: str) -> None:
    merge_aware = state.since is not None
    bases = state.bases or {}

    # 1. Synchronize Papers
    incoming_paper_ids = set()
    for paper in state.papers:
        incoming_paper_ids.add(paper.id)
        db_paper = session.get(PaperDB, paper.id)
        if db_paper:
            db_paper.name = paper.name
            db_paper.color = paper.color
            db_paper.archived = bool(paper.archived)
        else:
            db_paper = PaperDB(
                id=paper.id,
                name=paper.name,
                color=paper.color,
                archived=bool(paper.archived),
            )
            session.add(db_paper)

    # Delete papers not present in incoming state
    all_papers = session.exec(select(PaperDB)).all()
    for p in all_papers:
        if p.id not in incoming_paper_ids:
            session.delete(p)

    # 2. Synchronize Projects, Project Papers, Experiments, Dependencies
    incoming_project_ids = set()
    incoming_exp_ids = set()

    for proj in state.projects:
        incoming_project_ids.add(proj.id)
        db_proj = session.get(ProjectDB, proj.id)
        if db_proj:
            db_proj.name = proj.name
            db_proj.archived = bool(proj.archived)
        else:
            db_proj = ProjectDB(
                id=proj.id,
                name=proj.name,
                archived=bool(proj.archived),
            )
            session.add(db_proj)
        if content_changed(db_proj):
            db_proj.device_id = desktop_id

        # Sync Paper Links
        session.exec(
            delete(ProjectPaperLinkDB).where(ProjectPaperLinkDB.project_id == proj.id)
        )
        for pid in proj.paperIds:
            session.add(ProjectPaperLinkDB(project_id=proj.id, paper_id=pid))

        # Sync Experiments
        for exp in proj.exps:
            incoming_exp_ids.add(exp.id)
            incoming = exp.model_dump()
            db_exp = session.get(ExperimentDB, exp.id)
            if db_exp is None:
                db_exp = ExperimentDB(id=exp.id, project_id=proj.id, name=exp.name, device_id=desktop_id)
                apply_exp_dict(db_exp, incoming)
                session.add(db_exp)
                _set_deps(session, exp.id, incoming["deps"])
                continue
            db_exp.project_id = proj.id
            if merge_aware and exp.id not in bases:
                continue  # not edited in the window: its copy may be stale, so it is not written
            if merge_aware:
                current = experiment_api(session, db_exp).model_dump()
                merged, conflicts = merge_experiment(
                    bases[exp.id].model_dump(), current, incoming,
                    incoming_wins_text=True, incoming_wins_other=True)
                incoming = canonical(merged)
                other = "desktop" if db_exp.device_id in ("", desktop_id) else "phone"
                for conflict in conflicts:
                    record_conflict(session, exp.id, conflict, source=other, device_id=db_exp.device_id)
            apply_exp_dict(db_exp, incoming)
            if content_changed(db_exp):
                db_exp.device_id = desktop_id
            _set_deps(session, exp.id, incoming["deps"])

    # Clean up experiments removed from state
    kept_project_ids = set()
    for e in session.exec(select(ExperimentDB)).all():
        if e.id in incoming_exp_ids:
            continue
        if merge_aware and e.rev > state.since:
            kept_project_ids.add(e.project_id)  # created or changed since the window last synced
            continue
        session.exec(
            delete(ExperimentDependencyDB).where(
                (ExperimentDependencyDB.experiment_id == e.id)
                | (ExperimentDependencyDB.depends_on_id == e.id)
            )
        )
        session.delete(e)

    # Clean up projects removed from state
    for pr in session.exec(select(ProjectDB)).all():
        if pr.id in incoming_project_ids or pr.id in kept_project_ids:
            continue
        if merge_aware and pr.rev > state.since:
            continue
        session.exec(
            delete(ProjectPaperLinkDB).where(
                ProjectPaperLinkDB.project_id == pr.id
            )
        )
        session.delete(pr)

    session.commit()


def reset_lab_state(session: Session, default_data: Dict[str, Any]):
    session.exec(delete(ExperimentDependencyDB))
    session.exec(delete(ProjectPaperLinkDB))
    session.exec(delete(PaperDB))
    # one by one, not a bulk delete: each gets a tombstone, so a paired phone drops it too
    for model in (ExperimentDB, ProjectDB):
        for row in session.exec(select(model)).all():
            session.delete(row)
        session.flush()
    session.commit()

    state = LabState(**default_data)
    save_lab_state(session, state)


def init_data_if_empty(session: Session, json_path: Path, default_data: Dict[str, Any]):
    existing = session.exec(select(ProjectDB)).first()
    if existing:
        return  # Database already populated

    # Check if existing json file has user data to import
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            state = LabState(**data)
            save_lab_state(session, state)
            print("[INFO] Successfully imported existing lab_state.json into SQLite database.")
            return
        except Exception as e:
            print(f"[WARN] Failed to import lab_state.json: {e}")

    # Fallback to default state
    state = LabState(**default_data)
    save_lab_state(session, state)
    print("[INFO] Initialized SQLite database with default seed state.")
