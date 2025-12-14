# 🚀 Быстрый старт - Road Monitor System

## Для разработчика (быстрая установка за 5 минут)

### Шаг 1: Клонирование репозитория
```bash
git clone <repository-url>
cd road-monitor
```

### Шаг 2: Создание .env файлов

**Backend** (`backend/.env`):
```env
MONGO_URL=mongodb://mongodb:27017
MONGO_DB_NAME=road_monitor
```

**Frontend** (`frontend/.env`):
```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
REACT_APP_BACKEND_URL=http://localhost:8001
```

### Шаг 3: Запуск
```bash
docker-compose up -d
```

### Шаг 4: Проверка
```bash
# Статус сервисов
docker-compose ps

# Логи
docker-compose logs -f
```

### Шаг 5: Доступ
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8001
- **API Docs**: http://localhost:8001/docs
- **Expo DevTools**: http://localhost:19002

## Для тестирования на телефоне

### Вариант 1: Expo Go (рекомендуется)

1. Установите Expo Go:
   - [iOS App Store](https://apps.apple.com/app/expo-go/id982107779)
   - [Android Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. Откройте http://localhost:19002

3. Отсканируйте QR-код в Expo Go

### Вариант 2: APK для Android

См. инструкцию в `BUILD_APK_INSTRUCTIONS.md`

## Основные команды

```bash
# Запуск
docker-compose up -d

# Остановка
docker-compose down

# Перезапуск
docker-compose restart

# Логи
docker-compose logs -f

# Rebuild
docker-compose up -d --build

# Очистка (УДАЛИТ ДАННЫЕ!)
docker-compose down -v
```

## Работа с БД

```bash
# Подключиться к MongoDB
docker-compose exec mongodb mongosh road_monitor

# Бэкап
docker-compose exec mongodb mongodump --out=/data/backup

# Восстановление
docker-compose exec mongodb mongorestore /data/backup
```

## Отладка

```bash
# Войти в контейнер backend
docker-compose exec backend bash

# Войти в контейнер frontend
docker-compose exec frontend sh

# Проверить здоровье
docker-compose ps
docker inspect road-monitor-backend
```

## Troubleshooting

### Порты заняты
```bash
# Найти процесс
lsof -i :8001
lsof -i :3000

# Убить процесс
kill -9 <PID>
```

### Не работает MongoDB
```bash
# Пересоздать
docker-compose down -v
docker-compose up -d
```

### Ошибки Frontend
```bash
# Очистить кэш
docker-compose exec frontend yarn cache clean
docker-compose exec frontend rm -rf node_modules
docker-compose exec frontend yarn install
```

### Ошибки Backend
```bash
# Переустановить зависимости
docker-compose exec backend pip install -r requirements.txt --no-cache-dir
```

## Полная документация

Подробная документация в `DOCKER_SETUP.md`
