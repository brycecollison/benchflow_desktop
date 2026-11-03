"""Tests for the read-only Benchflow MCP server.

Run:  cd backend && ~/.venvs/lab-planner-eln/Scripts/python.exe test_mcp.py
Single case:  ~/.venvs/lab-planner-eln/Scripts/python.exe test_mcp.py MCPProtocolTest.test_stdio_round_trip

The fixture notebook is a temporary SQLite file built from app.models, so these tests
never touch backend/data/benchflow.db.
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import anyio
from sqlmodel import Session, SQLModel, create_engine

from app import notebook_queries
from app.models import (
    ExperimentDB,
    ExperimentDependencyDB,
    PaperDB,
    ProjectDB,
    ProjectPaperLinkDB,
)

BACKEND = Path(__file__).resolve().parent
SERVER = BACKEND / "mcp_server.py"
LONG_TEXT = "buffer recipe with 20 mM HEPES " * 200  # > MAX_SECTION_CHARS, no search term

# term "electroporation" is spread over records so ranking, filters and pagination are all exercised
FIXTURE_EXPERIMENTS = [
    dict(id="exp-name", project_id="proj-active", name="Electroporation of HEK293T", status="Done",
         purpose="Measure editing efficiency", results="Observed 42.8% indel at the NIPBL locus."),
    dict(id="exp-protocol", project_id="proj-active", name="Neon pulse settings", status="Done",
         experimental_protocol="Electroporation at 1150V for 20 ms, 2 pulses."),
    dict(id="exp-expected", project_id="proj-active", name="Prediction only", status="Planned",
         expected_results="Expect ~50% editing from electroporation."),
    dict(id="exp-planned", project_id="proj-active", name="Scheduled acquisition", status="Running",
         data_acquisition="Confocal z-stack", data_acquisition_duration="2026-03-01 10:00 to 2026-03-01 16:00",
         data_acquisition_start_date="2026-03-01", data_acquisition_end_date="2026-03-01",
         data_acquisition_completed=False),
    dict(id="exp-removed", project_id="proj-active", name="Removed phase record", status="Done",
         phases=["experimentalProtocol"], experimental_protocol="Permit the electroporation step.",
         data_acquisition="Removed acquisition note about cohesin washout"),
    dict(id="exp-custom", project_id="proj-active", name="Custom phase record", status="Done",
         phases=["experimentalProtocol", "phase_stain"], experimental_protocol="Plate cells.",
         custom_phases=[{"id": "phase_stain", "name": "Staining", "content": "Antibody incubation 30 min",
                         "completed": False, "duration": "30 min"}]),
    dict(id="exp-legacy", project_id="proj-active", name="Legacy blocks", status="Done",
         results="Gel documented.",
         blocks=[{"type": "img", "name": "old gel.png", "src": "/uploads/legacy.png", "size": 1234}]),
    dict(id="exp-tables", project_id="proj-active", name="Table content", status="Done",
         blocks=[{"type": "tbl", "name": "gels", "section": "results",
                  "rows": [["Sample", "Indel %"], ["G1", "42.8"]]}]),
    dict(id="exp-meta", project_id="proj-active", name="Microscopy metadata", status="Done",
         phases=["dataAcquisition"],
         blocks=[{"type": "img", "name": "crop.nd2", "src": "/uploads/crop.nd2", "section": "dataAcquisition",
                  "phase": "dataAcquisition", "mimeType": "image/x-nikon-nd2", "size": 1043, "format": "ND2",
                  "metadata": {"channels": 2, "exposure": "120 ms"}}]),
    dict(id="exp-empty", project_id="proj-active", name="Nothing written", status="Planned"),
    dict(id="exp-long", project_id="proj-active", name="Long notes", status="Done", purpose=LONG_TEXT),
    dict(id="exp-literal", project_id="proj-active", name="Literal terms", status="Done",
         purpose="神经元 imaging %_like_this with [brackets] and 'quotes'"),
    dict(id="exp-archived", project_id="proj-archived", name="Archived electroporation", status="Done",
         results="Old electroporation note."),
]


def make_fixture(db_file: Path) -> None:
    engine = create_engine(f"sqlite:///{db_file}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(PaperDB(id="paper-1", name="Cohesin homeostasis paper"))
        session.add(ProjectDB(id="proj-active", name="NIPBL Project"))
        session.add(ProjectDB(id="proj-archived", name="Retired Project", archived=True))
        session.add(ProjectPaperLinkDB(project_id="proj-active", paper_id="paper-1"))
        for exp in FIXTURE_EXPERIMENTS:
            session.add(ExperimentDB(**exp))
        session.add(ExperimentDependencyDB(experiment_id="exp-name", depends_on_id="exp-legacy"))
        session.commit()


def hits(payload: dict) -> list[str]:
    return [hit["experiment_id"] for hit in payload["hits"]]


class QueryTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.db = cls.tmp / "fixture.db"
        make_fixture(cls.db)

    def search(self, query, **kwargs):
        return notebook_queries.search_experiments(self.db, query, **kwargs)

    def get(self, experiment_id, sections=None):
        return notebook_queries.get_experiment(self.db, experiment_id, sections)

    # ---- discovery ---------------------------------------------------------
    def test_list_projects_paginates_and_hides_archived(self):
        page = notebook_queries.list_projects(self.db)
        self.assertEqual([p["name"] for p in page["projects"]], ["NIPBL Project"])
        self.assertEqual(page["projects"][0]["experiment_count"], len(FIXTURE_EXPERIMENTS) - 1)
        all_projects = notebook_queries.list_projects(self.db, include_archived=True, limit=50)
        self.assertIn("Retired Project", [p["name"] for p in all_projects["projects"]])
        two = notebook_queries.list_projects(self.db, include_archived=True, limit=1, offset=0)
        self.assertEqual((two["limit"], two["next_offset"], len(two["projects"])), (1, 1, 1))
        self.assertEqual(two["total"], 2)

    def test_project_scoping_lists_experiments_with_content(self):
        payload = notebook_queries.list_project_experiments(self.db, "proj-active", limit=50)
        by_id = {e["id"]: e for e in payload["experiments"]}
        self.assertEqual(payload["total"], len(FIXTURE_EXPERIMENTS) - 1)
        self.assertEqual(by_id["exp-tables"]["sections_with_content"], ["results"])
        self.assertEqual(by_id["exp-empty"]["sections_with_content"], [])
        self.assertIn("dataAcquisition", by_id["exp-meta"]["sections_with_content"])
        with self.assertRaises(LookupError):
            notebook_queries.list_project_experiments(self.db, "nope")

    # ---- search ------------------------------------------------------------
    def test_search_prefers_name_over_other_sections(self):
        result = self.search("electroporation", limit=50)
        self.assertEqual(hits(result)[0], "exp-name")
        self.assertIn("exp-protocol", hits(result))
        self.assertIn("exp-expected", hits(result))

    def test_search_requires_every_term(self):
        self.assertEqual(hits(self.search("electroporation 42.8")), ["exp-name"])
        self.assertEqual(hits(self.search("electroporation zzznope")), [])

    def test_search_is_literal_not_sql_like_or_glob(self):
        self.assertEqual(hits(self.search("%_like_this")), ["exp-literal"])
        self.assertEqual(hits(self.search("[brackets]")), ["exp-literal"])
        self.assertEqual(hits(self.search("神经元")), ["exp-literal"])
        self.assertEqual(hits(self.search("Z%")), [], "SQL LIKE wildcard must not match everything")
        self.assertEqual(hits(self.search("%d")), [], "a LIKE pattern must not behave as contains-any")

    def test_search_covers_markdown_tables_and_attachment_metadata(self):
        self.assertEqual(hits(self.search("Sample")), ["exp-tables"])       # table header
        self.assertEqual(hits(self.search("G1")), ["exp-tables"])          # table cell
        self.assertEqual(hits(self.search("exposure")), ["exp-meta"])  # attachment scientific metadata
        self.assertEqual(hits(self.search("crop.nd2")), ["exp-meta"])

    def test_search_skips_content_of_removed_phases(self):
        self.assertEqual(hits(self.search("cohesin washout")), [])
        self.assertEqual(hits(self.search("cohesin washout", sections=["dataAcquisition"])), [])
        self.assertEqual(hits(self.search("Removed acquisition note", include_archived=True)), [])

    def test_search_filters_by_project_status_and_sections(self):
        self.assertEqual(hits(self.search("electroporation", project_id="proj-active", limit=50)),
                         hits(self.search("electroporation", limit=50)))
        self.assertEqual(hits(self.search("electroporation", project_id="proj-archived")), [])
        self.assertEqual(hits(self.search("electroporation", status="planned")), ["exp-expected"])
        # `sections` limits section content only; experiment-name matching always applies.
        self.assertEqual([m["section"] for h in self.search("electroporation", sections=["results"])["hits"]
                          for m in h["matches"]], ["name"])
        self.assertEqual(hits(self.search("electroporation", sections=["expectedResults"])),
                         ["exp-name", "exp-expected"])

    def test_search_excludes_archived_unless_requested(self):
        self.assertNotIn("exp-archived", hits(self.search("electroporation", limit=50)))
        self.assertIn("exp-archived", hits(self.search("electroporation", include_archived=True, limit=50)))

    def test_search_pagination_reports_more_results(self):
        first = self.search("electroporation", limit=2, offset=0)
        second = self.search("electroporation", limit=2, offset=2)
        self.assertEqual(len(first["hits"]), 2)
        self.assertEqual(first["next_offset"], 2)
        self.assertTrue(first["truncated"])
        self.assertEqual({h["experiment_id"] for h in first["hits"]} & {h["experiment_id"] for h in second["hits"]}, set())
        self.assertTrue(first["total_matches"] > 2)

    def test_search_reports_matched_section_and_ref(self):
        hit = next(h for h in self.search("1150V", limit=50)["hits"] if h["experiment_id"] == "exp-protocol")
        self.assertEqual([m["section"] for m in hit["matches"]], ["experimentalProtocol"])
        self.assertTrue(hit["matches"][0]["ref"].startswith("benchflow://experiments/exp-protocol/sections/"))
        self.assertIn("1150V", hit["matches"][0]["snippet"])

    def test_search_rejects_empty_query_and_unknown_section(self):
        with self.assertRaises(ValueError):
            self.search("   ")
        with self.assertRaisesRegex(ValueError, "purpose"):
            self.search("electroporation", sections=["purpose", "bogus"])

    # ---- retrieval ---------------------------------------------------------
    def test_retrieval_returns_sections_with_refs(self):
        record = self.get("exp-name")
        sections = {s["key"]: s for s in record["sections"]}
        self.assertEqual(sections["results"]["text"], "Observed 42.8% indel at the NIPBL locus.")
        self.assertEqual(sections["results"]["ref"], "benchflow://experiments/exp-name/sections/results")
        self.assertEqual(record["project_name"], "NIPBL Project")
        self.assertEqual(record["papers"], ["Cohesin homeostasis paper"])

    def test_retrieval_labels_expected_results_as_prediction(self):
        record = self.get("exp-expected")
        self.assertIn("expectedResults", {s["key"] for s in record["sections"]})
        self.assertTrue(any("Expected Results" in note and "prediction" in note for note in record["notes_on_scope"]))

    def test_retrieval_reports_plans_as_recorded_not_as_done(self):
        record = self.get("exp-planned")
        phase = next(s for s in record["sections"] if s["key"] == "dataAcquisition")
        self.assertEqual(phase["phase"]["duration"], "2026-03-01 10:00 to 2026-03-01 16:00")
        self.assertEqual(phase["phase"]["start_date"], "2026-03-01")
        self.assertFalse(phase["phase"]["completed"])
        self.assertIn("dataAcquisition", record["included_phases"])
        self.assertTrue(any("plan" in note and "not evidence" in note for note in record["notes_on_scope"]))

    def test_retrieval_reports_empty_sections_as_missing(self):
        record = self.get("exp-empty")
        self.assertEqual(record["sections"], [])
        self.assertIn("results", record["missing_sections"])
        self.assertIn("experimentalProtocol", record["missing_sections"])

    def test_retrieval_marks_removed_phase_as_excluded(self):
        record = self.get("exp-removed")
        self.assertIn("dataAcquisition", record["excluded_phases"])
        removed = next(s for s in record["sections"] if s["key"] == "dataAcquisition")
        self.assertFalse(removed["included"])
        self.assertIn("experimentalProtocol", record["included_phases"])

    def test_retrieval_includes_custom_phases_and_labels(self):
        record = self.get("exp-custom")
        custom = next(s for s in record["sections"] if s["key"] == "phase_stain")
        self.assertEqual(custom["label"], "Staining")
        self.assertIn("Antibody incubation", custom["text"])
        self.assertEqual(custom["phase"]["duration"], "30 min")
        self.assertIn("phase_stain", record["included_phases"])

    def test_retrieval_attributes_legacy_and_phase_attachments(self):
        legacy = {s["key"]: s for s in self.get("exp-legacy")["sections"]}
        self.assertEqual([b["name"] for b in legacy["results"]["blocks"]], ["old gel.png"])
        self.assertEqual(legacy["results"]["blocks"][0]["ref"],
                         "benchflow://experiments/exp-legacy/sections/results#block-0")
        meta = next(s for s in self.get("exp-meta")["sections"] if s["key"] == "dataAcquisition")
        block = meta["blocks"][0]
        self.assertEqual(block["metadata"], {"channels": 2, "exposure": "120 ms"})
        self.assertEqual(block["format"], "ND2")
        for forbidden in ("src", "path", "file", "content", "data", "base64"):
            self.assertNotIn(forbidden, block, f"attachment {forbidden} must not be exposed")
        self.assertEqual(block["app_url"], "/uploads/crop.nd2")

    def test_retrieval_reports_dependencies_ids_and_names(self):
        self.assertEqual(self.get("exp-name")["dependencies"]["depends_on"], [{"id": "exp-legacy", "name": "Legacy blocks"}])
        self.assertEqual(self.get("exp-legacy")["dependencies"]["depended_by"], [{"id": "exp-name", "name": "Electroporation of HEK293T"}])

    def test_retrieval_reports_record_and_retrieval_time(self):
        record = self.get("exp-legacy")
        self.assertTrue(record["updated_at"])
        self.assertRegex(record["retrieved_at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_retrieval_truncates_long_sections_and_caps_page_size(self):
        record = self.get("exp-long")
        purpose = next(s for s in record["sections"] if s["key"] == "purpose")
        self.assertEqual(len(purpose["text"]), notebook_queries.MAX_SECTION_CHARS)
        self.assertTrue(purpose["truncated"])
        self.assertLessEqual(self.search("electroporation", limit=999)["limit"], notebook_queries.MAX_PAGE_SIZE)

    def test_retrieval_narrows_sections_and_rejects_unknown_names(self):
        record = self.get("exp-custom", sections=["experimentalProtocol"])
        self.assertEqual([s["key"] for s in record["sections"]], ["experimentalProtocol"])
        with self.assertRaisesRegex(ValueError, "phase_stain"):
            self.get("exp-custom", sections=["nope"])

    def test_retrieval_missing_record_is_a_clear_error(self):
        with self.assertRaisesRegex(LookupError, "search_experiments"):
            self.get("does-not-exist")

    def test_section_resource_reader(self):
        section = notebook_queries.get_section(self.db, "exp-custom", "phase_stain")["section"]
        self.assertEqual(section["label"], "Staining")
        with self.assertRaisesRegex(LookupError, "not documented"):
            notebook_queries.get_section(self.db, "exp-empty", "results")

    # ---- read-only guarantees ---------------------------------------------
    def test_connections_are_read_only(self):
        conn = notebook_queries.connect(self.db)
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("UPDATE experiments SET name = 'hacked'")
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("INSERT INTO projects (id, name) VALUES ('x', 'y')")
        conn.close()

    def test_missing_database_is_reported_and_never_created(self):
        missing = self.tmp / "sub" / "nope.db"
        with self.assertRaisesRegex(FileNotFoundError, "BENCHFLOW_DB_PATH"):
            notebook_queries.search_experiments(missing, "electroporation")
        self.assertFalse(missing.exists())


class MCPProtocolTest(unittest.TestCase):
    """Spawns mcp_server.py over real stdio, the protocol requirement of the plan."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.db = cls.tmp / "protocol.db"
        make_fixture(cls.db)

    def test_stdio_round_trip(self):
        anyio.run(self._round_trip)

    async def _round_trip(self):
        from mcp.client.session import ClientSession
        from mcp.client.stdio import StdioServerParameters, stdio_client

        params = StdioServerParameters(
            command=sys.executable,
            args=[str(SERVER)],
            cwd=str(BACKEND),
            env={**os.environ, "BENCHFLOW_DB_PATH": str(self.db)},
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()

                tools = (await session.list_tools()).tools
                self.assertEqual({t.name for t in tools}, {"list_projects", "search_experiments", "get_experiment"})
                for tool in tools:
                    self.assertTrue(tool.annotations.read_only_hint, f"{tool.name} must be annotated read-only")
                    self.assertFalse(tool.annotations.destructive_hint)
                    self.assertTrue(tool.annotations.idempotent_hint)
                    self.assertFalse(tool.annotations.open_world_hint)

                resources = (await session.list_resources()).resources
                self.assertIn("benchflow://projects", [str(r.uri) for r in resources])
                templates = [str(t.uri_template) for t in (await session.list_resource_templates()).resource_templates]
                self.assertEqual(templates, [
                    "benchflow://projects/{project_id}",
                    "benchflow://experiments/{experiment_id}",
                    "benchflow://experiments/{experiment_id}/sections/{section_key}",
                ])
                for tool in tools:
                    self.assertTrue(tool.input_schema["type"] == "object", f"{tool.name} needs an input schema")

                listed = await session.call_tool("list_projects", {})
                self.assertFalse(listed.is_error)
                self.assertEqual(listed.structured_content["projects"][0]["name"], "NIPBL Project")

                found = await session.call_tool("search_experiments", {"query": "electroporation", "limit": 3})
                self.assertFalse(found.is_error)
                self.assertEqual(found.structured_content["hits"][0]["experiment_id"], "exp-name")
                self.assertTrue(found.structured_content["truncated"])

                record = await session.call_tool("get_experiment", {"experiment_id": "exp-removed"})
                self.assertFalse(record.is_error)
                self.assertIn("dataAcquisition", record.structured_content["excluded_phases"])

                failed = await session.call_tool("get_experiment", {"experiment_id": "nope"})
                self.assertTrue(failed.is_error, "an unknown record must come back as a tool error")

                for uri in ("benchflow://projects", "benchflow://projects/proj-active",
                            "benchflow://experiments/exp-custom", "benchflow://experiments/exp-custom/sections/phase_stain"):
                    contents = (await session.read_resource(uri)).contents
                    payload = json.loads(contents[0].text)
                    self.assertTrue(payload, f"{uri} returned no content")
                scoped = json.loads((await session.read_resource("benchflow://projects/proj-active")).contents[0].text)
                self.assertEqual(scoped["project_name"], "NIPBL Project")


if __name__ == "__main__":
    unittest.main(verbosity=2)
