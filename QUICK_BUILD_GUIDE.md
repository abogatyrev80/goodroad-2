# 🚀 Быстрая инструкция по сборке APK

## 📦 Архив проекта готов!

**Файл:** `good-road-frontend.tar.gz` (31 MB)  
**Расположение:** `/app/good-road-frontend.tar.gz`

---

## 📋 Пошаговая инструкция

### Шаг 1: Скачайте архив

Архив находится по адресу:
```
https://goodroad.su/download/good-road-frontend.tar.gz
```

Или скачайте через ваш интерфейс Emergent.

---

### Шаг 2: Распакуйте архив

**Windows:**
```powershell
# Используйте 7-Zip или WinRAR
# Или через PowerShell:
tar -xzf good-road-frontend.tar.gz
```

**Mac/Linux:**
```bash
tar -xzf good-road-frontend.tar.gz
cd frontend
```

---

### Шаг 3: Установите зависимости

```bash
# Если Node.js не установлен:
# Скачайте с https://nodejs.org/ (LTS версия)

# Установите зависимости проекта:
npm install
# или
yarn install
```

---

### Шаг 4: Установите EAS CLI

```bash
npm install -g eas-cli
```

---

### Шаг 5: Войдите в Expo

```bash
eas login
```

**Ваши credentials:**
- Email: `abogatyrev80@gmail.com`
- Password: `366157Asd!`

---

### Шаг 6: Запустите сборку

```bash
# Для тестирования (быстрее):
eas build --platform android --profile preview

# Или для production:
eas build --platform android --profile production
```

---

### Шаг 7: Дождитесь окончания

Процесс займет **10-15 минут**. EAS покажет:

1. ✅ Загрузка проекта в облако
2. ✅ Установка зависимостей
3. ✅ Сборка Android APK
4. ✅ Публикация артефакта

В конце вы получите ссылку типа:
```
https://expo.dev/artifacts/eas/[build-id]/build-[hash].apk
```

---

### Шаг 8: Скачайте и установите APK

1. Скачайте APK по ссылке
2. Перенесите на Android устройство
3. Установите (разрешите "Неизвестные источники" если нужно)

---

## 🎯 Быстрый старт (одна команда)

После распаковки:

```bash
cd frontend && \
npm install && \
npm install -g eas-cli && \
eas login && \
eas build --platform android --profile preview
```

---

## ⚙️ Что уже настроено:

- ✅ `app.json` - конфигурация приложения
- ✅ `eas.json` - профили сборки
- ✅ Backend URL: `https://goodroad.su`
- ✅ Все зависимости в `package.json`

---

## 📊 Мониторинг сборки

После запуска `eas build`:

1. Откройте: https://expo.dev
2. Перейдите в "Builds"
3. Найдите свой проект "Good Road"
4. Следите за прогрессом в реальном времени

---

## 🐛 Troubleshooting

### "eas: command not found"
```bash
npm install -g eas-cli
# Или добавьте npm global bin в PATH
```

### "Not authenticated"
```bash
eas logout
eas login
```

### "Build failed"
- Проверьте логи на expo.dev
- Убедитесь что все зависимости установлены
- Попробуйте удалить `node_modules` и переустановить

### "Cannot connect to Expo"
- Проверьте интернет соединение
- Попробуйте VPN если есть блокировка

---

## 💡 Советы

1. **Первая сборка** - используйте `preview` профиль (быстрее)
2. **Версионирование** - обновляйте версию в `app.json` перед каждой сборкой
3. **Логи** - храните ссылку на APK из каждой сборки
4. **Тестирование** - всегда тестируйте на реальном устройстве

---

## 📱 После установки APK

Проверьте:
- [ ] Приложение запускается
- [ ] GPS permission работает
- [ ] Background location работает
- [ ] Мониторинг включается
- [ ] Данные отправляются на сервер
- [ ] Аудио предупреждения работают
- [ ] Динамические сигналы работают
- [ ] Автозапуск работает (если настроен)

---

## 🎉 Успешная сборка!

После получения APK вы сможете:
- Установить на любое Android устройство
- Поделиться с тестировщиками
- Отправить в Google Play Store (для production AAB)

---

**Удачи с сборкой!** 🚀

Если возникнут вопросы - обращайтесь!
