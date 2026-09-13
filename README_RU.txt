HDREZKA Premium • DENYS EDITION v5.1 DIRECT REZKA
===================================================

НАЙДЕНА КОНКРЕТНАЯ ПРИЧИНА ОШИБКИ
----------------------------------
Ошибка:

TypeError: 'NoneType' object is not subscriptable

шла из hdrezka.Post. В актуальном исходнике библиотека делает:

soup.find('meta', property='og:type')['content']

без проверки на None.

Если Rezka отдаёт страницу входа, редирект или другой HTML без og:type,
парсер падает именно с этой ошибкой.

v5.1 УБИРАЕТ ЭТО МЕСТО ИЗ РАБОЧЕГО ПОТОКА ПОЛНОСТЬЮ
----------------------------------------------------
- client.player() больше не используется для карточки, серий и потока.
- Страница Rezka разбирается безопасно.
- Используются те же ключевые маркеры, что в актуальном Online Mod:
  .initCDNSeriesEvents(...)
  .initCDNMoviesEvents(...)
  #translators-list .b-translator__item[data-translator_id]
- Серии идут напрямую через ajax/get_cdn_series action=get_episodes.
- Сериал-поток: action=get_stream.
- Фильм-поток: action=get_movie.
- Абсолютная ссылка поиска не может увести Premium-сессию на другое зеркало:
  путь сохраняется, host принудительно остаётся рабочим content host.
- Если Rezka реально вернёт не страницу фильма, вместо Python TypeError
  будет нормальная диагностика status/final URL/title/markers.

УСТАНОВКА
---------
Загрузить ВСЕ файлы архива в GitHub с заменой.
Commit.
Дождаться Render -> Live.

Если Media Station X уже настроен на:
hdrezka-premium-lampa.onrender.com

ничего в MSX больше менять не надо.

Проверка:
https://hdrezka-premium-lampa.onrender.com/health

Версия должна быть 5.1.0.
