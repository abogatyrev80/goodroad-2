#!/usr/bin/env bash
# Создаёт venv и ставит PyTorch (ROCm) для обучения на AMD RX 6800 XT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${ROOT}/backend/.venv-ml"
PYTORCH_INDEX="${PYTORCH_ROCM_INDEX:-https://download.pytorch.org/whl/rocm6.4}"

echo "==> Good Road ML environment"
echo "    Project: ${ROOT}"
echo "    venv:    ${VENV}"

if ! command -v python3 >/dev/null; then
  echo "ERROR: python3 not found" >&2
  exit 1
fi

python3 -m venv "${VENV}"
# shellcheck disable=SC1091
source "${VENV}/bin/activate"

pip install --upgrade pip wheel
pip install -r "${ROOT}/backend/requirements-ml.txt"

echo "==> Installing PyTorch (ROCm) from ${PYTORCH_INDEX}"
pip install torch --index-url "${PYTORCH_INDEX}"

echo "==> GPU check"
python3 - <<'PY'
import torch
print("PyTorch:", torch.__version__)
print("CUDA/ROCm available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("Device:", torch.cuda.get_device_name(0))
else:
    print("WARNING: GPU not visible to PyTorch. Training will use CPU.")
    print("  Check: groups video/render, /dev/kfd, rocm-smi")
PY

echo ""
echo "Done. Activate with:"
echo "  source ${VENV}/bin/activate"
echo "Train:"
echo "  cd ${ROOT}/backend && python train_model.py --help"
