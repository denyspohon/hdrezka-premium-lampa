HDREZKA Premium • DENYS EDITION v6.0
=======================================

ЭТА ВЕРСИЯ ПОЛНОСТЬЮ ОТКАЗЫВАЕТСЯ ОТ СТАРОЙ СХЕМЫ:
Render -> HDRezka.

Почему:
HDRezka отдавала Render антибот-страницу:
"Проверяем, что вы не бот!"

Поэтому Python backend больше НЕ парсит HDRezka и вообще НЕ делает
запросов к HDRezka.

НОВАЯ АРХИТЕКТУРА
------------------
Обычная Lampa / Media Station X
        ↓
HDREZKA Premium plugin.js
        ↓
direct / Online-Mod-compatible CORS proxy
        ↓
HDRezka

Render нужен только для раздачи plugin.js.

ВАЖНО
-----
Не меняйте Start Parameter Media Station X.
Используйте вашу обычную Lampa, где уже стоят Filmix, Online Mod
и остальные плагины.

УСТАНОВКА
---------
1. Залить ВСЕ файлы архива в GitHub с заменой.
2. Commit.
3. Дождаться Render -> Live.
4. В обычной Lampa удалить старые тестовые HDREZKA URL, если они есть.
5. Добавить:

https://hdrezka-premium-lampa.onrender.com/plugin.js?v=60

6. Полностью перезапустить Lampa / Media Station X.

ЧТО ВНУТРИ
----------
- отдельная кнопка HDREZKA на карточке фильма;
- отдельная кнопка ВОЙТИ / REZKA ✓;
- импорт сохранённой HDRezka-cookie из Online Mod;
- синхронизация cookie обратно в Online Mod;
- логин через /ajax/login/;
- VIDAA/MSX режим через CORS proxy по той же схеме proxyLink,
  которую использует актуальный Online Mod;
- прямой режим на ПК;
- зеркала: прямой режим kvk.zone, proxy-режим rezka.ag;
- fallback нескольких proxy-узлов;
- fast search /engine/ajax/search.php;
- fallback full search;
- нормальное сопоставление по названию и году;
- парсинг .initCDNSeriesEvents / .initCDNMoviesEvents;
- переводы из #translators-list;
- сезоны/серии через ajax/get_cdn_series action=get_episodes;
- фильм через action=get_movie;
- серия через action=get_stream;
- декодирование HDRezka payload;
- качества HLS/MP4;
- субтитры;
- native Lampa.Timeline;
- реальный Lampa.Player.playlist;
- lazy NEXT/PREV;
- переход между сезонами;
- автоследующая серия;
- история Lampa;
- запоминание озвучки и сезона;
- фокус на недосмотренной серии;
- сброс таймкода долгим OK;
- диагностика маршрута;
- optional stream CDN fix / Ukrainian stream proxy.

ВХОД
----
Настройки -> HDREZKA Premium • by DENYS

Введите:
Логин / E-mail
Пароль

Затем:
Подключить / проверить HDRezka -> Войти.

На VIDAA/MSX режим "Авто" использует внешний CORS proxy, совместимый
с текущим Online Mod.

ВАЖНО ПО ПРИВАТНОСТИ
--------------------
В proxy-режиме внешний CORS-proxy технически видит запросы к HDRezka,
включая cookie и запрос входа. Плагин показывает предупреждение перед
первым proxy-входом.

Если HDRezka уже подключена в Online Mod, лучше использовать:
"Импортировать сессию Online Mod"
— тогда пароль заново вводить не нужно.

После успешного входа пароль из настроек DENYS EDITION очищается.

РЕКОМЕНДУЕМЫЕ НАСТРОЙКИ ДЛЯ HISENSE VIDAA / MSX
------------------------------------------------
Сетевой режим:
Авто — TV через proxy, ПК напрямую

Формат потока:
HLS

Плеер:
Встроенный Lampa

Продолжение просмотра:
Автоматически продолжать

Авто следующая серия:
Да

Проксирование видеопотока:
Без подмены CDN
(включать только если сам фильм не стартует)

ПРОВЕРКА
--------
https://hdrezka-premium-lampa.onrender.com/health

Должно быть:
version = 6.0.0
mode = plugin-only
rezka_backend = false

Это принципиально важно:
Render больше НЕ контактирует с HDRezka.
