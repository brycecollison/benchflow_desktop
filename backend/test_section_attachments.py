"""Run from the repo root: venv/Scripts/python.exe backend/test_section_attachments.py.
Uses an in-memory database; never opens the user's notebook database.
"""
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from pydantic import ValidationError
from sqlmodel import SQLModel, Session, create_engine
from app.schemas import LabState
from app.db_service import get_lab_state, save_lab_state


class SectionAttachmentTest(unittest.TestCase):
    def test_section_and_phase_round_trip(self):
        engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(engine)
        state = LabState.model_validate({"projects": [{"id": "p", "name": "Project", "exps": [{
            "id": "e", "name": "Experiment", "purpose": "## Rationale\n\n**Important** result",
            "blocks": [
                {"type": "img", "name": "legacy.png", "src": "/uploads/legacy.png"},
                {"type": "img", "name": "protocol.png", "src": "/uploads/protocol.png", "section": "experimentalProtocol", "phase": "experimentalProtocol", "metadata": {"channels": 2}},
                {"type": "file", "name": "reference.pdf", "src": "/uploads/reference.pdf", "mimeType": "application/pdf", "size": 123, "section": "purpose"},
                {"type": "tbl", "name": "data.csv", "src": "/uploads/data.csv", "rows": [["x", "y"], ["1", "2"]], "section": "dataAnalysis", "phase": "dataAnalysis"},
                {"type": "txt", "text": "Bench note", "section": "notes"},
            ],
        }]}], "papers": []})
        with Session(engine) as session:
            save_lab_state(session, state)
            restored = get_lab_state(session)
            exp = restored.projects[0].exps[0]
            self.assertEqual(exp.purpose, state.projects[0].exps[0].purpose)
            self.assertEqual([b.model_dump() for b in exp.blocks], [b.model_dump() for b in state.projects[0].exps[0].blocks])
            # A subsequent ordinary save must not strip ownership or file metadata.
            exp.notes = "Changed after upload"
            save_lab_state(session, restored)
            session.expire_all()
            again = get_lab_state(session).projects[0].exps[0]
            self.assertEqual(again.blocks[1].phase, "experimentalProtocol")
            self.assertEqual(again.blocks[2].mimeType, "application/pdf")
            self.assertEqual(again.blocks[3].src, "/uploads/data.csv")
            self.assertIsNone(again.blocks[0].section)
        engine.dispose()

    def test_uploads_keep_original_files_in_the_upload_directory(self):
        from fastapi.testclient import TestClient
        isolated_engine = create_engine('sqlite://')
        SQLModel.metadata.create_all(isolated_engine)
        # main also initializes on import; isolate that path as well as lifespan.
        with patch('app.database.engine', isolated_engine), patch('app.database.init_db'):
            from app import main
        client = TestClient(main.app)
        with tempfile.TemporaryDirectory() as directory, patch.object(main, "UPLOAD_DIR", Path(directory)):
            content = b"Sample,Value\nA,10"
            response = client.post("/api/lab/upload", files={"file": ("../measurements.csv", content, "text/csv")})
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result["filename"], "measurements.csv")
            self.assertEqual(result["size"], len(content))
            self.assertEqual(result["content_type"], "text/csv")
            uploaded = Path(directory) / result["raw_url"].rsplit("/", 1)[-1]
            self.assertEqual(uploaded.read_bytes(), content)
            from io import BytesIO
            from PIL import Image
            screenshot = BytesIO()
            Image.new('RGB', (32, 24), color='white').save(screenshot, format='PNG')
            response = client.post('/api/lab/upload', files={'file': ('image.png', screenshot.getvalue(), 'image/png')})
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result['content_type'], 'image/png')
            self.assertEqual(result['metadata']['width'], 32)
            self.assertEqual(result['metadata']['height'], 24)
            self.assertEqual((Path(directory) / result['raw_url'].rsplit('/', 1)[-1]).read_bytes(), screenshot.getvalue())
        client.close()
        isolated_engine.dispose()

    def test_invalid_section_is_rejected(self):
        with self.assertRaises(ValidationError):
            LabState.model_validate({"projects": [{"id": "p", "name": "P", "exps": [{
                "id": "e", "name": "E", "blocks": [{"type": "file", "name": "a", "src": "/uploads/a", "section": "typo"}],
            }]}]})

    def test_empty_phases_survive_save_and_reload(self):
        engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(engine)
        state = LabState.model_validate({"projects": [{"id": "p", "name": "Project", "exps": [
            {"id": "empty", "name": "No phases", "phases": []},
            {"id": "legacy", "name": "Legacy"},
        ]}]})
        with Session(engine) as session:
            save_lab_state(session, state)
            session.expire_all()
            restored = get_lab_state(session)
            self.assertEqual(restored.projects[0].exps[0].phases, [])
            self.assertIsNone(restored.projects[0].exps[1].phases)
            restored.projects[0].exps[0].notes = "An unrelated edit"
            save_lab_state(session, restored)
            session.expire_all()
            self.assertEqual(get_lab_state(session).projects[0].exps[0].phases, [])
        engine.dispose()

    def test_custom_phase_round_trip(self):
        engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(engine)
        custom_phase = {
            "id": "phase_staining",
            "name": "Tissue Staining",
            "content": "Perform antibody incubation",
            "duration": "2 days",
            "completed": True,
            "startDate": "2026-04-01",
            "endDate": "2026-04-02",
        }
        state = LabState.model_validate({"projects": [{"id": "p", "name": "Project", "exps": [{
            "id": "e",
            "name": "Experiment",
            "phases": ["experimentalProtocol", "phase_staining"],
            "customPhases": [custom_phase],
            "blocks": [
                {"type": "img", "name": "staining.png", "src": "/uploads/staining.png", "section": "phase_staining", "phase": "phase_staining"}
            ],
        }]}], "papers": []})
        with Session(engine) as session:
            save_lab_state(session, state)
            restored = get_lab_state(session)
            exp = restored.projects[0].exps[0]
            self.assertEqual(exp.phases, ["experimentalProtocol", "phase_staining"])
            self.assertIsNotNone(exp.customPhases)
            self.assertEqual(len(exp.customPhases), 1)
            self.assertEqual(exp.customPhases[0].name, "Tissue Staining")
            self.assertEqual(exp.customPhases[0].content, "Perform antibody incubation")
            self.assertTrue(exp.customPhases[0].completed)
            self.assertEqual(exp.blocks[0].section, "phase_staining")
            self.assertEqual(exp.blocks[0].phase, "phase_staining")
            exp.notes = "Unrelated edit after creating a custom phase"
            save_lab_state(session, restored)
            session.expire_all()
            self.assertEqual(get_lab_state(session).projects[0].exps[0].customPhases[0].name, "Tissue Staining")
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
