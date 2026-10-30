# Backend URL Configuration - Good Road App

## ✅ Текущая конфигурация (правильная)

### Development/Preview Environment
**URL:** `https://soundzummer.preview.emergentagent.com` (опционально, для разработки)
**Использование:** Только для разработки и тестирования в preview режиме
**Конфигурация:** `frontend/.env` → `EXPO_PUBLIC_BACKEND_URL`

### Production/Deployed Environment
**URL:** `https://goodroad.su`
**Использование:** Production deployment, мобильные приложения (iOS/Android)
**Конфигурация:** 
- `frontend/app.json` → `extra.backendUrl`
- `frontend/eas.json` → `production.env.EXPO_PUBLIC_BACKEND_URL`

## 🔧 Как работает логика выбора URL

Код в `BatchOfflineManager.ts` (строка 279-281):
```typescript
const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 
                  Constants.expoConfig?.extra?.backendUrl || 
                  'https://goodroad.su';
```

**Приоритет:**
1. **Development:** `process.env.EXPO_PUBLIC_BACKEND_URL` (из .env или eas.json)
   - Используется при `expo start --tunnel` или в EAS build
   - Может быть установлен в `eas.json` для production сборки

2. **Production:** `Constants.expoConfig.extra.backendUrl` (из app.json)
   - Используется в deployed builds (EAS, app stores)
   - Production URL: `https://goodroad.su`

3. **Fallback:** `https://goodroad.su`
   - Если оба источника недоступны

## ✅ Проверка статуса

### Production Backend
```bash
curl https://goodroad.su/api/
# Response: {"message": "Good Road API - Smart Road Monitoring System"}
```

## 📱 Что будет использоваться при деплое

### Expo Go (Development)
- ❌ НЕ рекомендуется для production
- Использует preview URL из .env

### EAS Build / Standalone App
- ✅ Использует production URL из app.json или eas.json
- URL: `https://goodroad.su`
- Настроено в `eas.json` → `production.env.EXPO_PUBLIC_BACKEND_URL`

### Web Deployment
- ✅ Использует production URL из app.json
- URL: `https://goodroad.su`

## 🎯 Вывод

**Конфигурация правильная!** При деплое приложение будет:
1. Использовать `https://goodroad.su` (из app.json или eas.json)
2. Подключаться к production backend на https://goodroad.su

## 🔐 Environment Variables для Production

При деплое на Emergent убедитесь, что настроены:

**Backend (.env в Emergent deployment):**
```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/good_road_production?retryWrites=true&w=majority
MONGODB_DB_NAME=good_road_production
```

**Frontend (настроено в app.json и eas.json):**
```json
// app.json
{
  "extra": {
    "backendUrl": "https://goodroad.su"
  }
}

// eas.json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_BACKEND_URL": "https://goodroad.su"
      }
    }
  }
}
```

## ✅ Готовность к деплою

- ✅ Production backend URL настроен: `https://goodroad.su`
- ✅ App.json настроен правильно
- ✅ EAS.json настроен правильно
- ✅ Fallback URL настроен во всех сервисах
- ✅ Логика выбора URL правильная

**Deployed версия будет отправлять данные на:** `https://goodroad.su/api/sensor-data`
