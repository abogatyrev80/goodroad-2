import os
import json
import time
import logging
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from .model import AccelLSTM, detect_device
from .dataset_loader import (
    load_dataset_from_file, prepare_windows, normalize,
    split_data, encode_labels,
)

logger = logging.getLogger(__name__)


def train(dataset_path: str, output_dir: str, config: dict) -> dict:
    window_size = config.get("window_size", 32)
    num_classes = config.get("num_classes", 5)
    epochs = config.get("epochs", 50)
    batch_size = config.get("batch_size", 64)
    lr = config.get("lr", 1e-3)

    logger.info("Loading dataset from %s", dataset_path)
    data = load_dataset_from_file(dataset_path)
    logger.info("Loaded %d samples", len(data))

    X, y = prepare_windows(data, window_size)
    if len(X) == 0:
        return {"error": "No valid samples after preparation"}

    X_train, y_train, X_val, y_val, X_test, y_test = split_data(X, y)
    X_train, X_test, scaler = normalize(X_train, X_test)
    X_val, _, _ = normalize(X_val)

    y_train_enc = encode_labels(y_train)
    y_val_enc = encode_labels(y_val)
    y_test_enc = encode_labels(y_test)

    device = detect_device()
    logger.info("Training on device: %s", device)

    model = AccelLSTM(
        input_size=3, hidden_size=64,
        num_classes=num_classes, window_size=window_size,
    ).to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    train_ds = TensorDataset(
        torch.FloatTensor(X_train), torch.LongTensor(y_train_enc)
    )
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    val_ds = TensorDataset(
        torch.FloatTensor(X_val), torch.LongTensor(y_val_enc)
    )
    val_loader = DataLoader(val_ds, batch_size=batch_size)

    best_val_acc = 0.0
    best_state = None
    history = {"train_loss": [], "val_loss": [], "val_acc": []}

    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            out = model(xb)
            loss = criterion(out, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * xb.size(0)

        train_loss = total_loss / len(train_ds)

        model.eval()
        val_loss = 0.0
        correct = 0
        total = 0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb, yb = xb.to(device), yb.to(device)
                out = model(xb)
                val_loss += criterion(out, yb).item() * xb.size(0)
                pred = out.argmax(dim=1)
                correct += (pred == yb).sum().item()
                total += yb.size(0)

        val_loss /= max(len(val_ds), 1)
        val_acc = correct / max(total, 1)

        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        history["val_acc"].append(val_acc)

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        if (epoch + 1) % 10 == 0:
            logger.info("Epoch %d/%d  train_loss=%.4f  val_loss=%.4f  val_acc=%.3f",
                        epoch + 1, epochs, train_loss, val_loss, val_acc)

    if best_state:
        model.load_state_dict(best_state)

    model.eval()
    test_ds = TensorDataset(torch.FloatTensor(X_test), torch.LongTensor(y_test_enc))
    test_loader = DataLoader(test_ds, batch_size=batch_size)
    correct = 0
    total = 0
    with torch.no_grad():
        for xb, yb in test_loader:
            xb, yb = xb.to(device), yb.to(device)
            out = model(xb)
            pred = out.argmax(dim=1)
            correct += (pred == yb).sum().item()
            total += yb.size(0)
    test_acc = correct / max(total, 1)

    os.makedirs(output_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    model_id = f"gpu_{timestamp}"

    pt_path = os.path.join(output_dir, f"{model_id}.pt")
    torch.save({
        "state_dict": model.state_dict(),
        "window_size": window_size,
        "num_classes": num_classes,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
    }, pt_path)

    try:
        onnx_path = os.path.join(output_dir, f"{model_id}.onnx")
        dummy = torch.FloatTensor(np.zeros((1, window_size, 3), dtype=np.float32)).to(device)
        torch.onnx.export(model, dummy, onnx_path, input_names=["input"],
                          output_names=["output"], dynamic_axes={"input": {0: "batch"}})
    except Exception as e:
        logger.warning("ONNX export failed: %s", e)
        onnx_path = None

    meta = {
        "model_id": model_id,
        "pt_path": pt_path,
        "onnx_path": onnx_path,
        "accuracy": float(test_acc),
        "val_accuracy": float(best_val_acc),
        "train_loss": float(history["train_loss"][-1]),
        "epochs": epochs,
        "window_size": window_size,
        "num_classes": num_classes,
        "device": str(device),
        "params": model.count_params(),
        "history": history,
    }

    meta_path = os.path.join(output_dir, f"{model_id}.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    logger.info("Training complete: accuracy=%.3f val_accuracy=%.3f test_acc=%.3f",
                best_val_acc, best_val_acc, test_acc)

    return meta
