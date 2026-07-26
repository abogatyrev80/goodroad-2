# Развёртывание GPU-клиента

## Быстрый старт

```bash
# скопировать на целевую машину:
#   - deploy_gpu_client.py
#   - gpu_server/  (вся директория)

# запустить
python deploy_gpu_client.py --yes --name "RX 6800 XT"
```

Скрипт сам зарегистрирует машину на `https://goodroad.su`, установит зависимости и запустит сервер на порту `8002`.

---

## Параметры

| Параметр | По умолчанию | Описание |
|---|---|---|
| `--server` | `https://goodroad.su` | URL бэкенда |
| `--name` | `GPU-xxxxxxxx` | Имя машины в админке |
| `--gpu` | `auto` | `cpu`, `cuda`, `rocm`, `auto` |
| `--dir` | `~/goodroad-gpu` | Куда ставить |
| `--source` | `./gpu_server/` | Путь к `gpu_server/` |
| `--machine-id` | — | ID уже зарегистрированной машины |
| `--api-key` | — | Ключ уже зарегистрированной машины |
| `--port` | `8002` | Порт сервера |
| `--no-start` | — | Только установка, без запуска |
| `--no-service` | — | Без systemd-сервиса |
| `-y` / `--yes` | — | Без интерактивных вопросов |

## Сценарии

### 1. Первая установка на любую машину

```bash
python deploy_gpu_client.py --yes
```

Скрипт:
- регистрирует машину на бэкенде → получает `machine_id` + `api_key`
- копирует файлы в `~/goodroad-gpu`
- создаёт venv + устанавливает зависимости + PyTorch
- генерирует `.env`
- запускает сервер

### 2. Установка с GPU

```bash
# NVIDIA
python deploy_gpu_client.py --yes --name "RTX 4090" --gpu cuda

# AMD ROCm (только Linux!)
python deploy_gpu_client.py --yes --name "RX 6800 XT" --gpu rocm
```

### 3. Установка без запуска (только подготовка)

```bash
python deploy_gpu_client.py --yes --no-start --no-service
```

Затем ручной запуск:
```bash
# Linux
cd ~/goodroad-gpu && nohup ./venv/bin/python main.py &

# Windows
cd %USERPROFILE%\goodroad-gpu
.\venv\Scripts\python.exe main.py
```

### 4. Использование существующей регистрации

```bash
python deploy_gpu_client.py \
    --machine-id gpu_6ae67396214f \
    --api-key gpu_09f0d08fb6504d743897d79bec7945ef426d60e6b83a4ada \
    --yes --no-start
```

### 5. Кастомный бэкенд

```bash
python deploy_gpu_client.py --server http://192.168.8.213:8000 --yes
```

## Мониторинг

После запуска:

```
Статус:        http://localhost:8002/api/status
Здоровье:      http://localhost:8002/health
Лог:           ~/goodroad-gpu/gpu_server.log
Админка:       https://goodroad.su/api/admin/dashboard/v3 → вкладка GPU Machines
```

## Команды из админки

После регистрации машина появится в админ-панели. Оттуда можно:

- **Обучить** — выбрать датасет, количество эпох → задача ставится в очередь
- **Логи** — последние строки лога
- **Статус** — online/offline, GPU name
- **Удалить** — если машина больше не нужна

GPU-клиент сам забирает задачи (поллинг каждые 30 секунд), скачивает датасет, обучает модель, загружает результат на сервер и отмечает задачу выполненной.

## Требования

- **Python ≥ 3.8** (рекомендуется 3.10-3.11)
- **ОС**: Linux (рекомендуется), Windows
- **Диск**: минимум 2 ГБ свободно (зависимости + PyTorch)
- **Интернет**: доступ к `https://goodroad.su` (или кастомному серверу)
- **GPU** (опционально): NVIDIA CUDA или AMD ROCm

## Файлы после установки

```
~/goodroad-gpu/
├── main.py                 # сервер
├── config.py               # конфигурация
├── requirements.txt        # зависимости
├── .env                    # credentials (machine_id, api_key, секреты)
├── models/                 # сохранённые модели
├── venv/                   # виртуальное окружение
├── polling/
│   ├── __init__.py
│   └── poller.py           # поллинг команд с бэкенда
├── training/
│   ├── __init__.py
│   ├── model.py            # AccelLSTM
│   ├── train.py            # обучение
│   └── dataset_loader.py   # загрузка датасета
├── gpu_server.log          # лог работы
└── gpu_server.pid          # PID процесса
```
