from typing import List, Optional, Union, Literal, Dict, Any
from pydantic import BaseModel, Field, field_validator

STANDARD_SECTIONS = {
    "purpose", "expectedResults", "experimentalDesign", "experimentalProtocol",
    "dataAcquisition", "dataAnalysis", "results", "notes",
}
STANDARD_PHASES = {"experimentalProtocol", "dataAcquisition", "dataAnalysis"}

class SectionAttachment(BaseModel):
    # Unassigned legacy blocks continue to belong to Results.
    section: Optional[str] = None
    phase: Optional[str] = None

    @field_validator("section")
    @classmethod
    def validate_section(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v in STANDARD_SECTIONS or v.startswith("phase_") or v.startswith("custom_"):
            return v
        raise ValueError(f"Invalid section: {v}")

    @field_validator("phase")
    @classmethod
    def validate_phase(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v in STANDARD_PHASES or v.startswith("phase_") or v.startswith("custom_"):
            return v
        raise ValueError(f"Invalid phase: {v}")

class TextBlock(SectionAttachment):
    type: Literal["txt"] = "txt"
    name: Optional[str] = None
    text: str = ""

class ImageBlock(SectionAttachment):
    type: Literal["img"] = "img"
    name: str = "Image"
    src: str
    preview_url: Optional[str] = None
    raw_url: Optional[str] = None
    format: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class TableBlock(SectionAttachment):
    type: Literal["tbl"] = "tbl"
    name: str = "Data Table"
    rows: List[List[str]] = []
    src: Optional[str] = None

class FileBlock(SectionAttachment):
    type: Literal["file"] = "file"
    name: str
    src: str
    mimeType: str = "application/octet-stream"
    size: int = Field(default=0, ge=0)

Block = Union[TextBlock, ImageBlock, TableBlock, FileBlock]

class CustomPhase(BaseModel):
    id: str
    name: str
    content: Optional[str] = ""
    duration: Optional[str] = ""
    completed: Optional[bool] = False
    startDate: Optional[str] = ""
    endDate: Optional[str] = ""
    color: Optional[str] = None

class Experiment(BaseModel):
    id: str
    name: str
    status: str = "Planned"
    priority: Optional[str] = ""
    paper: Optional[str] = ""
    deps: List[str] = []
    purpose: Optional[str] = ""
    expectedResults: Optional[str] = ""
    experimentalDesign: Optional[str] = ""
    experimentalProtocol: Optional[str] = ""
    experimentalProtocolDuration: Optional[str] = ""
    experimentalProtocolCompleted: Optional[bool] = False
    experimentalProtocolStartDate: Optional[str] = ""
    experimentalProtocolEndDate: Optional[str] = ""
    dataAcquisition: Optional[str] = ""
    dataAcquisitionDuration: Optional[str] = ""
    dataAcquisitionCompleted: Optional[bool] = False
    dataAcquisitionStartDate: Optional[str] = ""
    dataAcquisitionEndDate: Optional[str] = ""
    dataAnalysis: Optional[str] = ""
    dataAnalysisDuration: Optional[str] = ""
    dataAnalysisCompleted: Optional[bool] = False
    dataAnalysisStartDate: Optional[str] = ""
    dataAnalysisEndDate: Optional[str] = ""
    results: Optional[str] = ""
    notes: Optional[str] = ""
    phases: Optional[List[str]] = None
    customPhases: Optional[List[CustomPhase]] = None
    blocks: List[Block] = []
    px: Optional[float] = None
    py: Optional[float] = None

class Paper(BaseModel):
    id: str
    name: str
    color: str
    archived: Optional[bool] = False

class Project(BaseModel):
    id: str
    name: str
    paperIds: List[str] = Field(default_factory=list)
    exps: List[Experiment] = Field(default_factory=list)
    archived: Optional[bool] = False

class LabState(BaseModel):
    projects: List[Project] = []
    papers: List[Paper] = []

class UploadResponse(BaseModel):
    filename: str
    url: str
    preview_url: Optional[str] = None
    raw_url: Optional[str] = None
    content_type: str
    size: int
    metadata: Optional[Dict[str, Any]] = None
