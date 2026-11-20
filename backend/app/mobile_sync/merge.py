"""Field-level three-way merge for experiments. Pure functions: no I/O, no database, no app imports.

An experiment (API form, camelCase) is flattened into merge *units*:

    <field>                       every scalar/list field (name, status, experimentalProtocol, deps, ...)
    blocks/<id>                   one attachment block, whole
    blocks:order                  block id order
    customPhases/<id>/<prop>      one property of one custom phase
    customPhases:order            custom phase id order (None = the experiment has no list)
    deviations/<phaseKey>         that phase's deviation entries

A unit that is absent (or None) on one side means "not there"; deleting a block is its unit going
to None. merge_units() decides each unit from (base, current, incoming):

    only one side changed it         -> that side
    both changed it the same way     -> that value
    deviations                       -> union by entry id, never a conflict
    *:order                          -> current order plus what incoming added, never a conflict
    text, both changed               -> line three-way merge; overlapping edits -> conflict
    anything else, both changed      -> conflict

A conflict keeps one side (the caller says which) and reports the other so it can be parked in
sync_conflicts. Nothing is ever dropped silently, and no <<< >>> markers go into the text.
"""

import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

TEXT_FIELDS = {
    "purpose", "expectedResults", "experimentalDesign", "experimentalProtocol",
    "dataAcquisition", "dataAnalysis", "results", "figures", "futureDirections", "notes",
}
_BUILTIN_PHASES = ("experimentalProtocol", "dataAcquisition", "dataAnalysis")
_PHASE_META = ("Duration", "Completed", "StartDate", "EndDate")
_PHONE_FIELDS = TEXT_FIELDS | {"name", "status"} | {p + m for p in _BUILTIN_PHASES for m in _PHASE_META}
_PHONE_CUSTOM = re.compile(r"^customPhases/[^/]+/(content|duration|completed|startDate|endDate)$")
_ORDER_UNITS = ("blocks:order", "customPhases:order")


