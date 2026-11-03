import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from sqlmodel import Session, select, delete

from app.models import (
    ProjectDB,
    PaperDB,
    ProjectPaperLinkDB,
    ExperimentDB,
    ExperimentDependencyDB,
    SettingDB,
)
from app.schemas import LabState, Project, Paper, Experiment

def normalize_phases(phases: Optional[List[str]]) -> Optional[List[str]]:
    if phases is None:
        return None
    mapping = {
        "Protocol": "experimentalProtocol",
        "Acquisition": "dataAcquisition",
        "Analysis": "dataAnalysis",
    }
    return [mapping.get(p, p) for p in phases]

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

def get_lab_state(session: Session) -> LabState:
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

    projects = session.exec(select(ProjectDB)).all()
    project_list = []

    for proj in projects:
        # Paper IDs associated with this project
        links = session.exec(
            select(ProjectPaperLinkDB).where(ProjectPaperLinkDB.project_id == proj.id)
        ).all()
        paper_ids = [l.paper_id for l in links]

        # Experiments in this project
        exps = session.exec(
            select(ExperimentDB).where(ExperimentDB.project_id == proj.id)
        ).all()
        exp_list = []
        for e in exps:
            deps = session.exec(
                select(ExperimentDependencyDB.depends_on_id).where(
                    ExperimentDependencyDB.experiment_id == e.id
                )
            ).all()

            exp_list.append(
                Experiment(
                    id=e.id,
                    name=e.name,
                    status=e.status,
                    priority=e.priority or "",
                    paper=e.paper or "",
                    deps=list(deps),
                    purpose=getattr(e, "purpose", "") or "",
                    expectedResults=getattr(e, "expected_results", "") or "",
                    experimentalDesign=getattr(e, "experimental_design", "") or "",
                    experimentalProtocol=getattr(e, "experimental_protocol", "") or "",
                    experimentalProtocolDuration=getattr(e, "experimental_protocol_duration", "") or "",
                    experimentalProtocolCompleted=bool(getattr(e, "experimental_protocol_completed", False)),
                    experimentalProtocolStartDate=getattr(e, "experimental_protocol_start_date", "") or "",
                    experimentalProtocolEndDate=getattr(e, "experimental_protocol_end_date", "") or "",
                    dataAcquisition=getattr(e, "data_acquisition", "") or "",
                    dataAcquisitionDuration=getattr(e, "data_acquisition_duration", "") or "",
                    dataAcquisitionCompleted=bool(getattr(e, "data_acquisition_completed", False)),
                    dataAcquisitionStartDate=getattr(e, "data_acquisition_start_date", "") or "",
                    dataAcquisitionEndDate=getattr(e, "data_acquisition_end_date", "") or "",
                    dataAnalysis=getattr(e, "data_analysis", "") or "",
                    dataAnalysisDuration=getattr(e, "data_analysis_duration", "") or "",
                    dataAnalysisCompleted=bool(getattr(e, "data_analysis_completed", False)),
                    dataAnalysisStartDate=getattr(e, "data_analysis_start_date", "") or "",
                    dataAnalysisEndDate=getattr(e, "data_analysis_end_date", "") or "",
                    results=getattr(e, "results", "") or "",
                    notes=e.notes or "",
                    phases=normalize_phases(getattr(e, "phases", None)),
                    customPhases=getattr(e, "custom_phases", None),
                    blocks=e.blocks or [],
                    px=e.px,
                    py=e.py,
                )
            )

        project_list.append(
            Project(
                id=proj.id,
                name=proj.name,
                paperIds=paper_ids,
                exps=exp_list,
                archived=proj.archived,
            )
        )

    return LabState(projects=project_list, papers=paper_list)


