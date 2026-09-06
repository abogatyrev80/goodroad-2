# 🚀 Руководство по развертыванию Good Road App

## 📋 Предварительные требования

### 1. MongoDB Atlas (Production база данных)

**Deployment требует внешнюю MongoDB, не локальную!**

#### Создание MongoDB Atlas (если еще нет):

1. Зайдите на https://www.mongodb.com/cloud/atlas/register
2. Создайте бесплатный аккаунт
3. Создайте новый кластер (Free tier M0 подходит для тестирования)
4. Настройте доступ:
   - Network Access: Добавьте `0.0.0.0/0` (разрешить доступ откуда угодно)
   - Database Access: Создайте пользователя с правами `readWrite`
5. Получите Connection String:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
   ```

#### Альтернативы MongoDB Atlas:
- AWS DocumentDB
- Google Cloud Firestore
- Своя MongoDB на VPS/VDS
- Railway.app MongoDB (бесплатный tier)

### 2. Подготовка кода

✅ **Все уже готово!**
- app.json настроен (updates отключены)
- Backend поддерживает внешнюю MongoDB через `MONGO_URL`
- Frontend использует environment variables

## 🎯 Процесс Deployment

### Шаг 1: Нажмите Deploy в интерфейсе Emergent

1. Откройте интерфейс Emergent
2. Найдите кнопку **"Deploy"**
3. Нажмите **"Deploy Now"**
4. Дождитесь завершения (~10 минут)

### Шаг 2: Настройте Environment Variables для Deploy

После завершения deployment:

1. Перейдите в раздел **Deployments**
2. Найдите ваше приложение `good-road`
3. Откройте **Settings** → **Environment Variables**

#### Обязательные переменные для Backend:

```bash
# MongoDB Connection (КРИТИЧНО!)
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
DB_NAME=good_road_production

# Или если используете Railway/другой сервис
MONGO_URL=mongodb://user:pass@host:port/database
DB_NAME=good_road_production
```

#### Обязательные переменные для Frontend:

```bash
# Backend URL (должен указывать на ваш deployment URL)
EXPO_PUBLIC_BACKEND_URL=https://goodroad.su
```

#### Удалите старые переменные (если есть):

```bash
# УДАЛИТЬ:
REACT_APP_BACKEND_URL  # Не используется
DB_NAME=roadqual-track-test_database  # Старое значение
```

### Шаг 3: Проверка deployment

После настройки переменных:

1. **Перезапустите deployment** (если есть такая опция)
2. Или сделайте **Re-Deploy** для применения изменений

### Шаг 4: Тестирование

#### Проверка Backend:
```bash
curl https://goodroad.su/api/admin/analytics
```

Должен вернуть JSON с данными (не ошибку unauthorized).

#### Проверка Frontend:
1. Откройте QR код deployment в Expo Go
2. Или введите вручную: `exp://goodroad.su`
3. Приложение должно загрузиться без ошибок

## 🔧 Решение проблем

### Проблема 1: "Failed to download remote update"

**Причина:** EAS Updates не отключены в deployed версии

**Решение:**
1. Убедитесь что в `app.json` есть:
   ```json
   "updates": {
     "enabled": false,
     "fallbackToCacheTimeout": 0,
     "url": null,
     "checkAutomatically": "never"
   }
   ```
2. Сделайте **Re-Deploy**

### Проблема 2: "not authorized on database"

**Причина:** Неправильные MongoDB credentials или база не существует

**Решение:**
1. Проверьте `MONGO_URL` - правильный ли username/password
2. Проверьте что база данных существует в MongoDB Atlas
3. Проверьте Network Access в MongoDB Atlas (должно быть 0.0.0.0/0)
4. Проверьте Database User - должны быть права `readWrite`

### Проблема 3: Backend не отвечает

**Причина:** Backend не запущен или порт заблокирован

**Решение:**
1. Проверьте логи deployment
2. Убедитесь что backend привязан к `0.0.0.0:8001`
3. Проверьте что все зависимости установлены (requirements.txt)

### Проблема 4: Frontend не подключается к Backend

**Причина:** Неправильный `EXPO_PUBLIC_BACKEND_URL`

**Решение:**
1. В Environment Variables установите правильный URL:
   ```
   EXPO_PUBLIC_BACKEND_URL=https://goodroad.su
   ```
2. НЕ добавляйте `/api` в конец - это делается автоматически в коде

## 📊 Текущие URL

### Preview (Работает сейчас):
- Frontend: https://goodroad.su/
- Backend: https://goodroad.su/api
- MongoDB: Локальная (mongodb://localhost:27017)
- База: test_database (7 записей)

### Deploy (После настройки):
- Frontend: https://goodroad.su/
- Backend: https://goodroad.su/api
- MongoDB: MongoDB Atlas (нужно настроить)
- База: good_road_production (новая)

## 🎯 Рекомендуемая стратегия

### Вариант A: Быстрое тестирование (Сейчас)

**Используйте Preview для тестирования новой архитектуры:**
- ✅ Все работает
- ✅ Не требует дополнительной настройки
- ✅ Бесплатно
- ⚠️ Временная среда (может быть удалена)

**Как использовать:**
1. Откройте Expo Go на телефоне
2. Введите URL: `exp://goodroad.su`
3. Тестируйте все функции

### Вариант B: Production Deployment (Рекомендуется для долгосрочного использования)

**Шаги:**
1. Создайте MongoDB Atlas аккаунт (или используйте Railway.app)
2. Получите connection string
3. Сделайте Deploy с правильными environment variables
4. Тестируйте через deployment URL

## 💰 Стоимость

- **Preview**: Бесплатно (временная среда)
- **Deploy**: 50 кредитов/месяц на платформе Emergent
- **MongoDB Atlas**: Free tier (M0) - 512 MB, достаточно для тестирования
- **Railway.app MongoDB**: $5/месяц (500 MB)

## 🆘 Поддержка

Если что-то не работает:

1. **Discord**: https://discord.gg/VzKfwCXC4A
2. **Email**: support@emergent.sh
3. **Job ID**: Найдите через кнопку "i" в интерфейсе Emergent

## ✅ Чеклист перед Deploy

- [ ] MongoDB Atlas настроен и работает
- [ ] Connection string получен
- [ ] app.json имеет `updates: {enabled: false}`
- [ ] Environment Variables подготовлены
- [ ] Код протестирован в Preview
- [ ] Все изменения сохранены

## 🚀 Следующие шаги после успешного Deploy

1. **Протестируйте приложение** на реальном устройстве
2. **Совершите тестовую поездку** (5-10 минут)
3. **Проверьте данные** в MongoDB Atlas
4. **Запустите анализ**: `python3 /app/analyze_trip_data.py`
5. **Проверьте warnings** - должны появляться при критических событиях

## 📝 Важные заметки

- **Не используйте локальную MongoDB для production!**
- **Всегда тестируйте в Preview перед Deploy**
- **Environment variables можно менять после deployment**
- **Re-Deploy требуется после изменения app.json**
- **Логи deployment доступны в интерфейсе Emergent**

---

**Удачи с deployment! 🎉**
