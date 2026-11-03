"""OneNote Section Importer for Lab Planner & ELN.

Extracts pages, text hierarchy, tables, images, and attachments from Microsoft OneNote
sections (.one files) and imports them as structured Projects and Experiments with
rich ELN blocks (images, tables, text) and DAG workflow dependencies.
"""

import os
import io
import re
import uuid
import secrets
import string
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from PIL import Image
import aspose.note as note
from sqlmodel import Session, select

from app.models import (
    ProjectDB,
    ExperimentDB,
    ExperimentDependencyDB,
    utc_now,
)
from app.schemas import (
    LabState,
    Project,
    Experiment,
    TextBlock,
    ImageBlock,
    TableBlock,
)
from app.image_processor import process_uploaded_file
from app.db_service import get_lab_state

PALMISANO_LAB_BACKUP_DIR = Path(r"C:\Users\bryce\AppData\Local\Microsoft\OneNote\16.0\Backup\Palmisano Lab")
COHESIN_IPS_SECTION = str(PALMISANO_LAB_BACKUP_DIR / "Cohesin IPs (On 3-18-2026).one")
NIPBL_MODULATION_SECTION = str(PALMISANO_LAB_BACKUP_DIR / "NIPBL Modulation (On 8-26-2026).one")
NUCLEAR_ENERGETICS_SECTION = str(PALMISANO_LAB_BACKUP_DIR / "Nuclear Energetics (On 6-28-2026).one")

DEFAULT_ONENOTE_SECTION = COHESIN_IPS_SECTION


def gen_uid(length: int = 7) -> str:
    """Generate a random lowercase alphanumeric identifier matching the app's UID convention."""
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def extract_outline_lines(element, depth: int = 0) -> List[str]:
    """Recursively extracts text from an outline element, preserving tree depth and hierarchy."""
    lines = []
    prefix = ("  " * depth + "- ") if depth > 0 else ""
    for child in element:
        if isinstance(child, note.RichText) and child.Text and child.Text.strip():
            lines.append(f"{prefix}{child.Text.strip()}")
        elif isinstance(child, note.OutlineElement):
            lines.extend(extract_outline_lines(child, depth + 1))
    return lines


DATE_PATTERN = re.compile(
    r"^\s*[-*]?\s*(0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])[./-]((20)?(1[89]|2[0-9]))\b",
    re.IGNORECASE,
)


def parse_date_to_iso(raw: str) -> Optional[str]:
    """Converts common lab date strings (e.g., 04/11/24, 1.14.25, 11.20.2024) to ISO YYYY-MM-DD."""
    m = DATE_PATTERN.search(raw)
    if not m:
        return None
    month = int(m.group(1))
    day = int(m.group(2))
    year = int(m.group(3))
    if year < 100:
        year += 2000
    return f"{year:04d}-{month:02d}-{day:02d}"


