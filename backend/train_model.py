#!/usr/bin/env python3
"""
Обучение LSTM-классификатора препятствий на RX 6800 XT (PyTorch + ROCm).

Примеры:
  python train_model.py --api-url https://goodroad.su --epochs 30
  python train_model.py --synthetic --epochs 10
  python train_model.py --mongo-url "$MONGO_URL" --db test_database
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from accel_nn import AccelClassifier, resolve_device
from ml_constants import DEFAULT_API_URL, INDEX_TO_EVENT
from ml_dataset import (
    generate_synthetic_samples,
    load_sequences_from_api,
    load_sequences_from_mongo,
    samples_to_arrays,
    train_val_test_split,
)
import torch


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train Good Road accelerometer LSTM")
    p.add_argument(
        "--api-url",
        nargs="?",
        const=DEFAULT_API_URL,
        default=None,
        metavar="URL",
        help=f"Загрузка с API (без URL = {DEFAULT_API_URL}; по умолчанию, если не --mongo/--synthetic)",
    )
    p.add_argument("--mongo", action="store_true", help="Загрузка из MongoDB")
    p.add_argument("--synthetic", action="store_true", help="Только синтетика")

    p.add_argument("--mongo-url", default=os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    p.add_argument(
        "--db",
        default=os.getenv("MONGO_DB_NAME", os.getenv("DB_NAME", "test_database")),
    )
    p.add_argument("--api-max-events", type=int, default=20000)
    p.add_argument("--api-max-raw", type=int, default=30000)
    p.add_argument("--output", default=os.getenv("NEURAL_MODEL_PATH", "models/accel_lstm.pt"))
    p.add_argument("--window-size", type=int, default=32)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--synthetic-per-class", type=int, default=200)
    p.add_argument("--days-back", type=int, default=None)
    p.add_argument("--limit-batches", type=int, default=5000)
    p.add_argument("--device", choices=("auto", "cpu", "cuda", "gpu"), default="auto")
    p.add_argument("--min-samples", type=int, default=100)
    return p.parse_args()


def _resolve_data_source(args: argparse.Namespace) -> str:
    if args.synthetic:
        return "synthetic"
    if args.mongo:
        return "mongo"
    return "api"


def _resolve_api_url(args: argparse.Namespace) -> str:
    if args.api_url is not None:
        return args.api_url or DEFAULT_API_URL
    return (
        os.getenv("GOODROAD_API_URL")
        or os.getenv("EXPO_PUBLIC_BACKEND_URL")
        or DEFAULT_API_URL
    )


def main() -> int:
    args = parse_args()
    source = _resolve_data_source(args)
    device = resolve_device(None if args.device == "auto" else args.device)

    print("=" * 60)
    print("Good Road — обучение LSTM")
    print("=" * 60)
    print(f"PyTorch:  {torch.__version__}")
    print(f"Источник: {source}")
    print(f"Device:   {device}", end="")
    if device.type == "cuda":
        print(f" ({torch.cuda.get_device_name(0)})")
    else:
        print()

    samples = []

    if source == "synthetic":
        print(f"\nСинтетический датасет ({args.synthetic_per_class} на класс)...")
        samples = generate_synthetic_samples(
            per_class=args.synthetic_per_class,
            window_size=args.window_size,
        )
    elif source == "api":
        api_url = _resolve_api_url(args)
        print(f"\nЗагрузка с API: {api_url}")
        try:
            samples = load_sequences_from_api(
                api_url=api_url,
                window_size=args.window_size,
                max_events=args.api_max_events,
                max_raw=args.api_max_raw,
            )
        except Exception as exc:
            print(f"API недоступен: {exc}", file=sys.stderr)
            return 1
    else:
        print(f"\nЗагрузка из MongoDB: {args.mongo_url} / {args.db}")
        try:
            samples = asyncio.run(
                load_sequences_from_mongo(
                    args.mongo_url,
                    args.db,
                    window_size=args.window_size,
                    limit_batches=args.limit_batches,
                    days_back=args.days_back,
                )
            )
        except Exception as exc:
            print(f"MongoDB недоступна: {exc}", file=sys.stderr)
            return 1

    if len(samples) < args.min_samples:
        print(
            f"Мало данных ({len(samples)} < {args.min_samples}). "
            "Добавляю синтетику..."
        )
        samples.extend(
            generate_synthetic_samples(
                per_class=max(50, args.min_samples // 5),
                window_size=args.window_size,
            )
        )

    print(f"Всего окон: {len(samples)}")
    if len(samples) < args.min_samples:
        print(f"ERROR: нужно минимум {args.min_samples} окон", file=sys.stderr)
        return 1

    train_s, val_s, test_s = train_val_test_split(samples)
    x_train, y_train = samples_to_arrays(train_s)
    x_val, y_val = samples_to_arrays(val_s)
    x_test, y_test = samples_to_arrays(test_s)
    print(f"Split: train={len(train_s)} val={len(val_s)} test={len(test_s)}")

    clf = AccelClassifier(window_size=args.window_size, device=str(device))
    try:
        clf.train(
            x_train,
            y_train,
            x_val=x_val if len(x_val) else None,
            y_val=y_val if len(y_val) else None,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
        )
    except RuntimeError as exc:
        if device.type == "cuda" and "miopen" in str(exc).lower():
            print(f"\nGPU error ({exc}). Повтор на CPU...")
            clf = AccelClassifier(window_size=args.window_size, device="cpu")
            clf.train(
                x_train,
                y_train,
                x_val=x_val if len(x_val) else None,
                y_val=y_val if len(y_val) else None,
                epochs=args.epochs,
                batch_size=args.batch_size,
                lr=args.lr,
            )
        else:
            raise

    if len(test_s):
        correct = 0
        for window, label in test_s:
            series = [
                {"x": float(r[0]), "y": float(r[1]), "z": float(r[2])} for r in window
            ]
            pred, _ = clf.predict(series)
            if INDEX_TO_EVENT[label] == pred:
                correct += 1
        print(f"Test accuracy: {correct / len(test_s):.3f}")

    out = Path(args.output)
    clf.save(str(out))
    print(f"\nМодель сохранена: {out.resolve()}")
    print(f"Метаданные:       {out.with_suffix('.json').resolve()}")
    print("\nДля backend:")
    print(f"  export NEURAL_MODEL_PATH={out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
