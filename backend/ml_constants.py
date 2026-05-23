"""Shared constants for accelerometer event classification."""

EVENT_TYPES = ("pothole", "speed_bump", "bump", "braking", "vibration")
NUM_CLASSES = len(EVENT_TYPES)
EVENT_TO_INDEX = {name: i for i, name in enumerate(EVENT_TYPES)}
INDEX_TO_EVENT = {i: name for name, i in EVENT_TO_INDEX.items()}

# Маппинг типов из production API → классы модели
API_LABEL_MAP = {
    "wave": "speed_bump",
    "speed_bump": "speed_bump",
    "pothole": "pothole",
    "bump": "bump",
    "braking": "braking",
    "vibration": "vibration",
}

DEFAULT_API_URL = "https://goodroad.su"
DEFAULT_WINDOW_SIZE = 32
MIN_WINDOW_SIZE = 8
