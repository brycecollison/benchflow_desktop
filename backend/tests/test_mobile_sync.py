"""Mobile sync, desktop side: the merge rules, the window's stale-write protection, phone ops, the
merge gate, and the sync app's auth: the parts that can be tested without a phone."""

import json
import shutil
import sqlite3
from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.db_service import changes_since, get_lab_state, save_lab_state, set_setting
from app.mobile_sync import service
from app.mobile_sync.merge import merge_experiment, merge_text
from app.models import AppliedOpDB, ExperimentDB, SyncConflictDB, TombstoneDB
from app.schemas import LabState

service.PUBLISH_DELAY_SECONDS = None

P = "Para one.\n\nPara two.\n\nPara three."


# -- merge module ---------------------------------------------------------------------------

def test_different_paragraphs_merge_cleanly():
    assert merge_text(P, P.replace("one", "ONE"), P.replace("three", "THREE")) == \
        "Para ONE.\n\nPara two.\n\nPara THREE."


def test_same_paragraph_is_a_conflict_not_markers():
    assert merge_text(P, P.replace("two", "2"), P.replace("two", "II")) is None


def test_both_appending_keeps_both():
    merged = merge_text(P, P + "\n\n**10:00** desk", P + "\n\n**10:05** bench")
    assert merged.startswith(P) and "desk" in merged and "bench" in merged
    assert merged.index("desk") < merged.index("bench")


def test_table_edits_merge_whole():
    table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"
    assert merge_text(table, table.replace("1", "X"), table.replace("4", "Y")) is None


def _exp(**kw):
    base = {"id": "e1", "name": "E", "status": "Running", "deps": [], "blocks": [],
            "experimentalProtocol": P, "notes": ""}
    return {**base, **kw}


def test_different_fields_both_kept():
    merged, conflicts = merge_experiment(_exp(), _exp(notes="desk"), _exp(status="Done"),
                                         incoming_wins_text=False, incoming_wins_other=True)
    assert (merged["notes"], merged["status"], conflicts) == ("desk", "Done", [])


def test_blocks_added_on_both_sides_are_both_kept_with_their_ids():
    a = {"id": "a1", "type": "txt", "text": "phone"}
    b = {"id": "b1", "type": "txt", "text": "desk"}
    merged, conflicts = merge_experiment(_exp(), _exp(blocks=[a]), _exp(blocks=[b]),
                                         incoming_wins_text=False, incoming_wins_other=True)
    assert [x["id"] for x in merged["blocks"]] == ["a1", "b1"] and conflicts == []


def test_deviations_union():
    d1 = {"id": "d1", "at": "2026-01-01T10:00:00Z", "device_id": "phone", "text": "late"}
    d2 = {"id": "d2", "at": "2026-01-01T11:00:00Z", "device_id": "desk", "text": "37C"}
    merged, conflicts = merge_experiment(
        _exp(), _exp(deviations={"experimentalProtocol": [d2]}),
        _exp(deviations={"experimentalProtocol": [d1]}), incoming_wins_text=False, incoming_wins_other=False)
    assert [d["id"] for d in merged["deviations"]["experimentalProtocol"]] == ["d1", "d2"]
    assert conflicts == []


# -- the notebook ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'benchflow.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        save_lab_state(session, LabState.model_validate({"projects": [{"id": "p1", "name": "P", "exps": [
            {"id": "e1", "name": "E1", "experimentalProtocol": P,
             "blocks": [{"type": "txt", "text": "legacy block, no id"}]},
            {"id": "e2", "name": "E2"},
        ]}]}))
    yield engine, tmp_path / "benchflow.db"
    engine.dispose()


def _state(session) -> dict:
    return get_lab_state(session).model_dump()


def _exp_of(state: dict, exp_id: str) -> dict:
    return next(e for p in state["projects"] for e in p["exps"] if e["id"] == exp_id)


def _op(op_id, unit, base, new, exp_id="e1", at="2999-01-01T00:00:00Z"):
    return {"op_id": op_id, "experiment_id": exp_id, "unit": unit, "base_value": base,
            "new_value": new, "at": at}


def _window_save(session, state: dict, edited: dict, since: int):
    """What the window sends: its whole (possibly stale) state, a base for each edited experiment."""
    bases = {exp_id: _exp_of(state, exp_id) for exp_id in edited}
    for p in state["projects"]:
        p["exps"] = [{**e, **edited.get(e["id"], {})} for e in p["exps"]]
    save_lab_state(session, LabState.model_validate({**state, "since": since, "bases": bases}))


