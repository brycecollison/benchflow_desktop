"""Self-checks for the SharePoint export/loader.

Runs standalone (no pytest needed):
    python tests/test_sharepoint_export.py
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

# Allow `python tests/test_sharepoint_export.py` from any cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, SQLModel, create_engine

from app.models import ExperimentDB, PaperDB, ProjectDB
from app.sharepoint_export import export, md_refs, refs_from_text, sanitize_member, sync_name
from app.sharepoint_loader import load


def test_md_refs_parens_and_titles():
    t = (
        'see [![img](/uploads/77f15e7fa527_HDAC8i neuronal enriched new '
        'drugs(Coomassie Blue)_preview.png "title")](#x) and '
        '[raw](/uploads/a(b).tif)'
    )
    refs = set(md_refs(t))
    assert "77f15e7fa527_HDAC8i neuronal enriched new drugs(Coomassie Blue)_preview.png" in refs
    assert "a(b).tif" in refs


def test_refs_escaped_quotes():
    # Escaped quotes as they appear in raw stored JSON text leave a
    # trailing backslash on the capture; _clean must strip it.
    raw = r'{"src": \"/uploads/abc123_image.tif\", \"preview_url\": \"/uploads/abc123_image_preview.png\"}'
    refs = refs_from_text(raw)
    assert refs == {"abc123_image.tif", "abc123_image_preview.png"}


def test_sync_name():
    used = {}
    a = sync_name('bad:name?"file".png', used)
    assert not any(c in a for c in ':*?"<>\\|/')
    long_name = "77f15e7fa527_HDAC8i neuronal enriched new drugs(Coomassie Blue)_preview" + ".png"
    b = sync_name(long_name, used)
    assert len(b.rsplit(".", 1)[0]) <= 45
    # Two originals sharing the first 40 chars must not collide.
    n1 = sync_name("A" * 60 + ".png", used)
    n2 = sync_name("A" * 55 + "BBBBB.png", used)
    assert n1 != n2
    assert used[n1] != used[n2]


def test_member_slug():
    assert sanitize_member("Bryce's Machine") == "bryce-s-machine"
    assert sanitize_member("///") == "member"


def test_setting_roundtrip():
    from app.db_service import get_setting, set_setting

    tmp = Path(tempfile.mkdtemp(prefix="benchflow_cfg_"))
    try:
        db = tmp / "benchflow.db"
        eng = create_engine(f"sqlite:///{db}")
        SQLModel.metadata.create_all(eng)
        with Session(eng) as s:
            assert get_setting(s, "sharepoint_dir") is None
            set_setting(s, "sharepoint_dir", "C:\\OneDrive\\BENCHFLOW")
            assert get_setting(s, "sharepoint_dir") == "C:\\OneDrive\\BENCHFLOW"
            set_setting(s, "sharepoint_dir", "D:\\BENCHFLOW")
            assert get_setting(s, "sharepoint_dir") == "D:\\BENCHFLOW"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_export_load_roundtrip():
    tmp = Path(tempfile.mkdtemp(prefix="benchflow_sp_"))
    try:
        # Member side: temp db + uploads with a paren'd filename.
        db = tmp / "db" / "benchflow.db"
        db.parent.mkdir(parents=True)
        up = tmp / "db" / "uploads"
        up.mkdir()
        eng = create_engine(f"sqlite:///{db}")
        SQLModel.metadata.create_all(eng)
        with Session(eng) as s:
            s.add(PaperDB(id="p1", name="Paper One", color="#ffffff"))
            s.add(ProjectDB(id="pr1", name="Proj"))
            s.add(
                ExperimentDB(
                    id="e1",
                    project_id="pr1",
                    name="Exp",
                    results='see [![i](/uploads/aaaa1111_file(x)_preview.png "t")](#z)',
                    blocks=[
                        {
                            "type": "img",
                            "name": "I",
                            "src": "/uploads/aaaa1111_file(x).tif",
                            "preview_url": "/uploads/aaaa1111_file(x)_preview.png",
                        }
                    ],
                )
            )
            s.commit()
        (up / "aaaa1111_file(x).tif").write_bytes(b"x" * 100)
        (up / "aaaa1111_file(x)_preview.png").write_bytes(b"y" * 50)
        (up / "unreferenced_junk.bin").write_bytes(b"z" * 10)

        dest = tmp / "BENCHFLOW"
        summary = export(db, up, dest, "Tester's Lab")
        mdir = dest / sanitize_member("Tester's Lab")
        man = json.loads((mdir / "manifest.json").read_text(encoding="utf-8"))
        assert man["schema_version"] == 1
        assert man["projects"] == ["pr1"]
        assert (mdir / "projects" / "pr1.json").exists()
        atts = {a["name"]: a["synced"] for a in man["attachments"]}
        assert set(atts) == {"aaaa1111_file(x).tif", "aaaa1111_file(x)_preview.png"}
        assert "unreferenced_junk.bin" not in atts
        for sn in atts.values():
            assert (mdir / "attachments" / sn).exists()

        # PI side: load into a second db + uploads.
        db2 = tmp / "db2" / "benchflow.db"
        db2.parent.mkdir()
        up2 = tmp / "db2" / "uploads"
        up2.mkdir()
        res = load(dest, db2, up2)
        assert res["members"] == [sanitize_member("Tester's Lab")]
        assert res["projects"] == 1
        assert res["attachments_copied"] == 2
        eng2 = create_engine(f"sqlite:///{db2}")
        with Session(eng2) as s2:
            from app.db_service import get_lab_state

            st = get_lab_state(s2)
            assert len(st.projects) == 1
            assert st.projects[0].name == "Proj"
            exp = st.projects[0].exps[0]
            assert "/uploads/aaaa1111_file(x)_preview.png" in exp.results
            def src_of(b):
                return b.get("src") if isinstance(b, dict) else getattr(b, "src", None)

            assert any(src_of(b) == "/uploads/aaaa1111_file(x).tif" for b in exp.blocks)
        for f in ("aaaa1111_file(x).tif", "aaaa1111_file(x)_preview.png"):
            assert (up2 / f).exists()

        # Re-ingest is idempotent (lazy copy, wipe+rebuild).
        res2 = load(dest, db2, up2)
        assert res2["projects"] == 1
        assert res2["attachments_copied"] == 0
        assert res2["attachments_present"] == 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _run() -> None:
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(fns)} tests passed")


if __name__ == "__main__":
    _run()
