from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON

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
    px: Optional[float] = Field(default=None)
    py: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

class ExperimentDependencyDB(SQLModel, table=True):
    __tablename__ = "experiment_dependencies"
    experiment_id: str = Field(foreign_key="experiments.id", primary_key=True)
    depends_on_id: str = Field(primary_key=True)

class SettingDB(SQLModel, table=True):
    __tablename__ = "settings"
    key: str = Field(primary_key=True)
    value: str = Field(default="")
