HDREZKA Premium • DENYS EDITION v4.2 VIDAA BRIDGE
====================================================

Версия специально для Hisense VIDAA + Media Station X.

ГЛАВНЫЙ ФИКС
------------
На ПК HDRezka могла работать, а на телевизоре Media Station X писать
"нет подключения к сети" или показывать пустой поиск.

Причина: plugin.js загружается обычным <script>, но API-запросы к другому
домену идут через XHR/fetch и старый VIDAA WebView может блокировать именно
cross-origin API-трафик.

v4.2 использует SAME-ORIGIN BRIDGE:

Media Station X / Lampa
        ↓ postMessage
https://hdrezka-premium-lampa.onrender.com/bridge.html
        ↓ same-origin XHR
FastAPI / HDRezka

Для bridge.html API находится на том же домене, поэтому CORS между Lampa
и Render вообще не участвует.

Если bridge не запустился, остаётся старый TV SAFE transport как fallback.

НОВАЯ КНОПКА АККАУНТА
---------------------
На карточке фильма теперь две кнопки:

HDREZKA
ВОЙТИ

После успешной авторизации:
REZKA ✓

Кнопка ВОЙТИ / REZKA ✓ открывает меню:
- Войти в HDRezka
- Проверить аккаунт
- Переподключить аккаунт
- Выйти
- Проверить VIDAA Bridge
- Настройки HDREZKA

Логин и пароль можно вводить прямо с телевизора.
Пароль вводится в скрытом поле.

Также в Настройки -> HDREZKA есть отдельная кнопка:
"Подключить / войти в HDRezka".

УСТАНОВКА
---------
1. Распаковать архив.
2. Загрузить ВСЕ файлы в корень GitHub с заменой.
3. Commit.
4. Дождаться Render -> Live.
5. В Lampa использовать:

https://hdrezka-premium-lampa.onrender.com/plugin.js?v=42

6. Полностью закрыть Media Station X и открыть снова.

ПРОВЕРКА
--------
На TV открыть карточку любого фильма.
Нажать ВОЙТИ -> Проверить VIDAA Bridge.

Нормальный результат:
✅ VIDAA Bridge OK • v4.2.0

После этого:
ВОЙТИ -> логин -> пароль.

При успехе:
✅ HDRezka подключена
и кнопка станет REZKA ✓.

Сохранены функции v4:
- Premium-потоки вашего аккаунта;
- озвучки;
- сезоны/серии;
- качества;
- встроенный Lampa player;
- Timeline;
- настоящий сериал-плейлист;
- NEXT/PREV;
- автоследующая серия;
- prefetch;
- история;
- DENYS EDITION.