def test_stale_window_cannot_revert_a_phone_edit(db):
    engine, path = db
    with Session(engine) as s:
        loaded = _state(s)  # the window loads...
        service.apply_ops(s, "phone-1", [_op("o1", "experimentalProtocol", P, P + "\n\nobs")], path)
        # ...then saves an unrelated edit from its stale copy
        _window_save(s, loaded, {"e1": {"notes": "desk note"}}, loaded["rev"])
        e1 = _exp_of(_state(s), "e1")
    assert e1["experimentalProtocol"] == P + "\n\nobs" and e1["notes"] == "desk note"


def test_unedited_experiments_are_not_written(db):
    engine, path = db
    with Session(engine) as s:
        loaded = _state(s)
        service.apply_ops(s, "phone-1", [_op("o1", "status", "Planned", "Done", exp_id="e2")], path)
        _window_save(s, loaded, {"e1": {"notes": "x"}}, loaded["rev"])  # e2 in the payload is stale
        assert _exp_of(_state(s), "e2")["status"] == "Done"


def test_same_paragraph_from_window_keeps_window_and_parks_phone(db):
    engine, path = db
    with Session(engine) as s:
        loaded = _state(s)
        service.apply_ops(s, "phone-1", [_op("o1", "experimentalProtocol", P, P.replace("two", "II"))], path)
        _window_save(s, loaded, {"e1": {"experimentalProtocol": P.replace("two", "2")}}, loaded["rev"])
        assert _exp_of(_state(s), "e1")["experimentalProtocol"] == P.replace("two", "2")
        parked = s.exec(select(SyncConflictDB)).one()
        assert json.loads(parked.parked) == P.replace("two", "II") and parked.source == "phone"


def test_same_paragraph_from_phone_keeps_desktop_and_parks_phone(db):
    engine, path = db
    with Session(engine) as s:
        loaded = _state(s)
        _window_save(s, loaded, {"e1": {"experimentalProtocol": P.replace("two", "2")}}, loaded["rev"])
        r = service.apply_ops(s, "phone-1", [_op("o1", "experimentalProtocol", P, P.replace("two", "II"))], path)
        assert r["results"][0]["result"] == "conflict"
        text = _exp_of(_state(s), "e1")["experimentalProtocol"]
        assert text == P.replace("two", "2") and "<<<" not in text
        assert json.loads(s.exec(select(SyncConflictDB)).one().parked) == P.replace("two", "II")


def test_stale_window_does_not_delete_what_it_has_not_seen(db):
    engine, path = db
    with Session(engine) as s:
        loaded = _state(s)
        service.apply_ops(s, "phone-1", [_op("o1", "notes", "", "bench", exp_id="e2")], path)
        loaded["projects"][0]["exps"] = [e for e in loaded["projects"][0]["exps"] if e["id"] != "e2"]
        save_lab_state(s, LabState.model_validate({**loaded, "since": loaded["rev"], "bases": {}}))
        assert s.get(ExperimentDB, "e2") is not None
        # with the change seen, the delete goes through and leaves a tombstone
        fresh = _state(s)
        fresh["projects"][0]["exps"] = [e for e in fresh["projects"][0]["exps"] if e["id"] != "e2"]
        save_lab_state(s, LabState.model_validate({**fresh, "since": fresh["rev"], "bases": {}}))
        assert s.get(ExperimentDB, "e2") is None
        assert {"kind": "experiment", "id": "e2"}.items() <= changes_since(s, fresh["rev"])["deleted"][0].items()


def test_block_ids_are_stable_across_saves(db):
    engine, _ = db
    with Session(engine) as s:
        first = _state(s)
        ids = [b["id"] for b in _exp_of(first, "e1")["blocks"]]
        assert all(ids)
        save_lab_state(s, LabState.model_validate(first))  # an old-style whole-state save
        _window_save(s, _state(s), {"e1": {"notes": "n"}}, first["rev"])
        assert [b["id"] for b in _exp_of(_state(s), "e1")["blocks"]] == ids


def test_rev_moves_only_on_change(db):
    engine, path = db
    with Session(engine) as s:
        before = _state(s)
        save_lab_state(s, LabState.model_validate(before))
        assert _state(s)["rev"] == before["rev"]
        service.apply_ops(s, "phone-1", [_op("o1", "notes", "", "x")], path)
        changed = changes_since(s, before["rev"])
        assert [e["id"] for e in changed["experiments"]] == ["e1"] and changed["rev"] > before["rev"]


