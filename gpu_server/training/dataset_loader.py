import json
import httpx
import numpy as np
from typing import List, Dict, Tuple
from sklearn.preprocessing import StandardScaler


LABEL_MAP = {"wave": "speed_bump", "speedbump": "speed_bump"}
VALID_LABELS = {"pothole", "speed_bump", "bump", "braking", "vibration"}


def load_dataset_from_file(path: str) -> List[Dict]:
    with open(path, "r") as f:
        data = json.load(f)
    return data


async def download_dataset(main_url: str, api_key: str, dataset_id: str, tmp_dir: str = "/tmp") -> str:
    url = f"{main_url}/api/external/dataset/{dataset_id}/download"
    headers = {"X-Api-Key": api_key}
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
    path = f"{tmp_dir}/{dataset_id}.json"
    with open(path, "w") as f:
        f.write(resp.text)
    return path


def prepare_windows(data: List[Dict], window_size: int = 32) -> Tuple[np.ndarray, np.ndarray]:
    windows = []
    labels = []
    for sample in data:
        label = sample.get("label", "")
        label = LABEL_MAP.get(label, label)
        if label not in VALID_LABELS:
            continue
        accel = sample.get("accelerometer_data", [])
        if len(accel) < 3:
            continue
        points = [[p.get("x", 0), p.get("y", 0), p.get("z", 0)] for p in accel]
        arr = np.array(points, dtype=np.float32)
        win = _pad_or_trim(arr, window_size)
        windows.append(win)
        labels.append(label)
    if not windows:
        return np.array([]), np.array([])
    X = np.stack(windows)
    y = np.array(labels)
    return X, y


def _pad_or_trim(arr: np.ndarray, target_len: int) -> np.ndarray:
    if len(arr) >= target_len:
        return arr[:target_len]
    pad = np.zeros((target_len - len(arr), 3), dtype=np.float32)
    return np.vstack([arr, pad])


def normalize(X_train: np.ndarray, X_test: np.ndarray = None):
    shape = X_train.shape
    flat = X_train.reshape(-1, 3)
    scaler = StandardScaler()
    flat = scaler.fit_transform(flat)
    X_train = flat.reshape(shape)
    if X_test is not None:
        flat_test = X_test.reshape(-1, 3)
        flat_test = scaler.transform(flat_test)
        X_test = flat_test.reshape(X_test.shape)
    return X_train, X_test, scaler


def split_data(X: np.ndarray, y: np.ndarray, train_ratio=0.7, val_ratio=0.15):
    n = len(X)
    indices = np.random.permutation(n)
    train_end = int(n * train_ratio)
    val_end = int(n * (train_ratio + val_ratio))
    train_idx = indices[:train_end]
    val_idx = indices[train_end:val_end]
    test_idx = indices[val_end:]
    return X[train_idx], y[train_idx], X[val_idx], y[val_idx], X[test_idx], y[test_idx]


def encode_labels(labels: np.ndarray) -> np.ndarray:
    label_to_idx = {l: i for i, l in enumerate(sorted(VALID_LABELS))}
    return np.array([label_to_idx.get(l, 0) for l in labels])
