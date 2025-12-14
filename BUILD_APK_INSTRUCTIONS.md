# 📱 Инструкция по сборке APK - Road Monitor App

## 🔧 Решение проблемы "Failed to resolve plugin for module expo-router"

### Что было исправлено:

1. **app.json** - правильная конфигурация expo-router plugin
2. **eas.json** - добавлены правильные настройки для production сборки

---

## 📋 Требования

### На вашей машине:
- **Node.js**: 18+ (рекомендуется 18 LTS)
- **npm** или **yarn**: последняя версия
- **EAS CLI**: установлен глобально
- **Expo аккаунт**: зарегистрирован на expo.dev

### Установка EAS CLI:
```bash
npm install -g eas-cli
```

---

## 🚀 Пошаговая инструкция

### Шаг 1: Вход в Expo аккаунт

```bash
cd C:\Users\Lexus\goodroad-2\frontend
eas login
```

Введите ваши учетные данные от expo.dev

### Шаг 2: Настройка проекта (если первый раз)

```bash
# Инициализация EAS
eas build:configure
```

Это создаст/обновит файл `eas.json` с правильными настройками.

### Шаг 3: Установка зависимостей

```bash
# Удалить node_modules и переустановить
rm -rf node_modules
npm install

# Или с yarn
yarn install
```

### Шаг 4: Проверка конфигурации

Убедитесь, что в `app.json` правильно настроены:

```json
{
  "expo": {
    "name": "Good Road",
    "slug": "good-road",
    "version": "2.0.0",
    "android": {
      "package": "com.goodroad.app",
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE"
      ]
    },
    "plugins": [
      ["expo-router", { "origin": false }],
      "expo-location",
      "expo-sensors"
    ]
  }
}
```

### Шаг 5: Сборка APK

```bash
# Production сборка
eas build --platform android --profile production

# Или preview сборка (быстрее, для тестирования)
eas build --platform android --profile preview
```

### Шаг 6: Ожидание сборки

EAS Build соберет APK в облаке. Процесс занимает 10-20 минут.

Вы можете:
- Следить за процессом в терминале
- Открыть URL из терминала в браузере
- Посмотреть статус на https://expo.dev/accounts/[your-account]/projects/good-road/builds

### Шаг 7: Скачивание APK

После успешной сборки:

```bash
# Скачать последний build
eas build:download --platform android --profile production

# Или скачать с веб-интерфейса expo.dev
```

APK файл будет скачан в текущую директорию.

---

## 🐛 Возможные ошибки и решения

### Ошибка 1: "Failed to resolve plugin for module expo-router"

**Решение:**
```bash
# 1. Убедитесь что expo-router установлен
npm list expo-router

# 2. Переустановите если нужно
npm install expo-router@~5.1.4

# 3. Очистите кэш
npx expo start --clear

# 4. Попробуйте снова
eas build --platform android --profile production
```

### Ошибка 2: "Incorrect Android package name"

**Решение:**
Убедитесь что в `app.json` указан правильный package name:
```json
"android": {
  "package": "com.goodroad.app"
}
```

### Ошибка 3: "Build failed: Gradle error"

**Решение:**
```bash
# Обновите eas.json
{
  "build": {
    "production": {
      "android": {
        "buildType": "apk",
        "image": "latest"
      }
    }
  }
}
```

### Ошибка 4: "Could not find eas.json"

**Решение:**
```bash
# Создайте eas.json
eas build:configure
```

### Ошибка 5: "App config validation failed"

**Решение:**
```bash
# Проверьте конфигурацию
npx expo config --type public

# Исправьте ошибки в app.json
```

---

## 🔄 Альтернативный способ (локальная сборка)

Если EAS Build не работает, можно собрать локально:

### Требования:
- Android Studio
- Android SDK
- JDK 17

### Команды:

```bash
# 1. Создать нативные папки
npx expo prebuild --platform android

# 2. Собрать APK
cd android
./gradlew assembleRelease

# APK будет в: android/app/build/outputs/apk/release/app-release.apk
```

