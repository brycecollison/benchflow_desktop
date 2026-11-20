import os

import uvicorn

if __name__ == "__main__":
    os.environ["BENCHFLOW_DEV_SYNC"] = "1"  # phone sync server in this process (app/main.py)
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
