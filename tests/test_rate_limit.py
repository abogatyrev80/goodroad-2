import time
import config


def _reset(device_id):
    config.rate_limit_store.pop(device_id, None)

def test_allows_up_to_limit():
    dev = "test-dev-1"
    _reset(dev)
    for _ in range(config.RATE_LIMIT_REQUESTS):
        assert config.check_rate_limit(dev) is True
    assert config.check_rate_limit(dev) is False
    _reset(dev)

def test_window_expiry(monkeypatch):
    dev = "test-dev-2"
    _reset(dev)
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() + config.RATE_LIMIT_WINDOW + 1)
    assert config.check_rate_limit(dev) is True
    _reset(dev)
