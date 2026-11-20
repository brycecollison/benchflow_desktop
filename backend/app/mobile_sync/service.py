"""The desktop end of phone sync: pairing, the merge gate, and applying phone ops.

HTTP is in api.py; merge rules are in merge.py (no I/O). Design: docs/adr/0002-mobile-sync.md.
"""

import hashlib
import json
import secrets
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pydantic import ValidationError
from sqlmodel import Session, select

from app.db_service import (
    WRITE_LOCK,
    canonical,
    experiment_api,
    get_setting,
    record_conflict,
    set_setting,
)
from app.mobile_sync.merge import flatten, merge_units, phone_may_edit, unflatten
from app.models import (AppliedOpDB, ExperimentDB, ProjectDB, SyncConflictDB, TombstoneDB, apply_exp_dict,
                        content_changed, utc_now)

# -- pairing ------------------------------------------------------------------------------
# Paired devices live in settings, not in notebook tables: settings stay with this PC (a pull
# keeps them), and the plan pairs a phone with each PC separately. Only token hashes are stored.

DEVICES_KEY = "mobile_devices"
PAIRING_KEY = "mobile_pairing"  # {sha256(code): expiry epoch}; in settings so a dev sync server in
PAIRING_TTL_SECONDS = 600       # another process sees codes the window made


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def list_devices(session: Session) -> List[Dict[str, Any]]:
    try:
        return json.loads(get_setting(session, DEVICES_KEY) or "[]")
    except ValueError:
        return []


def public_devices(session: Session) -> List[Dict[str, Any]]:
    return [{k: v for k, v in d.items() if k != "token_sha256"} for d in list_devices(session)]


def _pending_codes(session: Session) -> Dict[str, float]:
    try:
        codes = json.loads(get_setting(session, PAIRING_KEY) or "{}")
    except ValueError:
        codes = {}
    return {h: exp for h, exp in codes.items() if exp > time.time()}


def new_pairing_code(session: Session) -> Dict[str, Any]:
    code = secrets.token_urlsafe(6)
    with WRITE_LOCK:
        codes = _pending_codes(session)
        codes[_sha256(code)] = time.time() + PAIRING_TTL_SECONDS
        set_setting(session, PAIRING_KEY, json.dumps(codes))
    return {"code": code, "expires_in": PAIRING_TTL_SECONDS}


def pair(session: Session, code: str, device_id: str, name: str) -> Optional[str]:
    """Trade a one-time code for a bearer token. None when the code is unknown or expired."""
    with WRITE_LOCK:
        codes = _pending_codes(session)
        if codes.pop(_sha256(code), None) is None:
            return None
        set_setting(session, PAIRING_KEY, json.dumps(codes))
    token = secrets.token_urlsafe(32)
    devices = [d for d in list_devices(session) if d["id"] != device_id]  # re-pairing replaces
    devices.append({"id": device_id, "name": name, "token_sha256": _sha256(token),
                    "paired_at": datetime.now(timezone.utc).isoformat(), "revoked": False})
    set_setting(session, DEVICES_KEY, json.dumps(devices))
    return token


def device_for_token(session: Session, token: str) -> Optional[str]:
    digest = _sha256(token)
    for d in list_devices(session):
        if not d.get("revoked") and secrets.compare_digest(d.get("token_sha256", ""), digest):
            return d["id"]
    return None


def revoke(session: Session, device_id: str) -> bool:
    devices = list_devices(session)
    found = False
    for d in devices:
        if d["id"] == device_id:
            d["revoked"], found = True, True
    if found:
        set_setting(session, DEVICES_KEY, json.dumps(devices))
    return found


# -- merge gate (two or more PCs, plan section 4b) -----------------------------------------

def merge_allowed(session: Session, db_path: Path) -> Tuple[bool, str]:
    """Only a PC that holds the notebook last published to the OneDrive folder may merge phone
    ops; a stale PC would fork the notebook. No folder configured means a single PC: allowed."""
    from app.backup import fingerprint, read_sync_state

    raw = get_setting(session, "backup_dir")
    if not raw:
        return True, ""
    dest = Path(raw).expanduser()
    folder_db = dest / "benchflow.db"
    if not folder_db.exists():
        return True, ""
    state = read_sync_state(db_path)
    if state.get("dest") == str(dest) and state.get("fp") and fingerprint(folder_db) == state["fp"]:
        return True, ""
    return False, ("This PC does not hold the notebook last published to the OneDrive folder. Close "
                   "and reopen Benchflow here (or use the PC that published it); the phone keeps its edits.")


