HDREZKA Premium • DENYS EDITION v4.1 TV SAFE
================================================

ГЛАВНЫЙ ФИКС ЭТОЙ ВЕРСИИ — ТЕЛЕВИЗОР / MEDIA STATION X.

ПОЧЕМУ НА ПК РАБОТАЛО, А НА TV НЕ НАХОДИЛО ФИЛЬМЫ
--------------------------------------------------
Старый plugin.js отправлял ВСЕ запросы к нашему backend через browser fetch()
с application/json.

На обычном Chrome на ПК это нормально.

На телевизорах Media Station X / старом TV WebView / некоторых WebOS/Tizen
поведение браузерного fetch/CORS/preflight может отличаться.

В v4.1:
- browser fetch полностью убран из API транспорта;
- используется Lampa.Reguest().native() — сетевой слой самой Lampa;
- на Android Lampa может использовать Android.httpReq;
- на остальных платформах используется совместимый AJAX механизм Lampa;
- запросы идут как обычный form-urlencoded POST без JSON preflight;
- если Reguest недоступен, есть fallback на XMLHttpRequest;
- добавлены специальные /tv/* endpoints на backend;
- добавлен /tv/ping;
- в настройках есть кнопка "Проверить соединение TV";
- в статусе видно TV SAFE.

УСТАНОВКА
---------
Загрузить ВСЕ файлы архива в корень GitHub с заменой.
Commit.
Дождаться Render -> Live.

В Lampa удалить старую ссылку плагина и добавить:

https://hdrezka-premium-lampa.onrender.com/plugin.js?v=41

Полностью перезапустить Lampa / Media Station X.

ПРОВЕРКА НА TV
--------------
Настройки -> HDREZKA Premium by DENYS TV SAFE
-> Проверить соединение TV

Должно показать:
✅ TV SAFE OK • v4.1.0

После этого открыть любой фильм -> HDREZKA Premium.

Если после TV SAFE OK конкретный фильм не находится,
ошибка уже будет означать не сеть телевизора, а точный запрос поиска/backend.

Остальное из v4 сохранено:
- внутренний Lampa player;
- native Timeline;
- resume;
- плейлист серий;
- NEXT/PREV;
- авто следующая серия;
- prefetch;
- качество;
- озвучки;
- сезоны;
- история;
- DENYS EDITION.
