"""
Unified Neural Network Backend
Provides a single interface for inference across PyTorch (CPU/GPU), ONNX Runtime, and Remote GPU server.
"""

from __future__ import annotations

import json
import logging
import os
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

INFERENCE_BACKEND = os.getenv("NN_INFERENCE_BACKEND", "auto")
NN_DEVICE = os.getenv("NN_DEVICE", "auto")
REMOTE_GPU_URL = os.getenv("NN_REMOTE_GPU_URL", "")
REMOTE_GPU_TIMEOUT = float(os.getenv("NN_REMOTE_GPU_TIMEOUT", "5.0"))


def detect_device() -> str:
    """Auto-detect best available device."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0).lower()
            if "amd" in name or "radeon" in name or "rocm" in name:
                return "rocm"
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def resolve_device(preferred: Optional[str] = None) -> str:
    """Resolve device from config or auto-detect."""
    if preferred and preferred not in ("auto", ""):
        return preferred
    env_device = NN_DEVICE
    if env_device and env_device not in ("auto", ""):
        return env_device
    return detect_device()


class InferenceBackend(ABC):
    """Abstract base class for inference backends."""

    @abstractmethod
    def load(self, model_path: str, **kwargs) -> None:
        """Load model from path."""

    @abstractmethod
    def predict(self, window: np.ndarray) -> Tuple[int, float]:
        """Predict class index and confidence from window array (1, timesteps, 3)."""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if backend is ready for inference."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Backend name for logging."""


class PyTorchBackend(InferenceBackend):
    """PyTorch backend with auto CPU/GPU selection."""

    def __init__(self):
        self.model = None
        self.device = None
        self._available = False

    def load(self, model_path: str, **kwargs) -> None:
        import torch
        from accel_nn import AccelLSTM

        device_str = resolve_device(kwargs.get("device"))
        self.device = torch.device("cuda" if device_str in ("cuda", "rocm") and torch.cuda.is_available() else "cpu")

        ckpt = torch.load(model_path, map_location=self.device, weights_only=False)
        self.model = AccelLSTM().to(self.device)
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.eval()
        self._available = True

        logger.info(f"PyTorch backend loaded: device={self.device}, model={model_path}")

    def predict(self, window: np.ndarray) -> Tuple[int, float]:
        import torch

        if not self._available:
            raise RuntimeError("PyTorch backend not loaded")

        with torch.no_grad():
            x = torch.from_numpy(window).to(self.device)
            logits = self.model(x)
            probs = torch.softmax(logits, dim=1).cpu().numpy()[0]

        idx = int(np.argmax(probs))
        return idx, float(probs[idx])

    def is_available(self) -> bool:
        return self._available

    @property
    def name(self) -> str:
        return f"pytorch({self.device})"


class ONNXBackend(InferenceBackend):
    """ONNX Runtime backend for fast CPU inference."""

    def __init__(self):
        self.session = None
        self._available = False
        self.input_name = None

    def load(self, model_path: str, **kwargs) -> None:
        try:
            import onnxruntime as ort
        except ImportError:
            logger.warning("onnxruntime not installed, ONNX backend unavailable. Install: pip install onnxruntime")
            return

        providers = ["CPUExecutionProvider"]
        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self._available = True

        logger.info(f"ONNX backend loaded: model={model_path}, providers={providers}")

    def predict(self, window: np.ndarray) -> Tuple[int, float]:
        if not self._available:
            raise RuntimeError("ONNX backend not loaded")

        outputs = self.session.run(None, {self.input_name: window.astype(np.float32)})
        logits = outputs[0][0]
        probs = self._softmax(logits)
        idx = int(np.argmax(probs))
        return idx, float(probs[idx])

    def is_available(self) -> bool:
        return self._available

    @property
    def name(self) -> str:
        return "onnx"

    @staticmethod
    def _softmax(x: np.ndarray) -> np.ndarray:
        e_x = np.exp(x - np.max(x))
        return e_x / e_x.sum()


class RemoteBackend(InferenceBackend):
    """Remote GPU server backend via HTTP."""

    def __init__(self):
        self.base_url = REMOTE_GPU_URL
        self._available = False
        self.timeout = REMOTE_GPU_TIMEOUT

    def load(self, model_path: str = "", **kwargs) -> None:
        url = kwargs.get("remote_url") or self.base_url
        if not url:
            logger.warning("Remote backend: NN_REMOTE_GPU_URL not set")
            return
        self.base_url = url.rstrip("/")
        self._available = True
        logger.info(f"Remote backend configured: url={self.base_url}")

    def predict(self, window: np.ndarray) -> Tuple[int, float]:
        if not self._available:
            raise RuntimeError("Remote backend not configured")

        import urllib.request
        import urllib.error

        payload = json.dumps({"window": window.tolist()}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/predict",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                return result["class_index"], result["confidence"]
        except (urllib.error.URLError, TimeoutError) as e:
            logger.error(f"Remote inference failed: {e}")
            raise

    def is_available(self) -> bool:
        return self._available

    @property
    def name(self) -> str:
        return f"remote({self.base_url})"


class FallbackBackend(InferenceBackend):
    """Chain multiple backends with automatic fallback."""

    def __init__(self, backends: List[InferenceBackend]):
        self.backends = backends
        self.active: Optional[InferenceBackend] = None

    def load(self, model_path: str, **kwargs) -> None:
        for backend in self.backends:
            try:
                backend.load(model_path, **kwargs)
                if backend.is_available():
                    self.active = backend
                    logger.info(f"FallbackBackend: using {backend.name}")
                    return
            except Exception as e:
                logger.warning(f"FallbackBackend: {backend.name} failed to load: {e}")

        logger.error("FallbackBackend: no backends available")

    def predict(self, window: np.ndarray) -> Tuple[int, float]:
        if self.active is None:
            raise RuntimeError("No inference backend available")

        try:
            return self.active.predict(window)
        except Exception as e:
            logger.warning(f"Backend {self.active.name} failed: {e}, trying next...")
            for backend in self.backends:
                if backend is not self.active and backend.is_available():
                    try:
                        result = backend.predict(window)
                        self.active = backend
                        return result
                    except Exception:
                        continue
            raise RuntimeError("All inference backends failed")

    def is_available(self) -> bool:
        return self.active is not None and self.active.is_available()

    @property
    def name(self) -> str:
        return f"fallback({self.active.name if self.active else 'none'})"


def create_backend(backend: Optional[str] = None) -> InferenceBackend:
    """Create inference backend based on configuration.

    Backend selection:
    - "auto" or None: PyTorch -> ONNX -> Remote
    - "pytorch": PyTorch only
    - "onnx": ONNX only
    - "remote": Remote GPU server only
    """
    choice = backend or INFERENCE_BACKEND

    if choice == "pytorch":
        return PyTorchBackend()
    elif choice == "onnx":
        return ONNXBackend()
    elif choice == "remote":
        return RemoteBackend()
    elif choice == "auto" or choice == "":
        return FallbackBackend([
            PyTorchBackend(),
            ONNXBackend(),
            RemoteBackend(),
        ])
    else:
        logger.warning(f"Unknown backend '{choice}', using auto fallback")
        return FallbackBackend([
            PyTorchBackend(),
            ONNXBackend(),
            RemoteBackend(),
        ])
