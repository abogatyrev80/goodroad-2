# ✅ Чеклист для Production Deployment

## Автоматически выполнено ✅

- [x] Код подготовлен для deployment
- [x] app.json настроен (EAS Updates отключены)
- [x] Новая архитектура реализована:
  - [x] RawDataCollector для избыточного сбора данных
  - [x] ML Processor для серверной классификации
  - [x] Динамическая частота сбора по скорости
  - [x] WarningAlert компоненты
- [x] Backend поддерживает внешнюю MongoDB
- [x] Все сервисы перезапущены
- [x] Preview версия работает и протестирована
- [x] Документация создана:
  - [x] DEPLOYMENT_GUIDE.md
  - [x] NEW_ARCHITECTURE.md
  - [x] DEPLOYMENT_ENV_VARIABLES.txt
  - [x] PERIODIC_DATA_COLLECTION.md

## Требует вашего участия 🔧

### 1. Создание MongoDB Atlas (15 минут)

- [ ] Зайти на https://www.mongodb.com/cloud/atlas/register
- [ ] Создать бесплатный аккаунт
- [ ] Создать новый кластер (Free tier M0)
- [ ] Подождать ~5 минут создания кластера
- [ ] Настроить Network Access (добавить 0.0.0.0/0)
- [ ] Создать Database User (username: goodroad_user)
- [ ] Получить Connection String
- [ ] Сохранить connection string в безопасном месте

**Результат:** Connection string вида:
```
mongodb+srv://goodroad_user:PASSWORD@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority
```

### 2. Deployment в Emergent UI (5 минут)

- [ ] Открыть интерфейс Emergent в браузере
- [ ] Найти кнопку **"Deploy"**
- [ ] Нажать **"Deploy Now"**
- [ ] Дождаться завершения (~10 минут)
- [ ] Записать полученный Production URL

**Результат:** URL вида `https://goodroad.su`

### 3. Настройка Environment Variables (5 минут)

- [ ] Перейти в Deployments → Settings → Environment Variables
- [ ] Добавить новые переменные:
  ```
  MONGO_URL = (ваш connection string из шага 1)
  DB_NAME = good_road_production
  EXPO_PUBLIC_BACKEND_URL = (ваш URL из шага 2)
  ```
- [ ] Удалить старые переменные:
  ```
  REACT_APP_BACKEND_URL (если есть)
  DB_NAME=roadqual-track-test_database (если есть)
  ```
- [ ] Сохранить изменения
- [ ] Нажать **"Re-Deploy"** или перезапустить deployment

### 4. Тестирование Production (10 минут)

- [ ] Проверить Backend API:
  ```bash
  curl https://goodroad.su/api/admin/analytics
  ```
  Должен вернуть JSON (не ошибку)

- [ ] Открыть QR код Deployment в Expo Go
  - [ ] Приложение загрузилось без ошибок
  - [ ] Нет ошибки "Failed to download remote update"
  
- [ ] Протестировать функционал:
  - [ ] Нажать "Начать мониторинг"
  - [ ] GPS определяется
  - [ ] Акселерометр работает
  - [ ] Частота сбора меняется при изменении скорости
  - [ ] Данные отправляются на сервер

- [ ] Проверить данные в MongoDB Atlas:
  - [ ] Зайти в MongoDB Atlas
  - [ ] Открыть Collections
  - [ ] Проверить коллекции:
    - [ ] `raw_sensor_data` - сырые данные
    - [ ] `processed_events` - классифицированные события
    - [ ] `user_warnings` - предупреждения

### 5. Финальная проверка

- [ ] Совершить тестовую поездку (5-10 минут)
- [ ] Проверить что данные собираются
- [ ] Попробовать создать событие (резкое торможение)
- [ ] Проверить появление warning
- [ ] Убедиться что sound alert работает (на мобильном)

## Альтернатива: Использовать Preview 🚀

Если не хотите настраивать MongoDB Atlas сейчас:

- [ ] Откройте Expo Go на телефоне
- [ ] Введите URL: `exp://goodroad.su`
- [ ] Тестируйте все функции (работает полностью!)

**Preview использует локальную MongoDB, все функции работают!**

## Подсказки 💡

### Если MongoDB Atlas connection не работает:
1. Проверьте что password правильный (без спецсимволов или экранируйте их)
2. Проверьте Network Access (должно быть 0.0.0.0/0)
3. Проверьте что Database User создан с правами readWrite
4. Попробуйте тестовый connection в MongoDB Compass

### Если QR код не работает:
1. Убедитесь что сделали Re-Deploy после изменения app.json
2. Попробуйте ввести URL вручную в Expo Go
3. Используйте Preview URL для тестирования

### Если Backend не отвечает:
1. Проверьте логи deployment в Emergent UI
2. Убедитесь что MONGO_URL правильный
3. Проверьте что все environment variables установлены
4. Попробуйте Re-Deploy

## Оценка времени

- **Быстрый путь (Preview):** 2 минуты ✅
- **Production Deployment:** 35-40 минут
  - MongoDB Atlas: 15 минут
  - Deployment: 10 минут  
  - Environment Variables: 5 минут
  - Тестирование: 10 минут

## Итоговая цель

✅ Production приложение работает
✅ Данные собираются в MongoDB Atlas
✅ Новая архитектура функционирует
✅ ML классификация работает
✅ Warnings отображаются пользователю
✅ Приложение готово к реальному использованию

---

**Удачи с deployment! 🚀**

Если возникнут проблемы - обратитесь в Discord: https://discord.gg/VzKfwCXC4A