def test_replayed_op_is_applied_once(db):
    engine, path = db
    op = _op("o1", "experimentalProtocol", P, P + "\n\nobs")
    with Session(engine) as s:
        service.apply_ops(s, "phone-1", [op], path)
        again = service.apply_ops(s, "phone-1", [op], path)
        assert again["results"][0]["duplicate"]
        assert _exp_of(_state(s), "e1")["experimentalProtocol"].count("obs") == 1


def test_phone_edit_to_deleted_experiment_is_restored_for_review(db):
    engine, path = db
    with Session(engine) as s:
        state = _state(s)
        state["projects"][0]["exps"] = [e for e in state["projects"][0]["exps"] if e["id"] != "e1"]
        save_lab_state(s, LabState.model_validate(state))
        assert s.get(TombstoneDB, ("e1", "experiment")) is not None
        r = service.apply_ops(s, "phone-1", [_op("o1", "notes", "", "found it")], path)
        assert r["results"][0]["result"] == "restored"
        assert _exp_of(_state(s), "e1")["notes"] == "found it"
        assert s.exec(select(SyncConflictDB).where(SyncConflictDB.source == "restored")).first()
        assert s.get(TombstoneDB, ("e1", "experiment")) is None


def test_phone_may_not_edit_structure(db):
    engine, path = db
    with Session(engine) as s:
        r = service.apply_ops(s, "phone-1", [_op("o1", "deps", [], ["e2"])], path)
        assert r["results"][0]["result"] == "rejected"
        assert _exp_of(_state(s), "e1")["deps"] == []
        assert s.exec(select(SyncConflictDB)).one().source == "rejected"  # parked, not dropped


def test_phone_block_and_deviation(db):
    engine, path = db
    dev = [{"id": "d1", "at": "2026-01-01T10:00:00Z", "device_id": "phone-1", "text": "spun 5 min longer"}]
    with Session(engine) as s:
        service.apply_ops(s, "phone-1", [
            _op("o1", "blocks/ph1", None, {"type": "img", "name": "bench.jpg", "src": "/uploads/x_bench.jpg"}),
            _op("o2", "deviations/experimentalProtocol", None, dev),
        ], path)
        e1 = _exp_of(_state(s), "e1")
        assert e1["blocks"][-1]["id"] == "ph1" and len(e1["blocks"]) == 2
        assert e1["deviations"]["experimentalProtocol"][0]["text"] == "spun 5 min longer"


def test_op_applied_on_one_pc_is_not_reapplied_on_another(db, tmp_path):
    engine, path = db
    op = _op("o1", "experimentalProtocol", P, P + "\n\nobs")
    with Session(engine) as s:
        service.apply_ops(s, "phone-1", [op], path)
    engine.dispose()
    other = tmp_path / "pc-b.db"
    shutil.copy2(path, other)  # PC B pulls PC A's published notebook
    engine_b = create_engine(f"sqlite:///{other}")
    with Session(engine_b) as s:
        assert service.apply_ops(s, "phone-1", [op], other)["results"][0]["duplicate"]
        assert s.get(AppliedOpDB, "o1") is not None
    engine_b.dispose()


def test_stale_pc_defers_phone_ops(db, tmp_path):
    from app.backup import publish

    engine, path = db
    folder = tmp_path / "OneDrive"
    with Session(engine) as s:
        set_setting(s, "backup_dir", str(folder))
    (tmp_path / "uploads").mkdir()
    publish(path, tmp_path / "uploads", folder)
    with Session(engine) as s:
        assert not service.apply_ops(s, "phone-1", [_op("o1", "notes", "", "a")], path)["deferred"]
    # another PC publishes: this one no longer holds the current notebook
    con = sqlite3.connect(folder / "benchflow.db")
    con.execute("UPDATE experiments SET notes = 'other pc' WHERE id = 'e2'")
    con.commit()
    con.close()
    with Session(engine) as s:
        r = service.apply_ops(s, "phone-1", [_op("o2", "notes", "a", "b")], path)
        assert r["deferred"] and s.get(AppliedOpDB, "o2") is None


# -- the sync app ---------------------------------------------------------------------------

@pytest.fixture
def sync_client():
    from fastapi.testclient import TestClient

    from app.database import init_db
    from app.mobile_sync.api import app

    init_db()
    return TestClient(app)


def _code() -> str:
    from app.database import engine

    with Session(engine) as s:
        return service.new_pairing_code(s)["code"]


