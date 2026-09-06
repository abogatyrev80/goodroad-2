# Environment Variables - Четкое объяснение

## В Deployment у вас есть ДВЕ отдельные переменные:

### 1. MONGO_URL (НЕ ТРОГАТЬ!) ✅
```
MONGO_URL = mongodb+srv://roadqual-track:d49arm4lqs2c73ftmo2g@customer-apps-pri.ddilqs.mongodb.net/?appName=potholefinder&maxPoolSize=5&retryWrites=true&w=majority
```
**Это connection string к MongoDB серверу**
- Оставить как есть
- Не изменять

### 2. DB_NAME (ИЗМЕНИТЬ!) ⚠️
```
Старое значение:
DB_NAME = roadqual-track-test_database

Новое значение:
DB_NAME = test_database
```
**Это имя базы данных внутри MongoDB**
- Изменить на просто "test_database"
- Убрать префикс "roadqual-track-"

## Как это выглядит в Deployment UI:

```
┌─────────────────────────────────────────────────────┐
│ Environment Variables                               │
├─────────────────────────────────────────────────────┤
│                                                     │
│ MONGO_URL                                           │
│ mongodb+srv://roadqual-track:d49arm4lqs2c73ftmo... │ ← НЕ ТРОГАТЬ
│                                                     │
│ DB_NAME                                             │
│ test_database                                       │ ← ИЗМЕНИТЬ НА ЭТО
│                                                     │
│ EXPO_PUBLIC_BACKEND_URL                             │
│ https://goodroad.su                │ ← НЕ ТРОГАТЬ
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Почему две переменные?

**MONGO_URL** - говорит "где находится MongoDB сервер"
**DB_NAME** - говорит "какую базу данных использовать на этом сервере"

Один MongoDB сервер может содержать много баз данных:
- roadqual-track-test_database (старая, пустая)
- test_database (наша с данными)
- good_road_production (может быть)
- и т.д.

## Что делать:

1. Откройте Deployment → Settings → Environment Variables
2. Найдите строку с **DB_NAME**
3. Измените значение с `roadqual-track-test_database` на `test_database`
4. Сохраните
5. Re-Deploy

## Результат:

Backend будет подключаться к:
- Сервер: customer-apps-pri.ddilqs.mongodb.net (из MONGO_URL)
- База: test_database (из DB_NAME)
- Полный путь: mongodb+srv://...mongodb.net/test_database

---

**Просто измените одну строку DB_NAME и всё заработает!** 🚀