def extract_page_sections(page: note.Page) -> Dict[str, Any]:
    """Extracts structured experimental sections from a OneNote page:
    - experimental_protocol: All dated sections (from the first date matching DATE_PATTERN down to results/next steps),
      preserving exact hierarchy, list numbering (1., 2., a., b.), sub-bullets, and line breaks.
    - experimental_design: The opening conditions, setup, tissue requirements before the first dated section.
    - results: Any trailing results, findings, conclusions, or next steps.
    - expected_results / purpose: Extracted from opening lines if relevant keywords are found.
    - notes: Complete page content.
    - start_date / end_date: ISO YYYY-MM-DD format of the first and last dated steps.
    """
    design_lines: List[str] = []
    protocol_blocks: List[str] = []
    results_lines: List[str] = []
    all_page_lines: List[str] = []

    stage = "design"  # 'design' -> 'protocol' -> 'results'
    current_counters: Dict[int, int] = {}
    first_iso: Optional[str] = None
    last_iso: Optional[str] = None

    def walk(e, depth: int = 0):
        nonlocal stage, current_counters, first_iso, last_iso
        rts = [x.Text.strip() for x in e if isinstance(x, note.RichText) and x.Text and x.Text.strip()]
        txt = " ".join(rts)
        if txt:
            all_page_lines.append(("  " * depth + "- ") if depth > 0 else txt)
            clean = txt.strip().lstrip("-*").strip()
            m = DATE_PATTERN.match(clean)
            if m:
                stage = "protocol"
                iso = parse_date_to_iso(clean)
                if not first_iso and iso:
                    first_iso = iso
                if iso:
                    last_iso = iso
                current_counters = {}
                protocol_blocks.append(f"\n{clean}\n")
                for child in e:
                    if isinstance(child, note.OutlineElement):
                        walk(child, depth + 1)
                return

            if stage == "design":
                indent = "\t" * depth if depth > 0 else ""
                design_lines.append(f"{indent}{clean}")
            elif stage == "protocol":
                if re.match(r"^(next steps?|results?|findings?|conclusions?)", clean, re.IGNORECASE) and len(clean) < 40:
                    stage = "results"
                    results_lines.append(f"\n### {clean}\n")
                    for child in e:
                        if isinstance(child, note.OutlineElement):
                            walk(child, depth + 1)
                    return

                nl = getattr(e, "NumberList", None)
                if nl is not None:
                    lvl = depth
                    cnt = current_counters.get(lvl, 0) + 1
                    current_counters[lvl] = cnt
                    for k in list(current_counters.keys()):
                        if k > lvl:
                            del current_counters[k]
                    if lvl <= 1:
                        indent = "\t"
                        prefix = f"{cnt}. "
                    else:
                        indent = "\t\t"
                        char = chr(ord("a") + cnt - 1) if cnt <= 26 else f"{cnt}."
                        prefix = f"{char}. "
                    protocol_blocks.append(f"{indent}{prefix}{clean}")
                else:
                    for k in list(current_counters.keys()):
                        if k > depth:
                            del current_counters[k]
                    indent = "\t" * depth if depth > 0 else ""
                    protocol_blocks.append(f"{indent}{clean}")
            elif stage == "results":
                indent = "\t" * depth if depth > 0 else ""
                results_lines.append(f"{indent}{clean}")

        for child in e:
            if isinstance(child, note.OutlineElement):
                walk(child, depth + 1)

    for o in page.GetChildNodes(note.Outline):
        for c in o:
            if isinstance(c, note.OutlineElement):
                walk(c, 0)

    # Purpose / Expected results extraction from design section
    purpose_lines = []
    expected_lines = []
    clean_design = []

    for dline in design_lines:
        dl_lower = dline.lower()
        if "expect" in dl_lower or "hope to see" in dl_lower:
            expected_lines.append(dline.strip())
        elif "purpose" in dl_lower or "goal" in dl_lower or "overview" in dl_lower:
            purpose_lines.append(dline.strip())
        else:
            clean_design.append(dline)

    protocol_text = "\n".join(protocol_blocks).strip()
    design_text = "\n".join(clean_design).strip()
    results_text = "\n".join(results_lines).strip()
    purpose_text = "\n".join(purpose_lines).strip()
    expected_text = "\n".join(expected_lines).strip()
    full_notes = "\n".join(all_page_lines).strip()

    return {
        "purpose": purpose_text,
        "expected_results": expected_text,
        "experimental_design": design_text,
        "experimental_protocol": protocol_text,
        "data_acquisition": "",
        "data_analysis": "",
        "results": results_text,
        "notes": full_notes,
        "start_date": first_iso or "",
        "end_date": last_iso or "",
    }



