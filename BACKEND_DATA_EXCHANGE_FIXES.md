# Отчёт по исправлениям обмена данными бэкенда

Дата: 23.05.2026
Файлы: `backend/server.py`, `backend/ml_processor.py`

---

## Исправленные проблемы

### 1. 🐛 Distance всегда 0 в предупреждениях (критично)

**Файл:** `backend/server.py:988-1007`

**Проблема:** В `POST /api/raw-data` координаты пользователя и события брались из одного `gps`:
```python
user_lat=gps.get("latitude"),
user_lng=gps.get("longitude"),
event_lat=gps.get("latitude"),  # то же самое!
event_lng=gps.get("longitude"), # то же самое!
```
Haversine возвращал 0 метров. Предупреждения всегда были "через 0м".

**Исправление:**
- После кластеризации определяется центроид существующего кластера
- Если в кластере >1 отчёта (`reportCount > 1`) — расстояние считается до центроида
- Если кластер новый — расстояние 0, но сообщение меняется на "рядом с вами"

```python
cluster = await db.obstacle_clusters.find_one(
    {"_id": cluster_id},
    {"location": 1, "reportCount": 1}
)
if cluster and cluster.get("reportCount", 0) > 1:
    loc = cluster.get("location", {})
    if loc.get("latitude") and loc.get("longitude"):
        effective_event_lat = loc["latitude"]
        effective_event_lng = loc["longitude"]
```

**Файл:** `backend/ml_processor.py:991`

Добавлена проверка distance < 1 в `create_warning_message()`:
```python
if distance < 1:
    return f"{severity_text}: {event_text} рядом с вами"
```

---

### 2. 🐛 GPS координаты None ломают Haversine (критично)

**Файл:** `backend/server.py:301-309`

**Проблема:** `gps.get("latitude")` мог вернуть `None`, что вызывало `TypeError` в `math.radians(None)`.

**Исправление:** Добавлена функция валидации координат:

```python
def validate_gps_coords(lat: Optional[float], lon: Optional[float]) -> bool:
    if lat is None or lon is None:
        return False
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return False
    if lat == 0.0 and lon == 0.0:
        return False
    return True
```

Применена в обоих эндпоинтах:
- `POST /api/sensor-data` — пропуск location-точек с невалидными координатами
- `POST /api/raw-data` — пропуск data-точек с невалидными координатами

---

### 3. 🐛 insert_many падает целиком при одной ошибке

**Файл:** `backend/server.py` (5 вызовов)

**Проблема:** Все `insert_many` вызывались без `ordered=False`. При ошибке в одном документе (например, дубликат ключа) не вставлялся ни один.

**Исправление:** Все 5 вызовов получают `ordered=False`:

| Эндпоинт | Коллекция |
|---|---|
| `POST /api/sensor-data` | `road_conditions` |
| `POST /api/sensor-data` | `road_warnings` |
| `POST /api/raw-data` | `raw_sensor_data` |
| `POST /api/raw-data` | `processed_events` |
| `POST /api/raw-data` | `user_warnings` |

---

### 4. 🛡 Нет rate limiting на приём данных

**Файл:** `backend/server.py:277-298`

**Проблема:** Телефон мог отправлять неограниченное количество данных.

**Исправление:** Добавлен in-memory rate limiter:

- По умолчанию: **30 запросов за 60 секунд** на один `deviceId`
- Настраивается через переменные окружения:
  - `RATE_LIMIT_REQUESTS` (по умолч. 30)
  - `RATE_LIMIT_WINDOW` (по умолч. 60 секунд)
- Возвращает HTTP 429 при превышении
- Очистка старых записей происходит при каждом запросе

Применён к эндпоинтам:
- `POST /api/sensor-data`
- `POST /api/raw-data`

---

### 5. 🛡 CORS открыт для всех origins

**Файл:** `backend/server.py:3358-3362`

**Проблема:** `allow_origins=["*"]` в production.

**Исправление:** Origins читаются из переменной окружения `CORS_ORIGINS`:
- Если не задана или `*` — поведение не меняется (все origins)
- Если задан список через запятую — строгие origins

```python
cors_origins = os.environ.get("CORS_ORIGINS", "*")
if cors_origins == "*":
    allowed_origins = ["*"]
else:
    allowed_origins = [o.strip() for o in cors_origins.split(",")]
```

Для продакшена установить:
```
CORS_ORIGINS=https://goodroad.su,https://admin.goodroad.su
```

---

## Сводка изменений

```
 backend/ml_processor.py |   2 +-
 backend/server.py       | 101 ++++++++++++++++++++++++++++++++++++-----
 2 files changed, 91 insertions(+), 12 deletions(-)
```

Синтаксическая проверка Python — пройдена.
