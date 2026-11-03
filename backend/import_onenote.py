"""CLI runner for importing OneNote section into Lab Planner & ELN."""

import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from app.onenote_importer import (
    import_onenote_section,
    COHESIN_IPS_SECTION,
    NIPBL_MODULATION_SECTION,
    NUCLEAR_ENERGETICS_SECTION,
)

def run_import(path: str, name: str):
    print(f"\n==========================================")
    print(f"Starting import: '{name}'")
    print(f"Source file: {path}")
    print(f"==========================================")
    result = import_onenote_section(section_file_path=path, project_name=name)
    print(f"\nImport completed successfully for '{name}'!")
    print(f"Project ID: {result['project_id']}")
    print(f"Total experiments imported: {result['experiments_count']}")
    for i, title in enumerate(result['pages_imported'], 1):
        print(f"  {i:2d}. {title}")
    return result

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        run_import(COHESIN_IPS_SECTION, "Cohesin IPs")
        run_import(NIPBL_MODULATION_SECTION, "NIPBL Modulation")
        run_import(NUCLEAR_ENERGETICS_SECTION, "Nuclear Energetics")
    elif len(sys.argv) > 1 and sys.argv[1] == "--nipbl":
        run_import(NIPBL_MODULATION_SECTION, "NIPBL Modulation")
    elif len(sys.argv) > 1 and sys.argv[1] == "--nuclear":
        run_import(NUCLEAR_ENERGETICS_SECTION, "Nuclear Energetics")
    elif len(sys.argv) > 1:
        sec_path = sys.argv[1]
        proj_name = sys.argv[2] if len(sys.argv) > 2 else "Imported Project"
        run_import(sec_path, proj_name)
    else:
        # Default imports both requested projects: NIPBL Modulation and Nuclear Energetics
        run_import(NIPBL_MODULATION_SECTION, "NIPBL Modulation")
        run_import(NUCLEAR_ENERGETICS_SECTION, "Nuclear Energetics")