PUBLISH_DELAY_SECONDS: Optional[float] = 30.0  # None: off (tests)
_publish_timer: Optional[threading.Timer] = None
_publish_lock = threading.Lock()


def schedule_publish() -> None:
    """Publish soon after merging phone ops, so another PC opened next starts from them.
    Debounced: a burst of pushes publishes once."""
    global _publish_timer
    if PUBLISH_DELAY_SECONDS is None:
        return

    def run() -> None:
        try:
            from app.backup import run_configured

            run_configured()
        except Exception as error:  # noqa: BLE001 - a failed publish must not break sync
            print(f"[WARN] publish after phone sync failed: {error}", flush=True)

    with _publish_lock:
        if _publish_timer is not None:
            _publish_timer.cancel()
        _publish_timer = threading.Timer(PUBLISH_DELAY_SECONDS, run)
        _publish_timer.daemon = True
        _publish_timer.start()


# -- ops ----------------------------------------------------------------------------------

def _parse_time(value: str) -> datetime:
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.min.replace(tzinfo=timezone.utc)
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _canon_unit(current: Dict[str, Any], unit: str, value: Any) -> Any:
    """The op's value in the stored shape, so equal content compares equal."""
    if unit.startswith("blocks/") and isinstance(value, dict):
        value = {**value, "id": unit[len("blocks/"):]}
    units = {**current, unit: value}
    return flatten(canonical({**unflatten(units), "id": "_", "name": units.get("name") or "_"})).get(unit)


def _restore(session: Session, exp_id: str) -> Optional[ExperimentDB]:
    """A phone edited an experiment deleted on desktop: bring it back (with its project) for review."""
    tomb = session.get(TombstoneDB, (exp_id, "experiment"))
    if tomb is None or not tomb.data:
        return None
    data = dict(tomb.data)
    project_id = data.pop("projectId", None) or "restored-from-phone"
    if session.get(ProjectDB, project_id) is None:
        ptomb = session.get(TombstoneDB, (project_id, "project"))
        session.add(ProjectDB(id=project_id, name=((ptomb.data or {}).get("name") if ptomb else None)
                              or "Restored from phone"))
    exp = ExperimentDB(id=exp_id, project_id=project_id, name=data.get("name") or exp_id)
    apply_exp_dict(exp, data)
    session.add(exp)
    session.flush()
    return exp


def _apply_one(session: Session, device_id: str, op: Dict[str, Any]) -> Dict[str, Any]:
    op_id, exp_id, unit = op["op_id"], op["experiment_id"], op["unit"]
    done = session.get(AppliedOpDB, op_id)
    if done is not None:
        return {"op_id": op_id, "result": done.result, "duplicate": True}

    def park(reason: str) -> Dict[str, Any]:
        record_conflict(session, exp_id, {"unit": unit, "kept": None, "parked": op.get("new_value"),
                                          "base": op.get("base_value")},
                        source="rejected", device_id=device_id, op_id=op_id)
        session.add(AppliedOpDB(op_id=op_id, device_id=device_id, experiment_id=exp_id, result="rejected"))
        return {"op_id": op_id, "result": "rejected", "detail": reason}

    if not phone_may_edit(unit):
        return park(f"the phone may not edit {unit}")
    result = "applied"
    exp = session.get(ExperimentDB, exp_id)
    if exp is None:
        exp = _restore(session, exp_id)
        if exp is None:
            return park("unknown experiment")
        result = "restored"
        record_conflict(session, exp_id, {"unit": unit, "kept": None, "parked": None, "base": None},
                        source="restored", device_id=device_id, op_id=op_id)

    current_exp = experiment_api(session, exp).model_dump()
    current = flatten(current_exp)
    try:
        base = {unit: _canon_unit(current, unit, op.get("base_value"))}
        incoming = {unit: _canon_unit(current, unit, op.get("new_value"))}
    except ValidationError as error:
        return park(f"invalid value: {error.errors()[0].get('msg', 'invalid')}")
    phone_newer = _parse_time(op.get("at", "")) > _parse_time(exp.updated_at.isoformat())
    merged, conflicts = merge_units(base, current, incoming,
                                    incoming_wins_text=False, incoming_wins_other=phone_newer)
    for c in conflicts:
        parked_phone = c["parked_side"] == "incoming"
        record_conflict(session, exp_id, c, source="phone" if parked_phone else "desktop",
                        device_id=device_id if parked_phone else exp.device_id, op_id=op_id)
    if conflicts and result == "applied":
        result = "conflict"
    apply_exp_dict(exp, canonical({**unflatten(merged), "id": exp.id}))
    if content_changed(exp):
        exp.device_id = device_id
    session.add(AppliedOpDB(op_id=op_id, device_id=device_id, experiment_id=exp_id, result=result))
    return {"op_id": op_id, "result": result}


