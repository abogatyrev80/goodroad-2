import torch
import torch.nn as nn

class AccelLSTM(nn.Module):
    def __init__(self, input_size=3, hidden_size=64, num_classes=5, window_size=32):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_classes = num_classes
        self.window_size = window_size

        self.lstm1 = nn.LSTM(input_size, hidden_size, batch_first=True)
        self.lstm2 = nn.LSTM(hidden_size, hidden_size // 2, batch_first=True)

        self.head = nn.Sequential(
            nn.Linear(hidden_size // 2, hidden_size),
            nn.ReLU(),
            nn.Dropout(DROPOUT_HEAD),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_size // 2, num_classes),
        )

    def forward(self, x):
        out, _ = self.lstm1(x)
        out, _ = self.lstm2(out)
        out = out[:, -1, :]
        return self.head(out)

    def count_params(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


DROPOUT_HEAD = 0.3


def detect_device():
    import os
    device_str = os.getenv("GPU_DEVICE", "auto")
    if device_str != "auto":
        return torch.device(device_str)
    if torch.cuda.is_available():
        name = torch.cuda.get_device_name(0).lower()
        if any(k in name for k in ("amd", "radeon", "rx")):
            return torch.device("cuda:0")
        return torch.device("cuda:0")
    return torch.device("cpu")