def process_images_and_files(
    page: note.Page,
    upload_dir: Path,
    exp_id: str,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Extracts all images and attached files from a OneNote page, saves them to upload_dir,

    processes scientific previews (TIFF, EMF -> PNG), and returns ELN block dicts.
    """
    blocks: List[Dict[str, Any]] = []
    file_attachments: List[str] = []

    # 1. Process Images
    images = list(page.GetChildNodes(note.Image))
    for i, im in enumerate(images):
        raw_bytes = im.Bytes
        if not raw_bytes or len(raw_bytes) == 0:
            continue

        orig_filename = getattr(im, "FileName", "") or f"image_{i+1}.png"
        clean_name = re.sub(r"[^\w\-.]", "_", orig_filename)
        base_name, ext = os.path.splitext(clean_name)
        ext = ext.lower()

        unique_prefix = f"one_{exp_id}_{i+1}_{uuid.uuid4().hex[:6]}"

        # Handle EMF / WMF files by converting to PNG
        if ext in (".emf", ".wmf", ""):
            try:
                pil_img = Image.open(io.BytesIO(raw_bytes))
                png_name = f"{unique_prefix}_{base_name}.png"
                png_path = upload_dir / png_name
                # Avoid decompression bomb limits for legitimate large vector scans
                Image.MAX_IMAGE_PIXELS = None
                pil_img.save(png_path, format="PNG")

                w, h = pil_img.size
                blocks.append({
                    "type": "img",
                    "name": f"{base_name} (PNG)",
                    "src": f"/uploads/{png_name}",
                    "preview_url": f"/uploads/{png_name}",
                    "raw_url": f"/uploads/{png_name}",
                    "format": "PNG (from EMF)",
                    "metadata": {"width": w, "height": h, "channels": 3},
                })
                continue
            except Exception as e:
                print(f"[WARN] Failed to convert EMF {orig_filename}: {e}")

        # Normal file save (PNG, JPG, TIFF)
        target_name = f"{unique_prefix}_{clean_name}"
        target_path = upload_dir / target_name

        try:
            with open(target_path, "wb") as f:
                f.write(raw_bytes)

            # Use app's image processor for scientific formats (e.g. 16-bit TIFF)
            preview_url, metadata = process_uploaded_file(target_path, upload_dir)
            raw_url = f"/uploads/{target_name}"
            display_url = preview_url if preview_url else raw_url

            fmt_name = "TIFF" if ext in (".tif", ".tiff") else (ext.replace(".", "").upper() or "IMG")

            blocks.append({
                "type": "img",
                "name": orig_filename,
                "src": display_url,
                "preview_url": preview_url,
                "raw_url": raw_url,
                "format": fmt_name,
                "metadata": metadata if metadata else None,
            })
        except Exception as e:
            print(f"[ERROR] Failed to save image {orig_filename}: {e}")

    # 2. Process Attached Files (PDFs, raw data)
    attached_files = list(page.GetChildNodes(note.AttachedFile))
    for fi, af in enumerate(attached_files):
        f_bytes = getattr(af, "Bytes", None)
        if not f_bytes:
            continue
        f_name = getattr(af, "FileName", "") or f"attachment_{fi+1}.bin"
        clean_name = re.sub(r"[^\w\-.]", "_", f_name)
        target_name = f"one_att_{exp_id}_{fi+1}_{clean_name}"
        target_path = upload_dir / target_name
        try:
            with open(target_path, "wb") as f:
                f.write(f_bytes)
            file_attachments.append(f"[{f_name}](/uploads/{target_name})")
        except Exception as e:
            print(f"[ERROR] Failed to save attachment {f_name}: {e}")

    return blocks, file_attachments


def process_tables(page: note.Page) -> List[Dict[str, Any]]:
    """Extracts tables from a OneNote page and returns TableBlock dicts."""
    table_blocks: List[Dict[str, Any]] = []
    tables = list(page.GetChildNodes(note.Table))
    for ti, t in enumerate(tables):
        rows = list(t.GetChildNodes(note.TableRow))
        tbl_rows = []
        for r in rows:
            cells = [
                (" ".join(c.Text for c in cell.GetChildNodes(note.RichText))).strip()
                for cell in r.GetChildNodes(note.TableCell)
            ]
            tbl_rows.append(cells)

        if tbl_rows:
            # First row might serve as name if descriptive
            table_name = "Quantification Table" if ti == 0 else f"Data Table {ti+1}"
            table_blocks.append({
                "type": "tbl",
                "name": table_name,
                "rows": tbl_rows,
            })

    return table_blocks


def build_cohesin_ips_dag(experiments_meta: List[Dict[str, Any]]) -> None:
    """Computes logical scientific workflow DAG dependencies and assigns flowchart canvas coordinates (px, py) for Cohesin IPs."""
    by_pattern: Dict[str, str] = {}
    for em in experiments_meta:
        t = em["title"].lower()
        if "overview" in t:
            by_pattern["overview"] = em["id"]
        elif "target planning" in t:
            by_pattern["target_planning"] = em["id"]
        elif "rad21 ip 1" in t or "rad21 ip 1 (pilot)" in t:
            by_pattern["rad21_ip1"] = em["id"]
        elif "dna damage pilot wb" in t:
            by_pattern["dna_damage_wb"] = em["id"]
        elif "chaps lysis" in t:
            by_pattern["chaps_wb"] = em["id"]
        elif "sonication and sds" in t:
            by_pattern["sonication_wb"] = em["id"]
        elif "yh2a.x" in t:
            by_pattern["yh2ax_wb"] = em["id"]
        elif "rad21 ip 2" in t and "restain" not in t:
            by_pattern["rad21_ip2"] = em["id"]
        elif "rad21 ip3" in t and "restain" not in t:
            by_pattern["rad21_ip3"] = em["id"]
        elif "gel chemistry wb" in t:
            by_pattern["gel_chem_wb"] = em["id"]
        elif "rad21 ip4" in t and "restain" not in t:
            by_pattern["rad21_ip4"] = em["id"]
        elif "ip2 restain" in t:
            by_pattern["ip2_restain"] = em["id"]
        elif "ip3 rad21 blot pp4" in t:
            by_pattern["ip3_pp4_restain"] = em["id"]
        elif "ip2, ip4, gel chem pp4" in t:
            by_pattern["combined_restain"] = em["id"]
        elif "smc3 wt nave total drg ip1" in t or "nave total drg ip1" in t:
            by_pattern["smc3_drg_ip1"] = em["id"]
        elif "rad21 short ip1" in t:
            by_pattern["rad21_short_ip1"] = em["id"]
        elif "mass spec planning" in t:
            by_pattern["ms_planning"] = em["id"]
        elif "smc3 drg ip2" in t:
            by_pattern["smc3_drg_ip2"] = em["id"]
        elif "smc3 drg ip3" in t:
            by_pattern["smc3_drg_ip3"] = em["id"]
        elif "cohesin solubilization" in t:
            by_pattern["solubilization"] = em["id"]
        elif "active motif" in t:
            by_pattern["active_motif"] = em["id"]
        elif "drg nuclear smc3 ip 1" in t:
            by_pattern["nuclear_smc3_ip1"] = em["id"]
        elif "crosslink cortex" in t:
            by_pattern["crosslink_cortex"] = em["id"]
        elif "drg nuclear smc3 crosslinked ip 1 (ms 1)" in t:
            by_pattern["nuclear_crosslink_ms1"] = em["id"]
        elif "drg nuclear smc3 crosslinked ip 2" in t:
            by_pattern["nuclear_crosslink_wb2"] = em["id"]
        elif "[planned] drg nuclear smc3 crosslinked ip snc" in t:
            by_pattern["planned_snc_wb"] = em["id"]
        elif "[planned] acetyl and phospho" in t:
            by_pattern["planned_acetyl_wb"] = em["id"]

    dep_rules = [
        ("target_planning", ["overview"]),
        ("rad21_ip1", ["overview"]),
        ("dna_damage_wb", ["rad21_ip1"]),
        ("chaps_wb", ["dna_damage_wb"]),
        ("sonication_wb", ["chaps_wb"]),
        ("yh2ax_wb", ["chaps_wb"]),
        ("rad21_ip2", ["chaps_wb"]),
        ("rad21_ip3", ["rad21_ip2"]),
        ("gel_chem_wb", ["rad21_ip3"]),
        ("rad21_ip4", ["gel_chem_wb"]),
        ("ip2_restain", ["rad21_ip2"]),
        ("ip3_pp4_restain", ["rad21_ip3"]),
        ("combined_restain", ["rad21_ip4"]),
        ("smc3_drg_ip1", ["rad21_ip2"]),
        ("rad21_short_ip1", ["rad21_ip4"]),
        ("ms_planning", ["rad21_short_ip1"]),
        ("smc3_drg_ip2", ["smc3_drg_ip1", "ms_planning"]),
        ("smc3_drg_ip3", ["smc3_drg_ip2"]),
        ("solubilization", ["smc3_drg_ip3"]),
        ("active_motif", ["solubilization"]),
        ("nuclear_smc3_ip1", ["active_motif"]),
        ("crosslink_cortex", ["nuclear_smc3_ip1"]),
        ("nuclear_crosslink_ms1", ["crosslink_cortex"]),
        ("nuclear_crosslink_wb2", ["nuclear_crosslink_ms1"]),
        ("planned_snc_wb", ["nuclear_crosslink_wb2"]),
        ("planned_acetyl_wb", ["planned_snc_wb"]),
    ]

    deps_by_id: Dict[str, List[str]] = {}
    for child_key, parent_keys in dep_rules:
        child_id = by_pattern.get(child_key)
        if child_id:
            parent_ids = [by_pattern[pk] for pk in parent_keys if pk in by_pattern]
            deps_by_id[child_id] = parent_ids

    col_width = 300
    row_height = 100
    base_x = 40
    base_y = 40

    stage_columns = [
        ["overview", "target_planning", "rad21_ip1", "dna_damage_wb"],
        ["chaps_wb", "sonication_wb", "yh2ax_wb", "rad21_ip2", "rad21_ip3"],
        ["gel_chem_wb", "rad21_ip4", "ip2_restain", "ip3_pp4_restain", "combined_restain"],
        ["smc3_drg_ip1", "rad21_short_ip1", "ms_planning", "smc3_drg_ip2", "smc3_drg_ip3"],
        ["solubilization", "active_motif", "nuclear_smc3_ip1", "crosslink_cortex", "nuclear_crosslink_ms1", "nuclear_crosslink_wb2"],
        ["planned_snc_wb", "planned_acetyl_wb"],
    ]

    placed_ids = set()
    for col_idx, col_keys in enumerate(stage_columns):
        for row_idx, key in enumerate(col_keys):
            eid = by_pattern.get(key)
            if eid:
                for em in experiments_meta:
                    if em["id"] == eid:
                        em["px"] = float(base_x + col_idx * col_width)
                        em["py"] = float(base_y + row_idx * row_height)
                        em["deps"] = deps_by_id.get(eid, [])
                        placed_ids.add(eid)

    unplaced_col = len(stage_columns)
    unplaced_row = 0
    for em in experiments_meta:
        if em["id"] not in placed_ids:
            em["px"] = float(base_x + unplaced_col * col_width)
            em["py"] = float(base_y + unplaced_row * row_height)
            em["deps"] = []
            unplaced_row += 1


def build_nipbl_modulation_dag(experiments_meta: List[Dict[str, Any]]) -> None:
    """Computes logical scientific workflow DAG dependencies and assigns flowchart canvas coordinates (px, py) for NIPBL Modulation."""
    by_pattern: Dict[str, str] = {}
    for em in experiments_meta:
        t = em["title"].lower()
        if "summer 2026" in t:
            by_pattern["summer_planning"] = em["id"]
        elif "r01 nov" in t:
            by_pattern["r01_planning"] = em["id"]
        elif "manuscript planning" in t:
            by_pattern["ms_planning"] = em["id"]
        elif "project story" in t:
            by_pattern["project_story"] = em["id"]
        elif "pantelis" in t:
            by_pattern["pantelis_call"] = em["id"]
        elif "viral redesign" in t:
            by_pattern["viral_redesign"] = em["id"]
        elif "fplc 2" in t:
            by_pattern["fplc2"] = em["id"]
        elif "virus validation in vivo 5/2026" in t:
            by_pattern["virus_val_526"] = em["id"]
        elif "inducible expression" in t:
            by_pattern["inducible_expr"] = em["id"]
        elif "nipbl activation 1" in t:
            by_pattern["act_1"] = em["id"]
        elif "nipbl activation 2" in t:
            by_pattern["act_2"] = em["id"]
        elif "nipbl activation 3" in t:
            by_pattern["act_3"] = em["id"]
        elif "nipbl activation 4" in t:
            by_pattern["act_4"] = em["id"]
        elif "nipbl act/rad21 ko 2" in t:
            by_pattern["act_rad21_2"] = em["id"]
        elif "nipbl act/rad21 ko" in t:
            by_pattern["act_rad21_1"] = em["id"]
        elif "smc kd + nipbl ur in vitro 1" in t:
            by_pattern["smc_kd_nipbl"] = em["id"]
        elif "miltenyi nuclei" in t:
            by_pattern["miltenyi_nuclei"] = em["id"]
        elif "cas9 injection for flow" in t:
            by_pattern["cas9_flow"] = em["id"]
        elif "cut&run antibody testing" in t:
            by_pattern["cutrun_ab_test"] = em["id"]
        elif "nipbl antibody testing" in t:
            by_pattern["nipbl_ab_test"] = em["id"]
        elif "baseline expression rt-qpcr" in t:
            by_pattern["baseline_qpcr"] = em["id"]
        elif "baseline expression wb" in t:
            by_pattern["baseline_wb"] = em["id"]
        elif "nipbl ur in vitro" in t:
            by_pattern["ur_invitro_qpcr"] = em["id"]
        elif "nipbl ur in vivo 4" in t or "1 dpi snc" in t:
            by_pattern["ur_invivo_4"] = em["id"]
        elif "nipbl ur in vivo 1" in t or ("3 dpi snc" in t and "rnaseq" not in t and "cut&run" not in t):
            by_pattern["ur_invivo_1"] = em["id"]
        elif "nipbl ur in vivo 2" in t or ("3 dpi dha" in t and "rnaseq" not in t):
            by_pattern["ur_invivo_2"] = em["id"]
        elif "nipbl ur in vivo 5" in t or "3 dpi snc rnaseq" in t:
            by_pattern["ur_invivo_5_rnaseq"] = em["id"]
        elif "nipbl ur in vivo 6" in t:
            by_pattern["ur_invivo_6_qpcr"] = em["id"]
        elif "nipbl ur in vivo 3" in t or ("28 dpi snc" in t and "planned" not in t):
            by_pattern["ur_invivo_3_regen"] = em["id"]
        elif "[planned] nipbl ur in vivo (21 or 28 dpi" in t:
            by_pattern["planned_snc_recovery"] = em["id"]
        elif "[planned] nipbl ur in vivo (35 dpi dca" in t:
            by_pattern["planned_dca_recovery"] = em["id"]
        elif "[planned] nipbl ur in vivo (3 dpi dha rnaseq)" in t:
            by_pattern["planned_dha_rnaseq"] = em["id"]
        elif "[planned] nipbl ur in vivo (3 dpi snc cut&run" in t:
            by_pattern["planned_cutrun"] = em["id"]

    dep_rules = [
        ("fplc2", ["viral_redesign"]),
        ("virus_val_526", ["fplc2"]),
        ("act_2", ["act_1"]),
        ("act_3", ["act_2"]),
        ("act_4", ["act_3"]),
        ("act_rad21_1", ["act_4"]),
        ("act_rad21_2", ["act_rad21_1"]),
        ("smc_kd_nipbl", ["act_rad21_2"]),
        ("cutrun_ab_test", ["miltenyi_nuclei"]),
        ("nipbl_ab_test", ["cutrun_ab_test"]),
        ("ur_invivo_1", ["ur_invivo_4"]),
        ("ur_invivo_2", ["ur_invivo_1"]),
        ("ur_invitro_qpcr", ["ur_invivo_1"]),
        ("ur_invivo_5_rnaseq", ["ur_invivo_1"]),
        ("ur_invivo_6_qpcr", ["ur_invivo_1"]),
        ("ur_invivo_3_regen", ["ur_invivo_1"]),
        ("planned_snc_recovery", ["ur_invivo_3_regen"]),
        ("planned_dca_recovery", ["ur_invivo_2"]),
        ("planned_dha_rnaseq", ["ur_invivo_2"]),
        ("planned_cutrun", ["ur_invivo_1", "cutrun_ab_test"]),
    ]

    deps_by_id: Dict[str, List[str]] = {}
    for child_key, parent_keys in dep_rules:
        child_id = by_pattern.get(child_key)
        if child_id:
            parent_ids = [by_pattern[pk] for pk in parent_keys if pk in by_pattern]
            deps_by_id[child_id] = parent_ids

    col_width = 300
    row_height = 100
    base_x = 40
    base_y = 40

    stage_columns = [
        ["summer_planning", "r01_planning", "ms_planning", "project_story", "pantelis_call"],
        ["viral_redesign", "fplc2", "virus_val_526", "inducible_expr"],
        ["act_1", "act_2", "act_3", "act_4", "act_rad21_1", "act_rad21_2", "smc_kd_nipbl"],
        ["miltenyi_nuclei", "cutrun_ab_test", "cas9_flow", "nipbl_ab_test", "baseline_qpcr", "baseline_wb"],
        ["ur_invivo_4", "ur_invivo_1", "ur_invivo_2", "ur_invitro_qpcr", "ur_invivo_6_qpcr", "ur_invivo_5_rnaseq"],
        ["ur_invivo_3_regen", "planned_snc_recovery", "planned_dca_recovery", "planned_dha_rnaseq", "planned_cutrun"],
    ]

    placed_ids = set()
    for col_idx, col_keys in enumerate(stage_columns):
        for row_idx, key in enumerate(col_keys):
            eid = by_pattern.get(key)
            if eid:
                for em in experiments_meta:
                    if em["id"] == eid:
                        em["px"] = float(base_x + col_idx * col_width)
                        em["py"] = float(base_y + row_idx * row_height)
                        em["deps"] = deps_by_id.get(eid, [])
                        placed_ids.add(eid)

    unplaced_col = len(stage_columns)
    unplaced_row = 0
    for em in experiments_meta:
        if em["id"] not in placed_ids:
            em["px"] = float(base_x + unplaced_col * col_width)
            em["py"] = float(base_y + unplaced_row * row_height)
            em["deps"] = []
            unplaced_row += 1


def build_nuclear_energetics_dag(experiments_meta: List[Dict[str, Any]]) -> None:
    """Computes logical scientific workflow DAG dependencies and assigns flowchart canvas coordinates (px, py) for Nuclear Energetics."""
    by_pattern: Dict[str, str] = {}
    for em in experiments_meta:
        t = em["title"].lower()
        if "background" in t:
            by_pattern["background"] = em["id"]
        elif "supplies" in t:
            by_pattern["supplies"] = em["id"]
        elif "ngp order" in t:
            by_pattern["ngp_order"] = em["id"]
        elif "snc/sham surgeries" in t:
            by_pattern["snc_surgeries"] = em["id"]
        elif "sci/lam surgeries" in t:
            by_pattern["sci_surgeries"] = em["id"]
        elif "in vitro kcl stimulation (for nudt5 wb)" in t:
            by_pattern["kcl_wb"] = em["id"]
        elif "in vitro kcl stimulation (for icc)" in t:
            by_pattern["kcl_icc"] = em["id"]
        elif "in vitro" in t and "kcl" not in t:
            by_pattern["in_vitro"] = em["id"]
        elif "brooke nudt5 wb 1" in t:
            by_pattern["brooke_wb1"] = em["id"]
        elif "brooke nudt5 wb 2" in t:
            by_pattern["brooke_wb2"] = em["id"]
        elif "nudt5, nipbl" in t or "validation wb" in t:
            by_pattern["val_wb"] = em["id"]
        elif "nudt5 ab wb test" in t:
            by_pattern["wb_restain"] = em["id"]
        elif "demo if staining" in t:
            by_pattern["demo_if"] = em["id"]
        elif "brooke practice if 1" in t:
            by_pattern["brooke_if1"] = em["id"]
        elif "tomm20 [rb abcam]" in t:
            by_pattern["tomm20_rb"] = em["id"]
        elif "tomm20 [ms santa cruz]" in t:
            by_pattern["tomm20_ms"] = em["id"]
        elif "mitotracker" in t:
            by_pattern["mitotracker"] = em["id"]
        elif "nudt5 activation/inhibition in vitro 1" in t:
            by_pattern["act_inhib_1"] = em["id"]
        elif "nudt5 inhibition/nudt5 activation" in t:
            by_pattern["nudt5_inhib_act"] = em["id"]
        elif "nudt5 expression datasets" in t:
            by_pattern["expr_datasets"] = em["id"]

    dep_rules = [
        ("sci_surgeries", ["snc_surgeries"]),
        ("kcl_wb", ["in_vitro", "snc_surgeries"]),
        ("kcl_icc", ["in_vitro"]),
        ("brooke_wb2", ["brooke_wb1"]),
        ("val_wb", ["brooke_wb2"]),
        ("wb_restain", ["val_wb"]),
        ("brooke_if1", ["demo_if"]),
        ("tomm20_rb", ["kcl_icc"]),
        ("tomm20_ms", ["tomm20_rb"]),
        ("mitotracker", ["tomm20_ms"]),
        ("nudt5_inhib_act", ["act_inhib_1"]),
        ("expr_datasets", ["nudt5_inhib_act"]),
    ]

    deps_by_id: Dict[str, List[str]] = {}
    for child_key, parent_keys in dep_rules:
        child_id = by_pattern.get(child_key)
        if child_id:
            parent_ids = [by_pattern[pk] for pk in parent_keys if pk in by_pattern]
            deps_by_id[child_id] = parent_ids

    col_width = 300
    row_height = 100
    base_x = 40
    base_y = 40

    stage_columns = [
        ["background", "supplies", "ngp_order"],
        ["snc_surgeries", "sci_surgeries", "in_vitro"],
        ["kcl_wb", "kcl_icc"],
        ["brooke_wb1", "brooke_wb2", "val_wb", "wb_restain"],
        ["demo_if", "brooke_if1", "tomm20_rb", "tomm20_ms", "mitotracker"],
        ["act_inhib_1", "nudt5_inhib_act", "expr_datasets"],
    ]

    placed_ids = set()
    for col_idx, col_keys in enumerate(stage_columns):
        for row_idx, key in enumerate(col_keys):
            eid = by_pattern.get(key)
            if eid:
                for em in experiments_meta:
                    if em["id"] == eid:
                        em["px"] = float(base_x + col_idx * col_width)
                        em["py"] = float(base_y + row_idx * row_height)
                        em["deps"] = deps_by_id.get(eid, [])
                        placed_ids.add(eid)

    unplaced_col = len(stage_columns)
    unplaced_row = 0
    for em in experiments_meta:
        if em["id"] not in placed_ids:
            em["px"] = float(base_x + unplaced_col * col_width)
            em["py"] = float(base_y + unplaced_row * row_height)
            em["deps"] = []
            unplaced_row += 1


def build_default_dag(experiments_meta: List[Dict[str, Any]]) -> None:
    """Arranges experiments into a neat multi-column grid layout."""
    col_width = 300
    row_height = 100
    base_x = 40
    base_y = 40
    num_cols = 4

    for idx, em in enumerate(experiments_meta):
        col = idx % num_cols
        row = idx // num_cols
        em["px"] = float(base_x + col * col_width)
        em["py"] = float(base_y + row * row_height)
        em["deps"] = []


def build_dag_dependencies_and_coords(experiments_meta: List[Dict[str, Any]], project_name: str = "Cohesin IPs") -> None:
    """Computes logical scientific workflow DAG dependencies and assigns flowchart canvas coordinates (px, py)."""
    pn = project_name.lower()
    if "cohesin" in pn:
        build_cohesin_ips_dag(experiments_meta)
    elif "nipbl" in pn:
        build_nipbl_modulation_dag(experiments_meta)
    elif "energetics" in pn or "nudt" in pn:
        build_nuclear_energetics_dag(experiments_meta)
    else:
        build_default_dag(experiments_meta)


def import_onenote_section(
    section_file_path: str = DEFAULT_ONENOTE_SECTION,
    project_name: str = "Cohesin IPs",
    session: Optional[Session] = None,
    upload_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Imports the specified OneNote section file into the application database as a Project."""
    section_path = Path(section_file_path)
    if not section_path.exists():
        raise FileNotFoundError(f"OneNote section file not found at: {section_file_path}")

    if upload_dir is None:
        base_dir = Path(__file__).resolve().parent.parent
        upload_dir = base_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading OneNote section: {section_path}")
    doc = note.Document(str(section_path))
    pages = list(doc.GetChildNodes(note.Page))
    print(f"Found {len(pages)} pages in section '{project_name}'")

    project_id = f"proj-{gen_uid(7)}"

    experiments_meta: List[Dict[str, Any]] = []

    for idx, p in enumerate(pages):
        raw_title = p.Title.TitleText.Text if (p.Title and p.Title.TitleText) else f"Page {idx+1}"
        title = raw_title.strip()
        title_date = p.Title.TitleDate.Text if (p.Title and p.Title.TitleDate) else ""
        title_time = p.Title.TitleTime.Text if (p.Title and p.Title.TitleTime) else ""

        exp_id = gen_uid(7)

        # 1. Extract structured sections (dated protocol, design, results, dates)
        sec_data = extract_page_sections(p)

        # 2. Process images and attachments
        img_blocks, file_attachments = process_images_and_files(p, upload_dir, exp_id)

        # Append attachment download links to notes if present
        if file_attachments:
            sec_data["notes"] += "\n\n### Attached Files:\n" + "\n".join(f"- {fa}" for fa in file_attachments)

        # 4. Process tables
        tbl_blocks = process_tables(p)

        # Combine blocks (images first, then tables)
        all_blocks = img_blocks + tbl_blocks

        # 5. Determine status and priority
        tl = title.lower()
        if "[planned]" in tl or "planned" in tl:
            status = "Planned"
            priority = "High" if ("ms" in tl or "smc3" in tl or "recovery" in tl or "rnaseq" in tl or "cut&run" in tl) else "Med"
            exp_completed = False
            acq_completed = False
            analysis_completed = False
        elif "planning" in tl or "overview" in tl or "supplies" in tl or "background" in tl or "order" in tl or "call with" in tl:
            status = "Planning"
            priority = "Med"
            exp_completed = False
            acq_completed = False
            analysis_completed = False
        else:
            status = "Done"
            priority = "High" if ("in vivo" in tl or "rnaseq" in tl or "cut&run" in tl or "recovery" in tl or "ms" in tl or "crosslink" in tl or "solubilization" in tl or "fplc" in tl or "activation" in tl or "regeneration" in tl) else "Med"
            exp_completed = True
            acq_completed = True
            analysis_completed = True

        experiments_meta.append({
            "id": exp_id,
            "title": title,
            "status": status,
            "priority": priority,
            "date": title_date,
            "time": title_time,
            "sec_data": sec_data,
            "blocks": all_blocks,
            "exp_completed": exp_completed,
            "acq_completed": acq_completed,
            "analysis_completed": analysis_completed,
        })

    # Calculate DAG dependencies and (px, py) layout coordinates
    build_dag_dependencies_and_coords(experiments_meta, project_name)

    # Database insertion
    close_session_at_end = False
    if session is None:
        from app.database import engine
        session = Session(engine)
        close_session_at_end = True

    try:
        # Check if project already exists; if so, update or recreate
        existing_proj = session.exec(select(ProjectDB).where(ProjectDB.name == project_name)).first()
        if existing_proj:
            print(f"Project '{project_name}' already exists (id: {existing_proj.id}). Re-importing into existing project.")
            project_id = existing_proj.id
            from sqlmodel import delete
            # Remove old experiments and dependencies in this project
            old_exps = session.exec(select(ExperimentDB).where(ExperimentDB.project_id == project_id)).all()
            old_exp_ids = [oe.id for oe in old_exps]
            if old_exp_ids:
                for oid in old_exp_ids:
                    session.exec(delete(ExperimentDependencyDB).where(
                        (ExperimentDependencyDB.experiment_id == oid) | (ExperimentDependencyDB.depends_on_id == oid)
                    ))
                for oe in old_exps:
                    session.delete(oe)
                session.commit()
        else:
            proj_record = ProjectDB(
                id=project_id,
                name=project_name,
                archived=False,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            session.add(proj_record)
            session.commit()

        # Insert experiments
        for em in experiments_meta:
            has_protocol = bool(em["sec_data"]["experimental_protocol"])
            start_d = em["sec_data"]["start_date"] or em["date"]
            end_d = em["sec_data"]["end_date"] or em["date"]

            exp_rec = ExperimentDB(
                id=em["id"],
                project_id=project_id,
                name=em["title"],
                status=em["status"],
                priority=em["priority"],
                paper="",
                purpose=em["sec_data"]["purpose"],
                expected_results=em["sec_data"]["expected_results"],
                experimental_design=em["sec_data"]["experimental_design"],
                experimental_protocol=em["sec_data"]["experimental_protocol"],
                experimental_protocol_duration="Full Day" if has_protocol else "",
                experimental_protocol_completed=em["exp_completed"] if has_protocol else False,
                experimental_protocol_start_date=start_d if has_protocol else "",
                experimental_protocol_end_date=end_d if has_protocol else "",
                data_acquisition=em["sec_data"]["data_acquisition"],
                data_acquisition_duration="",
                data_acquisition_completed=em["acq_completed"],
                data_acquisition_start_date=start_d,
                data_acquisition_end_date=end_d,
                data_analysis=em["sec_data"]["data_analysis"],
                data_analysis_duration="",
                data_analysis_completed=em["analysis_completed"],
                data_analysis_start_date=end_d,
                data_analysis_end_date=end_d,
                results=em["sec_data"]["results"],
                notes=em["sec_data"]["notes"],
                phases=(
                    ["experimentalProtocol", "dataAcquisition", "dataAnalysis"]
                    if has_protocol
                    else ["dataAcquisition", "dataAnalysis"]
                ),
                blocks=em["blocks"],
                px=em.get("px", 40.0),
                py=em.get("py", 40.0),
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            session.add(exp_rec)

        session.commit()

        # Insert dependency links
        for em in experiments_meta:
            for dep_id in em.get("deps", []):
                dep_rec = ExperimentDependencyDB(
                    experiment_id=em["id"],
                    depends_on_id=dep_id,
                )
                session.add(dep_rec)

        session.commit()

        # Synchronize JSON state backup file
        try:
            base_dir = Path(__file__).resolve().parent.parent
            state_file = base_dir / "data" / "lab_state.json"
            current_state = get_lab_state(session)
            with open(state_file, "w", encoding="utf-8") as f:
                f.write(current_state.model_dump_json(indent=2))
            print(f"Synchronized JSON backup at {state_file}")
        except Exception as e:
            print(f"[WARN] Failed to update JSON state backup: {e}")

        print(f"Successfully imported {len(experiments_meta)} pages into project '{project_name}' (ID: {project_id})")

        return {
            "status": "success",
            "project_id": project_id,
            "project_name": project_name,
            "experiments_count": len(experiments_meta),
            "pages_imported": [em["title"] for em in experiments_meta],
        }

    finally:
        if close_session_at_end:
            session.close()


def import_cohesin_ips_section(
    section_file_path: str = DEFAULT_ONENOTE_SECTION,
    project_name: str = "Cohesin IPs",
    session: Optional[Session] = None,
    upload_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    return import_onenote_section(
        section_file_path=section_file_path,
        project_name=project_name,
        session=session,
        upload_dir=upload_dir,
    )


if __name__ == "__main__":
    import_cohesin_ips_section()
