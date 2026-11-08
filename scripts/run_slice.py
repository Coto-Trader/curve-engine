"""Runner local sin instalar el paquete: `python scripts/run_slice.py`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from curve_engine.scripts_entry import run_slice  # noqa: E402

if __name__ == "__main__":
    run_slice()