def save_lab_state(session: Session, state: LabState):
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
            db_proj.updated_at = datetime.now(timezone.utc)
        else:
            db_proj = ProjectDB(
                id=proj.id,
                name=proj.name,
                archived=bool(proj.archived),
            )
            session.add(db_proj)

        # Sync Paper Links
        session.exec(
            delete(ProjectPaperLinkDB).where(ProjectPaperLinkDB.project_id == proj.id)
        )
        for pid in proj.paperIds:
            session.add(ProjectPaperLinkDB(project_id=proj.id, paper_id=pid))

        # Sync Experiments
        for exp in proj.exps:
            incoming_exp_ids.add(exp.id)
            blocks_dump = [
                b.model_dump() if hasattr(b, "model_dump") else (b if isinstance(b, dict) else dict(b))
                for b in exp.blocks
            ]
            custom_phases_dump = [
                cp.model_dump() if hasattr(cp, "model_dump") else (cp if isinstance(cp, dict) else dict(cp))
                for cp in exp.customPhases
            ] if exp.customPhases is not None else None
            db_exp = session.get(ExperimentDB, exp.id)
            if db_exp:
                db_exp.project_id = proj.id
                db_exp.name = exp.name
                db_exp.status = exp.status
                db_exp.priority = exp.priority or ""
                db_exp.paper = exp.paper or ""
                db_exp.purpose = exp.purpose or ""
                db_exp.expected_results = exp.expectedResults or ""
                db_exp.experimental_design = exp.experimentalDesign or ""
                db_exp.experimental_protocol = exp.experimentalProtocol or ""
                db_exp.experimental_protocol_duration = exp.experimentalProtocolDuration or ""
                db_exp.experimental_protocol_completed = bool(exp.experimentalProtocolCompleted)
                db_exp.experimental_protocol_start_date = exp.experimentalProtocolStartDate or ""
                db_exp.experimental_protocol_end_date = exp.experimentalProtocolEndDate or ""
                db_exp.data_acquisition = exp.dataAcquisition or ""
                db_exp.data_acquisition_duration = exp.dataAcquisitionDuration or ""
                db_exp.data_acquisition_completed = bool(exp.dataAcquisitionCompleted)
                db_exp.data_acquisition_start_date = exp.dataAcquisitionStartDate or ""
                db_exp.data_acquisition_end_date = exp.dataAcquisitionEndDate or ""
                db_exp.data_analysis = exp.dataAnalysis or ""
                db_exp.data_analysis_duration = exp.dataAnalysisDuration or ""
                db_exp.data_analysis_completed = bool(exp.dataAnalysisCompleted)
                db_exp.data_analysis_start_date = exp.dataAnalysisStartDate or ""
                db_exp.data_analysis_end_date = exp.dataAnalysisEndDate or ""
                db_exp.results = exp.results or ""
                db_exp.notes = exp.notes or ""
                db_exp.phases = normalize_phases(exp.phases)
                db_exp.custom_phases = custom_phases_dump
                db_exp.blocks = blocks_dump
                db_exp.px = exp.px
                db_exp.py = exp.py
                db_exp.updated_at = datetime.now(timezone.utc)
            else:
                db_exp = ExperimentDB(
                    id=exp.id,
                    project_id=proj.id,
                    name=exp.name,
                    status=exp.status,
                    priority=exp.priority or "",
                    paper=exp.paper or "",
                    purpose=exp.purpose or "",
                    expected_results=exp.expectedResults or "",
                    experimental_design=exp.experimentalDesign or "",
                    experimental_protocol=exp.experimentalProtocol or "",
                    experimental_protocol_duration=exp.experimentalProtocolDuration or "",
                    experimental_protocol_completed=bool(exp.experimentalProtocolCompleted),
                    experimental_protocol_start_date=exp.experimentalProtocolStartDate or "",
                    experimental_protocol_end_date=exp.experimentalProtocolEndDate or "",
                    data_acquisition=exp.dataAcquisition or "",
                    data_acquisition_duration=exp.dataAcquisitionDuration or "",
                    data_acquisition_completed=bool(exp.dataAcquisitionCompleted),
                    data_acquisition_start_date=exp.dataAcquisitionStartDate or "",
                    data_acquisition_end_date=exp.dataAcquisitionEndDate or "",
                    data_analysis=exp.dataAnalysis or "",
                    data_analysis_duration=exp.dataAnalysisDuration or "",
                    data_analysis_completed=bool(exp.dataAnalysisCompleted),
                    data_analysis_start_date=exp.dataAnalysisStartDate or "",
                    data_analysis_end_date=exp.dataAnalysisEndDate or "",
                    results=exp.results or "",
                    notes=exp.notes or "",
                    phases=normalize_phases(exp.phases),
                    custom_phases=custom_phases_dump,
                    blocks=blocks_dump,
                    px=exp.px,
                    py=exp.py,
                )
                session.add(db_exp)

            # Sync Dependencies
            session.exec(
                delete(ExperimentDependencyDB).where(
                    ExperimentDependencyDB.experiment_id == exp.id
                )
            )
            for dep_id in exp.deps:
                session.add(
                    ExperimentDependencyDB(
                        experiment_id=exp.id,
                        depends_on_id=dep_id
                    )
                )

    # Clean up experiments removed from state
    all_exps = session.exec(select(ExperimentDB)).all()
    for e in all_exps:
        if e.id not in incoming_exp_ids:
            session.exec(
                delete(ExperimentDependencyDB).where(
                    (ExperimentDependencyDB.experiment_id == e.id)
                    | (ExperimentDependencyDB.depends_on_id == e.id)
                )
            )
            session.delete(e)

    # Clean up projects removed from state
    all_projs = session.exec(select(ProjectDB)).all()
    for pr in all_projs:
        if pr.id not in incoming_project_ids:
            session.exec(
                delete(ProjectPaperLinkDB).where(
                    ProjectPaperLinkDB.project_id == pr.id
                )
            )
            session.delete(pr)

    session.commit()


def reset_lab_state(session: Session, default_data: Dict[str, Any]):
    session.exec(delete(ExperimentDependencyDB))
    session.exec(delete(ExperimentDB))
    session.exec(delete(ProjectPaperLinkDB))
    session.exec(delete(ProjectDB))
    session.exec(delete(PaperDB))
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
