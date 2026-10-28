# 🐳 Docker Setup Guide - Road Monitor System

## 📋 Требования

- Docker 20.10+
- Docker Compose 2.0+
- 4GB свободной оперативной памяти
- 10GB свободного места на диске

## 🚀 Быстрый старт

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd road-monitor
```

### 2. Настройка переменных окружения

#### Backend (.env)

Создайте файл `backend/.env`:

```env
# MongoDB
MONGO_URL=mongodb://mongodb:27017
MONGO_DB_NAME=road_monitor

# API
DEBUG=False
LOG_LEVEL=INFO
```

#### Frontend (.env)

Создайте файл `frontend/.env`:

```env
# Backend URL
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
REACT_APP_BACKEND_URL=http://localhost:8001

# Expo
EXPO_DEVTOOLS_LISTEN_ADDRESS=0.0.0.0
```

### 3. Запуск всех сервисов

```bash
# Production режим
docker-compose up -d

# Development режим (с hot reload)
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### 4. Проверка статуса

```bash
# Проверить статус контейнеров
docker-compose ps

# Посмотреть логи
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f mongodb
```

## 🔗 Доступ к сервисам

После запуска сервисы будут доступны:

- **Frontend (Web)**: http://localhost:3000
- **Backend API**: http://localhost:8001
- **API Documentation**: http://localhost:8001/docs
- **MongoDB**: mongodb://localhost:27017
- **Expo DevTools**: http://localhost:19002

## 📱 Подключение мобильного устройства

### Вариант 1: Expo Go (рекомендуется для разработки)

1. Установите Expo Go на ваше устройство:
   - [iOS](https://apps.apple.com/app/expo-go/id982107779)
   - [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. Убедитесь, что мобильное устройство в той же сети что и компьютер

3. Откройте Expo DevTools: http://localhost:19002

4. Отсканируйте QR-код в Expo Go

### Вариант 2: Сборка APK (для production)

См. инструкции в `BUILD_APK_INSTRUCTIONS.md`

## 🛠️ Управление контейнерами

### Остановка

```bash
# Остановить все контейнеры
docker-compose stop

# Остановить и удалить контейнеры
docker-compose down

# Остановить и удалить контейнеры + volumes (⚠️ УДАЛИТ ДАННЫЕ)
docker-compose down -v
```

### Перезапуск

```bash
# Перезапустить все сервисы
docker-compose restart

# Перезапустить конкретный сервис
docker-compose restart backend
docker-compose restart frontend
```

### Rebuild

```bash
# Пересобрать и перезапустить все
docker-compose up -d --build

# Пересобрать конкретный сервис
docker-compose up -d --build backend
```

## 🗄️ Работа с базой данных

### Подключение к MongoDB

```bash
# Через Docker
docker-compose exec mongodb mongosh road_monitor

# Или с локальной машины
mongosh mongodb://localhost:27017/road_monitor
```

### Бэкап базы данных

```bash
# Создать бэкап
docker-compose exec mongodb mongodump --out=/data/backup

# Скопировать бэкап на хост
docker cp road-monitor-mongodb:/data/backup ./mongodb-backup
```

### Восстановление базы данных

```bash
# Скопировать бэкап в контейнер
docker cp ./mongodb-backup road-monitor-mongodb:/data/backup

# Восстановить
docker-compose exec mongodb mongorestore /data/backup
```

## 🔧 Отладка

### Войти в контейнер

```bash
# Backend
docker-compose exec backend bash

# Frontend
docker-compose exec frontend sh

# MongoDB
docker-compose exec mongodb bash
```

### Проверка логов

```bash
# Все логи
docker-compose logs

# Последние 100 строк с follow
docker-compose logs -f --tail=100

# Логи с временными метками
docker-compose logs -t
```

### Проверка здоровья контейнеров

```bash
# Статус всех сервисов
docker-compose ps

# Детальная информация
docker inspect road-monitor-backend
```

## 📊 Мониторинг ресурсов

```bash
# Использование ресурсов
docker stats

# Использование дискового пространства
docker system df

# Очистка неиспользуемых ресурсов
docker system prune -a
```

## 🔄 Обновление

```bash
# 1. Остановить контейнеры
docker-compose down

# 2. Получить обновления
git pull

# 3. Пересобрать и запустить
docker-compose up -d --build
```

## ⚠️ Troubleshooting

### Проблема: Порты заняты

```bash
# Найти процесс на порту 8001
lsof -i :8001

# Убить процесс
kill -9 <PID>

# Или изменить порты в docker-compose.yml
```

### Проблема: MongoDB не стартует

```bash
# Проверить логи
docker-compose logs mongodb

# Удалить volume и пересоздать
docker-compose down -v
docker-compose up -d
```

### Проблема: Frontend не собирается

```bash
# Очистить кэш Node
docker-compose exec frontend yarn cache clean

# Переустановить зависимости
docker-compose exec frontend rm -rf node_modules
docker-compose exec frontend yarn install

# Или rebuild контейнера
docker-compose up -d --build frontend
```

### Проблема: Backend ошибки импорта

```bash
# Переустановить Python зависимости
docker-compose exec backend pip install -r requirements.txt

# Или rebuild контейнера
docker-compose up -d --build backend
```

## 🏗️ Архитектура

```
┌─────────────────┐
│   Mobile App    │
│   (Expo Go)     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐      ┌─────────────────┐
│   Frontend      │─────→│    Backend      │
│   (Node:18)     │      │   (Python:3.11) │
│   Port: 3000    │      │   Port: 8001    │
└─────────────────┘      └────────┬────────┘
                                  │
                                  ↓
                         ┌─────────────────┐
                         │    MongoDB      │
                         │   (Mongo:7.0)   │
                         │   Port: 27017   │
                         └─────────────────┘
```

## 📝 Переменные окружения

### Backend

| Переменная | Описание | По умолчанию |
|------------|----------|-------------|
| MONGO_URL | MongoDB connection string | mongodb://mongodb:27017 |
| MONGO_DB_NAME | Имя базы данных | road_monitor |
| DEBUG | Режим отладки | False |
| LOG_LEVEL | Уровень логирования | INFO |

### Frontend

| Переменная | Описание | По умолчанию |
|------------|----------|-------------|
| EXPO_PUBLIC_BACKEND_URL | URL backend API | http://localhost:8001 |
| REACT_APP_BACKEND_URL | URL backend API (альтернатива) | http://localhost:8001 |
| EXPO_DEVTOOLS_LISTEN_ADDRESS | Адрес для DevTools | 0.0.0.0 |

## 🔐 Production deployment

Для production используйте:

1. Отдельный `docker-compose.prod.yml`
2. Секреты вместо переменных окружения
3. Nginx в качестве reverse proxy
4. SSL сертификаты
5. Мониторинг (Prometheus + Grafana)
6. Логирование (ELK stack)

Подробнее см. `DEPLOYMENT_GUIDE.md`

## 📞 Поддержка

При возникновении проблем:

1. Проверьте логи: `docker-compose logs`
2. Проверьте статус: `docker-compose ps`
3. Проверьте health checks: `docker inspect <container>`
4. Создайте issue с описанием проблемы и логами