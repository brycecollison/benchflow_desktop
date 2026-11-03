from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import event

from app.paths import DATA_DIR, DB_PATH

DATA_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

# Journal mode chosen for the OneDrive-synced data folder, not for speed: a WAL file can
# be uploaded while the main .db is at a different moment, and the pair then opens as a
# "disk I/O error"/malformed database (seen with a 4.5 MB -wal next to a 700 KB .db).
# TRUNCATE folds every commit back into benchflow.db and leaves the log at 0 bytes once
# idle, so whatever OneDrive copies stays consistent. shortcut: fine for one writer; if
# autosave writes get slow, point BENCHFLOW_DATA_DIR (see app/paths.py) at an unsynced
# folder and go back to WAL.
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=TRUNCATE")
    cursor.execute("PRAGMA synchronous=FULL")
    cursor.close()

def init_db():
    SQLModel.metadata.create_all(engine)
    # Check and migrate columns for experiments table if SQLite DB was created prior
    with engine.connect() as conn:
        res = conn.exec_driver_sql("PRAGMA table_info(experiments)").fetchall()
        cols = {row[1] for row in res}
        new_cols = {
            "purpose": "TEXT DEFAULT ''",
            "expected_results": "TEXT DEFAULT ''",
            "experimental_design": "TEXT DEFAULT ''",
            "experimental_protocol": "TEXT DEFAULT ''",
            "experimental_protocol_duration": "TEXT DEFAULT ''",
            "experimental_protocol_completed": "INTEGER DEFAULT 0",
            "experimental_protocol_start_date": "TEXT DEFAULT ''",
            "experimental_protocol_end_date": "TEXT DEFAULT ''",
            "data_acquisition": "TEXT DEFAULT ''",
            "data_acquisition_duration": "TEXT DEFAULT ''",
            "data_acquisition_completed": "INTEGER DEFAULT 0",
            "data_acquisition_start_date": "TEXT DEFAULT ''",
            "data_acquisition_end_date": "TEXT DEFAULT ''",
            "data_analysis": "TEXT DEFAULT ''",
            "data_analysis_duration": "TEXT DEFAULT ''",
            "data_analysis_completed": "INTEGER DEFAULT 0",
            "data_analysis_start_date": "TEXT DEFAULT ''",
            "data_analysis_end_date": "TEXT DEFAULT ''",
            "results": "TEXT DEFAULT ''",
            "phases": "JSON DEFAULT NULL",
            "custom_phases": "JSON DEFAULT NULL",
        }
        for col_name, col_type in new_cols.items():
            if col_name not in cols:
                conn.exec_driver_sql(f"ALTER TABLE experiments ADD COLUMN {col_name} {col_type}")
        conn.commit()

def get_session():
    with Session(engine) as session:
        yield session
