import pytest

from curve_engine.config import default_paths, load_curve_system


@pytest.fixture(scope="session")
def system():
    cfg, mkt = default_paths()
    return load_curve_system(cfg, mkt)
