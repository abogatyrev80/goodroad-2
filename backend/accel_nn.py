"""
PyTorch LSTM-классификатор акселерометра (обучение на ROCm / RX 6800 XT).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from ml_constants import INDEX_TO_EVENT, NUM_CLASSES


def _pad_or_trim_window(window: np.ndarray, size: int) -> np.ndarray:
    if window.shape[0] == size:
        return window
    if window.shape[0] > size:
        start = (window.shape[0] - size) // 2
        return window[start : start + size]
    pad = np.zeros((size - window.shape[0], 3), dtype=np.float32)
    return np.vstack([pad, window])


class AccelLSTM(nn.Module):
    def __init__(self, input_size: int = 3, hidden: int = 64, num_classes: int = NUM_CLASSES):
        super().__init__()
        # Dropout только в head: MIOpen на ROCm 7.x падает на LSTM+dropout (gfx1030).
        self.lstm1 = nn.LSTM(input_size, hidden, batch_first=True)
        self.lstm2 = nn.LSTM(hidden, hidden // 2, batch_first=True)
        self.head = nn.Sequential(
            nn.Linear(hidden // 2, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm1(x)
        out, _ = self.lstm2(out)
        return self.head(out[:, -1, :])


def resolve_device(preferred: Optional[str] = None) -> torch.device:
    if preferred == "cpu":
        return torch.device("cpu")
    if preferred in ("cuda", "gpu", "rocm") and torch.cuda.is_available():
        return torch.device("cuda")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def fit_scaler(x_train: np.ndarray) -> StandardScaler:
    """Нормализация по всем timesteps и осям."""
    flat = x_train.reshape(-1, 3)
    scaler = StandardScaler()
    scaler.fit(flat)
    return scaler


def apply_scaler(x: np.ndarray, scaler: StandardScaler) -> np.ndarray:
    shape = x.shape
    flat = x.reshape(-1, 3)
    scaled = scaler.transform(flat)
    return scaled.reshape(shape).astype(np.float32)


class AccelClassifier:
    """Обучение, сохранение и инференс (.pt + scaler + meta)."""

    def __init__(self, window_size: int = 32, device: Optional[str] = None):
        self.window_size = window_size
        self.device = resolve_device(device)
        self.model: Optional[AccelLSTM] = None
        self.scaler: Optional[StandardScaler] = None

    def train(
        self,
        x_train: np.ndarray,
        y_train: np.ndarray,
        x_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None,
        epochs: int = 50,
        batch_size: int = 32,
        lr: float = 1e-3,
    ) -> Dict[str, List[float]]:
        self.scaler = fit_scaler(x_train)
        x_train = apply_scaler(x_train, self.scaler)

        self.model = AccelLSTM().to(self.device)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        criterion = nn.CrossEntropyLoss()

        train_loader = DataLoader(
            TensorDataset(
                torch.from_numpy(x_train),
                torch.from_numpy(y_train).long(),
            ),
            batch_size=batch_size,
            shuffle=True,
        )

        val_loader = None
        if x_val is not None and len(x_val) > 0:
            x_val = apply_scaler(x_val, self.scaler)
            val_loader = DataLoader(
                TensorDataset(
                    torch.from_numpy(x_val),
                    torch.from_numpy(y_val).long(),
                ),
                batch_size=batch_size,
            )

        history: Dict[str, List[float]] = {"loss": [], "accuracy": [], "val_loss": [], "val_accuracy": []}

        for epoch in range(1, epochs + 1):
            self.model.train()
            running_loss = 0.0
            correct = 0
            total = 0
            for xb, yb in train_loader:
                xb = xb.to(self.device)
                yb = yb.to(self.device)
                optimizer.zero_grad()
                logits = self.model(xb)
                loss = criterion(logits, yb)
                loss.backward()
                optimizer.step()
                running_loss += loss.item() * len(xb)
                correct += (logits.argmax(1) == yb).sum().item()
                total += len(xb)

            train_loss = running_loss / max(total, 1)
            train_acc = correct / max(total, 1)
            history["loss"].append(train_loss)
            history["accuracy"].append(train_acc)

            val_loss, val_acc = 0.0, 0.0
            if val_loader:
                self.model.eval()
                v_loss, v_correct, v_total = 0.0, 0, 0
                with torch.no_grad():
                    for xb, yb in val_loader:
                        xb = xb.to(self.device)
                        yb = yb.to(self.device)
                        logits = self.model(xb)
                        loss = criterion(logits, yb)
                        v_loss += loss.item() * len(xb)
                        v_correct += (logits.argmax(1) == yb).sum().item()
                        v_total += len(xb)
                val_loss = v_loss / max(v_total, 1)
                val_acc = v_correct / max(v_total, 1)

            history["val_loss"].append(val_loss)
            history["val_accuracy"].append(val_acc)
            print(
                f"Epoch {epoch}/{epochs}  loss={train_loss:.4f} acc={train_acc:.3f}"
                + (f"  val_loss={val_loss:.4f} val_acc={val_acc:.3f}" if val_loader else "")
            )

        return history

    def predict(self, accelerometer_data: List[Dict]) -> Tuple[str, float]:
        if self.model is None or self.scaler is None:
            raise ValueError("Модель не загружена")

        arr = np.array(
            [[d["x"], d["y"], d["z"]] for d in accelerometer_data],
            dtype=np.float32,
        )
        if len(arr) < 1:
            return "unknown", 0.0

        window = _pad_or_trim_window(arr, self.window_size)
        window = apply_scaler(window[np.newaxis, ...], self.scaler)

        self.model.eval()
        with torch.no_grad():
            x = torch.from_numpy(window).to(self.device)
            logits = self.model(x)
            probs = torch.softmax(logits, dim=1).cpu().numpy()[0]

        idx = int(np.argmax(probs))
        return INDEX_TO_EVENT.get(idx, "unknown"), float(probs[idx])

    def save(self, path: str) -> None:
        if self.model is None or self.scaler is None:
            raise ValueError("Нечего сохранять — модель не обучена")
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "state_dict": self.model.state_dict(),
                "window_size": self.window_size,
                "scaler_mean": self.scaler.mean_.tolist(),
                "scaler_scale": self.scaler.scale_.tolist(),
            },
            p,
        )
        meta = {
            "window_size": self.window_size,
            "num_classes": NUM_CLASSES,
            "classes": list(INDEX_TO_EVENT.values()),
            "backend": "pytorch",
        }
        p.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    def load(self, path: str) -> None:
        p = Path(path)
        ckpt = torch.load(p, map_location=self.device, weights_only=False)
        self.window_size = int(ckpt.get("window_size", 32))
        self.model = AccelLSTM().to(self.device)
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.eval()

        self.scaler = StandardScaler()
        self.scaler.mean_ = np.array(ckpt["scaler_mean"], dtype=np.float64)
        self.scaler.scale_ = np.array(ckpt["scaler_scale"], dtype=np.float64)
        self.scaler.n_features_in_ = 3
