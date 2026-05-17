# Minecraft Bot

Десктопное приложение для управления Minecraft-ботами с интеграцией локального ИИ (Ollama).

## Требования

- **Node.js** 18+ (скачать: https://nodejs.org)
- **npm** (идёт вместе с Node.js)
- **Ollama** (устанавливается автоматически при первом запуске)

## Быстрый старт

### Разработка
```bash
npm install
npm run dev
```

### Сборка в EXE/AppImage
```bash
npm install
npm run build
```

Файлы появятся в папке `dist-electron/`:
- Windows: `Minecraft Bot Setup 1.0.0.exe`
- Linux: `Minecraft Bot-1.0.0.AppImage`
- macOS: `Minecraft Bot-1.0.0.dmg`

### Сборка для конкретной ОС
```bash
npm run dist:win   # Windows EXE
npm run dist:linux # Linux AppImage
npm run dist:mac   # macOS DMG
```

## Функции

- **Мультиботы** — неограниченное количество ботов одновременно
- **Локальный ИИ** — Ollama с поддержкой Llama3, Mistral, Gemma и других
- **API-ключи** — опциональная поддержка OpenAI/Claude
- **Режим Выживальщик** — бот самостоятельно проходит игру через Незер до Края
- **Авто-логин/регистрация** — общий пароль для всех ботов
- **Прокси** — SOCKS4/5, HTTP/HTTPS
- **Кооперация** — боты общаются через локальный координатор
- **Каталог моделей** — скачивание/удаление/запуск моделей прямо из приложения
- **Прохождение капч** — текстовые, математические, вопрос-ответ через ИИ
- **Оффлайн-чат** — можно общаться с ИИ без подключения к серверу

## Структура

```
src/
  main/         # Electron main process (Node.js)
    index.js          - Точка входа
    bot-manager.js    - Управление ботами Mineflayer
    ollama-manager.js - Интеграция с Ollama
    survivor-ai.js    - Режим Выживальщик
    captcha-handler.js - Прохождение капч
    coordinator.js    - Кооперация ботов
    config-manager.js - Хранение настроек
  preload/      # Electron preload (безопасный мост)
  renderer/     # React фронтенд (интерфейс)
```

## Настройки

Настройки хранятся в файле конфигурации:
- **Windows**: `%APPDATA%/minecraft-bot-config/config.json`
- **Linux**: `~/.config/minecraft-bot-config/config.json`
- **macOS**: `~/Library/Application Support/minecraft-bot-config/config.json`

При обновлении EXE настройки **сохраняются**.

## Версии Minecraft

Поддерживаются: 1.8.9, 1.12.2, 1.16.5, 1.17.1, 1.18.2, 1.19.4, 1.20.1, 1.20.4

## ИИ-команды (JSON-формат)

Бот принимает решения в формате:
```json
{"action": "attack", "target": "skeleton"}
{"action": "craft", "item": "wooden_pickaxe"}
{"action": "move_to_block", "target": "oak_log"}
{"action": "eat_food", "target": null}
```