def test_ops_need_a_paired_token(sync_client):
    assert sync_client.get("/api/mobile/changes").status_code == 401
    assert sync_client.post("/api/mobile/pair", json={"code": "nope", "device_id": "ph"}).status_code == 401

    code = _code()
    token = sync_client.post("/api/mobile/pair", json={"code": code, "device_id": "ph", "name": "Pixel"}).json()["token"]
    assert sync_client.post("/api/mobile/pair", json={"code": code, "device_id": "ph2"}).status_code == 401  # one-time
    auth = {"Authorization": f"Bearer {token}"}
    assert sync_client.get("/api/mobile/changes?since=0", headers=auth).status_code == 200
    assert sync_client.post("/api/mobile/ops", json={"ops": []}, headers=auth).json()["results"] == []

    from app.database import engine

    with Session(engine) as s:
        assert service.revoke(s, "ph")
    assert sync_client.get("/api/mobile/changes", headers=auth).status_code == 401


def test_upload_is_content_addressed(sync_client):
    import base64
    import hashlib

    from app.mobile_sync.api import upload_name

    token = sync_client.post("/api/mobile/pair", json={"code": _code(), "device_id": "ph3"}).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    body = {"filename": "bench photo.jpg", "data": base64.b64encode(b"hello").decode()}
    first = sync_client.post("/api/mobile/uploads", json=body, headers=auth).json()
    again = sync_client.post("/api/mobile/uploads", json=body, headers=auth).json()
    name = upload_name(hashlib.sha256(b"hello").hexdigest(), "bench photo.jpg")
    assert first["raw_url"] == again["raw_url"] == f"/uploads/{name}"  # the name the phone predicts
    assert sync_client.get(f"/api/mobile/uploads/{name}", headers=auth).content == b"hello"
    assert sync_client.post("/api/mobile/uploads", json={**body, "data": "not base64!"}, headers=auth).status_code == 400
    from fastapi import HTTPException

    from app.mobile_sync.api import download

    with pytest.raises(HTTPException):  # called directly: an HTTP client would normalize the ".."
        download("../benchflow.db", "ph3")


def test_conflicts_are_listed_and_resolved_without_loss(db):
    engine, path = db
    with Session(engine) as s:
        loaded = _state(s)
        _window_save(s, loaded, {"e1": {"experimentalProtocol": P.replace("two", "2")}}, loaded["rev"])
        service.apply_ops(s, "phone-1", [_op("o1", "experimentalProtocol", P, P.replace("two", "II"))], path)
        [c] = service.list_conflicts(s)
        assert c["experiment_name"] == "E1" and c["parked"] == P.replace("two", "II")
        assert service.resolve_conflict(s, c["id"], "other", "desktop-x")  # take the phone's version
        assert _exp_of(_state(s), "e1")["experimentalProtocol"] == P.replace("two", "II")
        assert service.list_conflicts(s) == []
        audit = s.exec(select(SyncConflictDB).where(SyncConflictDB.source == "replaced")).one()
        assert json.loads(audit.parked) == P.replace("two", "2")  # the desktop text is still kept
        assert not service.resolve_conflict(s, c["id"], "keep", "desktop-x")  # already resolved


def test_tailscale_setup_reads_dns_name_and_serve(monkeypatch):
    answers = {("status", "--json"): json.dumps({"Self": {"DNSName": "lab-pc.tail1.ts.net."}}),
               ("serve", "status", "--json"): '{"Web":{"lab-pc.tail1.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:18766"}}}}}'}
    monkeypatch.setattr(service, "_tailscale", lambda *a: answers.get(a))
    assert service.tailscale_setup(18766) == {"installed": True, "url": "https://lab-pc.tail1.ts.net", "served": True}
    assert service.tailscale_setup(9999)["served"] is False
    monkeypatch.setattr(service, "_tailscale", lambda *a: None)
    assert service.tailscale_setup(18766)["installed"] is False


def test_older_build_refuses_a_newer_schema_notebook(db, tmp_path):
    from app.backup import sync_pull

    _, path = db
    folder = tmp_path / "OneDrive"
    folder.mkdir()
    shutil.copy2(path, folder / "benchflow.db")
    con = sqlite3.connect(folder / "benchflow.db")
    con.execute("UPDATE experiments SET notes = 'from a newer build'")
    con.execute("PRAGMA user_version = 99")
    con.commit()
    con.close()
    before = path.read_bytes()
    with pytest.raises(ValueError, match="newer version"):
        sync_pull(path, tmp_path / "uploads", folder)
    assert path.read_bytes() == before  # this PC's notebook untouched
