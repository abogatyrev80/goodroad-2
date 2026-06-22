import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from tensorflow import keras

from neural_classifier import NeuralAccelerometerClassifier


LABELS = ["pothole", "speed_bump", "bump", "braking", "vibration"]
LABEL_ALIASES = {
    "speedbump": "speed_bump",
    "speed-bump": "speed_bump",
}


def normalize_label(label: str) -> str:
    normalized = label.strip().lower()
    return LABEL_ALIASES.get(normalized, normalized)


def pad_or_trim(sequence: np.ndarray, target_len: int) -> np.ndarray:
    if len(sequence) == target_len:
        return sequence
    if len(sequence) > target_len:
        return sequence[:target_len]

    padded = np.zeros((target_len, sequence.shape[1]), dtype=np.float32)
    padded[: len(sequence)] = sequence
    return padded


def read_dataset(dataset_path: Path, seq_len: int) -> Tuple[np.ndarray, np.ndarray]:
    raw = json.loads(dataset_path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Dataset root must be a JSON array.")

    x_items: List[np.ndarray] = []
    y_items: List[int] = []
    skipped = 0

    for idx, sample in enumerate(raw):
        if not isinstance(sample, dict):
            skipped += 1
            continue

        label_raw = sample.get("label")
        accelerometer_data = sample.get("accelerometer_data")
        if not label_raw or not isinstance(accelerometer_data, list):
            skipped += 1
            continue

        label = normalize_label(str(label_raw))
        if label not in LABELS:
            skipped += 1
            continue

        try:
            seq = np.array(
                [[point["x"], point["y"], point["z"]] for point in accelerometer_data],
                dtype=np.float32,
            )
        except Exception as exc:
            print(f"Skipping invalid sample #{idx}: {exc}")
            skipped += 1
            continue

        if seq.ndim != 2 or seq.shape[1] != 3 or len(seq) == 0:
            skipped += 1
            continue

        x_items.append(pad_or_trim(seq, seq_len))
        y_items.append(LABELS.index(label))

    if not x_items:
        raise ValueError("No valid samples found in dataset.")

    x = np.array(x_items, dtype=np.float32)
    y = keras.utils.to_categorical(np.array(y_items), num_classes=len(LABELS))

    print(f"Loaded samples: {len(x_items)}")
    print(f"Skipped samples: {skipped}")
    print(f"X shape: {x.shape}, y shape: {y.shape}")
    return x, y


def split_train_validation(
    x: np.ndarray, y: np.ndarray, validation_ratio: float = 0.2
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    size = len(x)
    if size < 2:
        return x, y, x, y

    indices = np.arange(size)
    np.random.shuffle(indices)
    x_shuffled = x[indices]
    y_shuffled = y[indices]

    split_idx = max(1, int(size * (1.0 - validation_ratio)))
    split_idx = min(split_idx, size - 1)
    return (
        x_shuffled[:split_idx],
        y_shuffled[:split_idx],
        x_shuffled[split_idx:],
        y_shuffled[split_idx:],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train neural road event classifier")
    parser.add_argument(
        "--dataset",
        default="data/training_events.json",
        help="Path to dataset JSON (relative to backend/ or absolute).",
    )
    parser.add_argument(
        "--output",
        default="models/road_event_model.keras",
        help="Path to output model file (relative to backend/ or absolute).",
    )
    parser.add_argument(
        "--seq-len",
        type=int,
        default=64,
        help="Fixed sequence length for training (padding/trimming).",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    dataset_path = Path(args.dataset)
    output_path = Path(args.output)

    if not dataset_path.is_absolute():
        dataset_path = base_dir / dataset_path
    if not output_path.is_absolute():
        output_path = base_dir / output_path

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    x, y = read_dataset(dataset_path, seq_len=args.seq_len)
    x_train, y_train, x_val, y_val = split_train_validation(x, y)

    classifier = NeuralAccelerometerClassifier()
    classifier.create_model((x_train.shape[1], x_train.shape[2]))

    classifier.model.fit(
        x_train,
        y_train,
        epochs=35,
        batch_size=32,
        validation_data=(x_val, y_val),
        verbose=1,
    )

    classifier.save_model(str(output_path))
    print(f"Model saved to: {output_path}")


if __name__ == "__main__":
    main()