---

## 📊 Профили сборки

### Development (для разработки):
```bash
eas build --platform android --profile development
```
- Development client
- Debug mode
- Быстрая сборка

### Preview (для тестирования):
```bash
eas build --platform android --profile preview
```
- APK для внутреннего тестирования
- Средняя скорость сборки

### Production (для релиза):
```bash
eas build --platform android --profile production
```
- Оптимизированный APK
- Готов для публикации
- Самая долгая сборка

---

## 🔐 Подписание APK (для публикации в Play Store)

### Автоматическое подписание (EAS):

EAS автоматически создаст keystore при первой production сборке.

### Ручное подписание:

```bash
# 1. Создать keystore
keytool -genkeypair -v -storetype PKCS12 \
  -keystore goodroad.keystore \
  -alias goodroad \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# 2. Добавить в eas.json
{
  "build": {
    "production": {
      "android": {
        "credentialsSource": "local"
      }
    }
  }
}

# 3. Создать credentials.json
{
  "android": {
    "keystore": {
      "keystorePath": "./goodroad.keystore",
      "keystorePassword": "YOUR_PASSWORD",
      "keyAlias": "goodroad",
      "keyPassword": "YOUR_PASSWORD"
    }
  }
}
```

---

## 📱 Установка APK на телефон

### Способ 1: Через USB

```bash
# 1. Включить USB отладку на телефоне
# 2. Подключить телефон к компьютеру
# 3. Установить APK
adb install app.apk
```

### Способ 2: Через QR код (EAS)

После сборки EAS создаст QR код. Отсканируйте его на телефоне для скачивания APK.

### Способ 3: Через файл

1. Скопируйте APK на телефон
2. Откройте файл через файловый менеджер
3. Разрешите установку из неизвестных источников
4. Установите

---

## 🔍 Проверка APK

```bash
# Информация об APK
aapt dump badging app.apk

# Размер APK
ls -lh app.apk

# Проверка подписи
jarsigner -verify -verbose -certs app.apk
```

---

## 📈 Оптимизация размера APK

### В eas.json:

```json
{
  "build": {
    "production": {
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      }
    }
  }
}
```

### В app.json:

```json
{
  "expo": {
    "android": {
      "enableProguardInReleaseBuilds": true,
      "enableShrinkResourcesInReleaseBuilds": true
    }
  }
}
```

---

## 📝 Checklist перед сборкой

- [ ] Обновлена версия в `app.json`
- [ ] Проверен `package` name в `app.json`
- [ ] Настроены permissions в `android.permissions`
- [ ] Установлены все зависимости (`npm install`)
- [ ] Очищен кэш (`expo start --clear`)
- [ ] Проверена конфигурация (`npx expo config`)
- [ ] Вошли в Expo аккаунт (`eas login`)
- [ ] Настроен `eas.json`

---

## 🆘 Поддержка

### Полезные команды:

```bash
# Статус текущих сборок
eas build:list

# Детали конкретной сборки
eas build:view [build-id]

# Логи сборки
eas build:view [build-id] --logs

# Отменить сборку
eas build:cancel [build-id]
```

### Полезные ссылки:

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Expo Router Plugin](https://docs.expo.dev/router/installation/)
- [Android Permissions](https://docs.expo.dev/versions/latest/config/app/#permissions)
- [EAS Build Troubleshooting](https://docs.expo.dev/build-reference/troubleshooting/)

---

## 💡 Советы

1. **Используйте preview профиль** для быстрого тестирования
2. **Сохраняйте keystore** в безопасном месте (для production)
3. **Увеличивайте версию** перед каждой новой сборкой
4. **Тестируйте APK** перед публикацией
5. **Следите за размером** APK (рекомендуется < 50MB)

---

## 🎉 Готово!

После успешной сборки вы получите APK файл, готовый для:
- Установки на телефон
- Распространения среди тестировщиков
- Публикации в Google Play Store

**Важно:** Для публикации в Play Store нужна подписанная production сборка с правильным keystore.
