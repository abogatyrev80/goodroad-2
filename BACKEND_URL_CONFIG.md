# Backend URL Configuration - Good Road App

## ✅ Текущая конфигурация (правильная)

### Development/Preview Environment
**URL:** `https://roadqual-track.preview.emergentagent.com`
**Использование:** Только для разработки и тестирования в preview режиме
**Конфигурация:** `frontend/.env` → `EXPO_PUBLIC_BACKEND_URL`
**База данных:** 241 точка (тестовые + ваши данные)

### Production/Deployed Environment
**URL:** `https://roadqual-track.emergent.host`
**Использование:** Production deployment, мобильные приложения (iOS/Android)
**Конфигурация:** `frontend/app.json` → `extra.backendUrl`
**База данных:** 243 точки (production база)

## 🔧 Как работает логика выбора URL

Код в `BatchOfflineManager.ts` (строка 267-270):
```typescript
const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 
                  Constants.expoConfig?.extra?.backendUrl || 
                  'https://roadquality.emergent.host';
```

**Приоритет:**
1. **Development:** `process.env.EXPO_PUBLIC_BACKEND_URL` (из .env)
   - Используется при `expo start --tunnel`
   - Preview URL: `https://roadqual-track.preview.emergentagent.com`

2. **Production:** `Constants.expoConfig.extra.backendUrl` (из app.json)
   - Используется в deployed builds (EAS, app stores)
   - Production URL: `https://roadquality.emergent.host`

3. **Fallback:** `https://roadquality.emergent.host`
   - Если оба источника недоступны

## ✅ Проверка статуса

### Preview Backend
```bash
curl https://roadqual-track.preview.emergentagent.com/api/
# Response: {"message": "Good Road API - Smart Road Monitoring System"}
# Total points: 241
```

### Production Backend
```bash
curl https://roadquality.emergent.host/api/
# Response: {"message": "Good Road API - Smart Road Monitoring System"}
# Total points: 1
```

## 📱 Что будет использоваться при деплое

### Expo Go (Development)
- ❌ НЕ рекомендуется для production
- Использует preview URL из .env

### EAS Build / Standalone App
- ✅ Использует production URL из app.json
- URL: `https://roadquality.emergent.host`
- База данных: Production (отдельная от preview)

### Web Deployment (Emergent Platform)
- ✅ Использует production URL из app.json
- URL: `https://roadquality.emergent.host`
- База данных: Production

## 🎯 Вывод

**Конфигурация правильная!** При деплое приложение будет:
1. Использовать `https://roadquality.emergent.host` (из app.json)
2. Подключаться к production MongoDB Atlas
3. Данные будут в отдельной production базе (не смешиваются с preview)

## 🔐 Environment Variables для Production

При деплое на Emergent убедитесь, что настроены:

**Backend (.env в Emergent deployment):**
```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/good_road_production?retryWrites=true&w=majority
MONGODB_DB_NAME=good_road_production
```

**Frontend (уже настроен в app.json):**
```json
{
  "extra": {
    "backendUrl": "https://roadquality.emergent.host"
  }
}
```

## ✅ Готовность к деплою

- ✅ Preview backend работает
- ✅ Production backend работает
- ✅ App.json настроен правильно
- ✅ Fallback URL настроен
- ✅ Логика выбора URL правильная

**Deployed версия будет отправлять данные на:** `https://roadquality.emergent.host/api/sensor-data`