def _set_unit(session: Session, exp: ExperimentDB, unit: str, value: Any, device_id: str) -> None:
    units = flatten(experiment_api(session, exp).model_dump())
    units[unit] = value
    apply_exp_dict(exp, canonical({**unflatten(units), "id": exp.id}))
    if content_changed(exp):
        exp.device_id = device_id


# -- conflicts (both apps list and resolve them; the desktop holds them) --------------------

def list_conflicts(session: Session) -> List[Dict[str, Any]]:
    rows = session.exec(select(SyncConflictDB).where(SyncConflictDB.resolved_at == None)  # noqa: E711
                        .order_by(SyncConflictDB.created_at)).all()
    names = {e.id: e.name for e in session.exec(select(ExperimentDB)).all()}
    return [{"id": c.id, "experiment_id": c.experiment_id, "experiment_name": names.get(c.experiment_id, ""),
             "unit": c.unit, "kept": json.loads(c.kept), "parked": json.loads(c.parked),
             "source": c.source, "device_id": c.device_id, "created_at": c.created_at.isoformat()}
            for c in rows]


def resolve_conflict(session: Session, conflict_id: str, choice: str, device_id: str) -> bool:
    """choice 'keep': the field stays as it is. 'other': the parked value replaces it, and the value it
    replaces is kept as an already-resolved row, so this loses nothing either. False when there is no
    such open conflict."""
    with WRITE_LOCK:
        c = session.get(SyncConflictDB, conflict_id)
        if c is None or c.resolved_at is not None or choice not in ("keep", "other"):
            return False
        exp = session.get(ExperimentDB, c.experiment_id)
        if choice == "other" and exp is not None and c.source in ("phone", "desktop", "rejected"):
            current = flatten(experiment_api(session, exp).model_dump()).get(c.unit)
            _set_unit(session, exp, c.unit, json.loads(c.parked), device_id)
            session.add(SyncConflictDB(id=secrets.token_hex(16), experiment_id=exp.id, unit=c.unit,
                                       kept=c.parked, parked=json.dumps(current), base=c.base,
                                       source="replaced", device_id=device_id, resolved_at=utc_now()))
        c.resolved_at = utc_now()
        session.commit()
        return True


# -- Tailscale (the transport; ADR 0002) ---------------------------------------------------

def _tailscale(*args: str) -> Optional[str]:
    exe = shutil.which("tailscale") or next(
        (p for p in (r"C:\Program Files\Tailscale\tailscale.exe",) if Path(p).is_file()), None)
    if not exe:
        return None
    try:
        out = subprocess.run([exe, *args], capture_output=True, text=True, timeout=20,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout if out.returncode == 0 else None


def tailscale_setup(port: int) -> Dict[str, Any]:
    """This PC's tailnet address and whether the sync port is published on it."""
    status = _tailscale("status", "--json")
    if status is None:
        return {"installed": False, "url": None, "served": False}
    try:
        dns = (json.loads(status).get("Self") or {}).get("DNSName", "").rstrip(".")
    except ValueError:
        dns = ""
    serve = _tailscale("serve", "status", "--json") or ""
    return {"installed": True, "url": f"https://{dns}" if dns else None,
            "served": f"127.0.0.1:{port}" in serve or f"localhost:{port}" in serve}


def tailscale_publish(port: int) -> Dict[str, Any]:
    """`tailscale serve --bg <port>`: tailnet only, never funnel."""
    if _tailscale("serve", "--bg", str(port)) is None:
        raise RuntimeError("tailscale serve failed. Is Tailscale running and signed in, with HTTPS "
                           "certificates enabled for the tailnet?")
    return tailscale_setup(port)


def apply_ops(session: Session, device_id: str, ops: List[Dict[str, Any]], db_path: Path) -> Dict[str, Any]:
    """Apply a phone's ops in order. Each op commits on its own, so a dropped connection or a
    crash mid-batch leaves the applied ones recorded and a retry skips them."""
    allowed, reason = merge_allowed(session, db_path)
    if not allowed:
        return {"deferred": True, "detail": reason, "results": []}
    results = []
    with WRITE_LOCK:
        for op in ops:
            results.append(_apply_one(session, device_id, op))
            session.commit()
    if any(not r.get("duplicate") for r in results) and get_setting(session, "backup_dir"):
        schedule_publish()
    return {"deferred": False, "results": results}