def ensure_block_ids(blocks: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Every block gets a stable id. A missing one is a hash of the block, so the same id-less
    block gets the same id on every path (save, merge, migration)."""
    out, seen = [], set()
    for block in blocks or []:
        block = dict(block)
        if not block.get("id"):
            digest = hashlib.sha1(json.dumps(block, sort_keys=True, default=str).encode()).hexdigest()[:12]
            bid, n = "b" + digest, 2
            while bid in seen:
                bid, n = f"b{digest}-{n}", n + 1
            block["id"] = bid
        seen.add(block["id"])
        out.append(block)
    return out


def is_text_unit(unit: str) -> bool:
    return unit in TEXT_FIELDS or (unit.startswith("customPhases/") and unit.endswith("/content"))


def phone_may_edit(unit: str) -> bool:
    """The phone edits existing experiments only: text, phase dates/completion, status, name,
    blocks and deviations. Not deps, phases, positions, papers or custom phase structure."""
    return (unit in _PHONE_FIELDS or bool(_PHONE_CUSTOM.match(unit))
            or (unit.startswith("blocks/") and len(unit) > 7)
            or (unit.startswith("deviations/") and len(unit) > 11))


# -- experiment <-> units ----------------------------------------------------------------

def flatten(exp: Dict[str, Any]) -> Dict[str, Any]:
    units: Dict[str, Any] = {}
    for key, value in exp.items():
        if key == "blocks":
            blocks = ensure_block_ids(value)
            for b in blocks:
                units[f"blocks/{b['id']}"] = b
            units["blocks:order"] = [b["id"] for b in blocks]
        elif key == "customPhases":
            if value is None:
                units["customPhases:order"] = None
                continue
            for cp in value:
                for prop, v in cp.items():
                    if prop != "id":
                        units[f"customPhases/{cp['id']}/{prop}"] = v
            units["customPhases:order"] = [cp["id"] for cp in value]
        elif key == "deviations":
            for phase_key, entries in (value or {}).items():
                if entries:
                    units[f"deviations/{phase_key}"] = entries
        else:
            units[key] = value
    return units


def _ordered(items: Dict[str, Any], order: Optional[List[str]]) -> List[Any]:
    order = [i for i in (order or []) if i in items]
    return [items[i] for i in order] + [v for k, v in items.items() if k not in order]


def unflatten(units: Dict[str, Any]) -> Dict[str, Any]:
    exp: Dict[str, Any] = {}
    blocks: Dict[str, Any] = {}
    phases: Dict[str, Dict[str, Any]] = {}
    deviations: Dict[str, Any] = {}
    for unit, value in units.items():
        if unit.startswith("blocks/"):
            if value is not None:
                blocks[unit[len("blocks/"):]] = value
        elif unit.startswith("customPhases/"):
            _, cid, prop = unit.split("/", 2)
            if value is not None:
                phases.setdefault(cid, {"id": cid})[prop] = value
        elif unit.startswith("deviations/"):
            if value:
                deviations[unit[len("deviations/"):]] = value
        elif unit not in _ORDER_UNITS:
            exp[unit] = value
    exp["blocks"] = _ordered(blocks, units.get("blocks:order"))
    order = units.get("customPhases:order")
    exp["customPhases"] = None if order is None and not phases else _ordered(phases, order)
    exp["deviations"] = deviations or None
    return exp


# -- text --------------------------------------------------------------------------------

def _tokens(text: str) -> List[str]:
    """Lines, except that a Markdown table or a $$ math block is one token: merging inside them
    could produce a table or formula the editor cannot parse, so they merge whole."""
    lines = text.splitlines(keepends=True)
    out, i = [], 0
    while i < len(lines):
        s = lines[i].strip()
        j = i + 1
        if s.startswith("|"):
            while j < len(lines) and lines[j].strip().startswith("|"):
                j += 1
        elif s.startswith("$$") and s.count("$$") == 1:
            while j < len(lines) and "$$" not in lines[j]:
                j += 1
            j = min(j + 1, len(lines))
        out.append("".join(lines[i:j]))
        i = j
    return out


def _hunks(base: List[str], other: List[str]) -> List[Tuple[int, int, List[str]]]:
    ops = SequenceMatcher(None, base, other, autojunk=False).get_opcodes()
    return [(i1, i2, other[j1:j2]) for tag, i1, i2, j1, j2 in ops if tag != "equal"]


def merge_text(base: str, current: str, incoming: str) -> Optional[str]:
    """Three-way merge on lines. None when both sides changed the same lines.

    Both sides inserting at the same spot (typically both appending an observation at the end)
    is not a conflict: current's lines come first, then incoming's.
    """
    if current == incoming or incoming == base:
        return current
    if current == base:
        return incoming
    # Editor text has no final newline, so an append would rewrite the last line and clash.
    trailing = current.endswith("\n") or incoming.endswith("\n")
    base, current, incoming = (t if t.endswith("\n") else t + "\n" for t in (base, current, incoming))
    bt = _tokens(base)
    hunks = sorted([(h, 0) for h in _hunks(bt, _tokens(current))] +
                   [(h, 1) for h in _hunks(bt, _tokens(incoming))],
                   key=lambda x: (x[0][0], x[0][1], x[1]))
    out: List[str] = []
    pos = k = 0
    while k < len(hunks):
        (start, end, _), _side = hunks[k]
        group = [hunks[k]]
        k += 1
        while k < len(hunks):
            (i1, i2, _), _ = hunks[k]
            same_point_insert = i1 == i2 == start == end
            if i1 < end or same_point_insert:
                group.append(hunks[k])
                end = max(end, i2)
                k += 1
            else:
                break
        out.extend(bt[pos:start])
        if len(group) == 1 or all(h == group[0][0] for h, _ in group):
            out.extend(group[0][0][2])
        elif all(h[0] == h[1] == start for h, _ in group):
            seen: List[List[str]] = []
            for h, _ in group:  # sorted: current's insert before incoming's
                if h[2] not in seen:
                    seen.append(h[2])
                    out.extend(h[2])
        else:
            return None
        pos = end
    out.extend(bt[pos:])
    merged = "".join(out)
    return merged if trailing else merged[:-1]


# -- units -------------------------------------------------------------------------------

def _union(current: Optional[list], incoming: Optional[list]) -> list:
    by_id = {e["id"]: e for e in current or []}
    by_id.update({e["id"]: e for e in incoming or []})  # same id on both: incoming is the newer edit
    return sorted(by_id.values(), key=lambda e: (str(e.get("at") or ""), e["id"]))


def _merge_order(base: Optional[list], current: Optional[list], incoming: Optional[list]) -> Optional[list]:
    if current is None and incoming is None:
        return None
    current = list(current or [])
    return current + [x for x in incoming or [] if x not in current and x not in (base or [])]


def merge_units(base: Dict[str, Any], current: Dict[str, Any], incoming: Dict[str, Any], *,
                incoming_wins_text: bool, incoming_wins_other: bool):
    """Returns (merged units, conflicts). A conflict is {unit, kept, parked, base, parked_side}."""
    merged: Dict[str, Any] = {}
    conflicts: List[Dict[str, Any]] = []
    for unit in {**current, **incoming, **base}:
        b, c, i = base.get(unit), current.get(unit), incoming.get(unit)
        if i == b or c == i:
            merged[unit] = c
        elif c == b:
            merged[unit] = i
        elif unit.startswith("deviations/"):
            merged[unit] = _union(c, i)
        elif unit in _ORDER_UNITS:
            merged[unit] = _merge_order(b, c, i)
        else:
            text = None
            if is_text_unit(unit) and isinstance(c, str) and isinstance(i, str) and isinstance(b, (str, type(None))):
                text = merge_text(b or "", c, i)
            if text is not None:
                merged[unit] = text
                continue
            wins = incoming_wins_text if is_text_unit(unit) else incoming_wins_other
            kept, parked = (i, c) if wins else (c, i)
            merged[unit] = kept
            conflicts.append({"unit": unit, "kept": kept, "parked": parked, "base": b,
                              "parked_side": "current" if wins else "incoming"})
    return merged, conflicts


def merge_experiment(base: Dict[str, Any], current: Dict[str, Any], incoming: Dict[str, Any], *,
                     incoming_wins_text: bool, incoming_wins_other: bool):
    """Three-way merge of whole experiments (API form). Returns (merged experiment, conflicts)."""
    units, conflicts = merge_units(flatten(base), flatten(current), flatten(incoming),
                                   incoming_wins_text=incoming_wins_text,
                                   incoming_wins_other=incoming_wins_other)
    merged = unflatten(units)
    merged["id"] = current.get("id") or incoming.get("id")
    return merged, conflicts
