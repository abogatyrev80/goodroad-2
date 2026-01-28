# Исправление ошибки компиляции Gradle

## Проблема
Ошибка: `Unsupported class file major version 65` при сборке Android APK.

**Причина:** Используется Java 21, но Gradle пытается использовать старую версию (7.2) или инициализационные скрипты Eclipse Buildship, скомпилированные с Java 21.

## Решение

### Вариант 1: Использовать Java 17 (Рекомендуется)

1. Установите Java 17 (если еще не установлена):
   - Скачайте с https://adoptium.net/temurin/releases/?version=17
   - Или используйте: `choco install temurin17` (если установлен Chocolatey)

2. Установите переменную окружения JAVA_HOME:
   ```powershell
   # Временная установка (только для текущей сессии)
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot"
   
   # Или установите через системные переменные окружения Windows
   ```

3. Очистите кэш Gradle:
   ```powershell
   cd frontend\android
   .\gradlew clean --no-daemon
   Remove-Item -Recurse -Force $env:USERPROFILE\.gradle\caches
   ```

4. Пересоберите проект:
   ```powershell
   .\gradlew assembleRelease --no-init
   ```

### Вариант 2: Обновить Gradle и очистить кэш

1. Убедитесь, что используется правильная версия Gradle (8.14.3):
   ```powershell
   cd frontend\android
   .\gradlew --version
   ```

2. Если версия не 8.14.3, обновите wrapper:
   ```powershell
   .\gradlew wrapper --gradle-version 8.14.3 --no-init
   ```

3. Очистите кэш Gradle:
   ```powershell
   Remove-Item -Recurse -Force $env:USERPROFILE\.gradle\caches
   Remove-Item -Recurse -Force $env:USERPROFILE\.gradle\daemon
   ```

4. Пересоберите проект:
   ```powershell
   .\gradlew clean assembleRelease --no-init
   ```

### Вариант 3: Удалить проблемный скрипт Eclipse Buildship

Если проблема сохраняется, удалите инициализационный скрипт Eclipse Buildship:

```powershell
$eclipseScript = "$env:APPDATA\Cursor\User\workspaceStorage\*\redhat.java\jdt_ws\.metadata\.plugins\org.eclipse.buildship.core\init.d\eclipsePlugin.gradle"
Get-ChildItem -Path $eclipseScript -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
```

Или найдите и удалите вручную файл:
`C:\Users\Lexus\AppData\Roaming\Cursor\User\workspaceStorage\6be6af12b075762d48814603bce7a46b\redhat.java\jdt_ws\.metadata\.plugins\org.eclipse.buildship.core\init.d\eclipsePlugin.gradle`

## Проверка версий

Проверьте установленные версии:

```powershell
# Версия Java
java -version

# Версия Gradle
cd frontend\android
.\gradlew --version

# Версия Android Gradle Plugin (должна быть совместима с Gradle 8.14.3)
```

## Дополнительные настройки

Если проблема сохраняется, добавьте в `frontend/android/gradle.properties`:

```properties
# Укажите путь к Java 17 (если используете Java 17)
org.gradle.java.home=C:\\Program Files\\Eclipse Adoptium\\jdk-17.x.x-hotspot

# Или отключите инициализационные скрипты полностью
org.gradle.init.disable=true
```

## Примечания

- Флаг `--no-init` уже добавлен в `gradlew.bat` для игнорирования проблемных скриптов
- Hermes отключен в `gradle.properties` (используется JSC)
- Gradle wrapper настроен на версию 8.14.3, которая поддерживает Java 21
