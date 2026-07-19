import os

MAIN_SERVER_URL = os.getenv("MAIN_SERVER_URL", "https://goodroad.su")
API_KEY = os.getenv("EXTERNAL_TRAINING_API_KEY", "your-api-key-change-me")
WEBHOOK_SECRET = os.getenv("EXTERNAL_TRAINING_WEBHOOK_SECRET", "your-webhook-secret-change-me")
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")

POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "300"))

GPU_DEVICE = os.getenv("GPU_DEVICE", "auto")
MODEL_OUTPUT_DIR = os.getenv("MODEL_OUTPUT_DIR", "/data/models")
WINDOW_SIZE = int(os.getenv("WINDOW_SIZE", "32"))
NUM_CLASSES = 5
INPUT_SIZE = 3

HIDDEN_SIZE = 64
DROPOUT_HEAD = 0.3
LEARNING_RATE = 1e-3
DEFAULT_EPOCHS = 50
DEFAULT_BATCH_SIZE = 64
