HDREZKA Premium • DENYS ADAPTER v7.0
=====================================

ЭТО ПОЛНАЯ СМЕНА ПОДХОДА.

v7 НЕ ДЕЛАЕТ:
- собственный поиск HDRezka;
- собственный CORS proxy;
- собственный парсинг страницы;
- собственный login;
- собственный Timeline;
- собственный playlist/player.

ВМЕСТО ЭТОГО v7 ИСПОЛЬЗУЕТ УЖЕ УСТАНОВЛЕННЫЙ ONLINE MOD.

Почему:
актуальный Online Mod уже содержит источник rezka2 с:
- рабочей логикой зеркал rezka.ag / kvk.zone;
- proxyLink;
- заполнением cookie через proxy;
- engine/ajax/search.php;
- get_episodes / get_stream / get_movie;
- декодированием Rezka;
- субтитрами и качествами;
- Lampa.Timeline;
- полноценным Lampa.Player.playlist;
- NEXT/PREV;
- контекстным меню;
- сбросом таймкода;
- выбором плеера;
- копированием ссылки.

ЧТО ДЕЛАЕТ DENYS ADAPTER
------------------------
1. Добавляет отдельную красивую кнопку HDREZKA.
2. Добавляет кнопку REZKA ✓ / ВОЙТИ.
3. Перед запуском временно переключает Online Mod на balanser=rezka2.
4. На VIDAA/MSX временно включает online_mod_proxy_rezka2=true.
5. Вызывает РОДНУЮ кнопку Online Mod, поэтому запускается его собственный
   loadOnline() со всеми checkMyIp / proxy / component init.
6. Когда Online Mod activity уже создана, возвращает пользователю его прежние
   настройки Online Mod, поэтому Filmix и другие источники не ломаются.
7. Для входа открывает штатные настройки Online Mod HDRezka.

ЗАВИСИМОСТЬ
------------
В обычной Lampa должен быть установлен актуальный Online Mod:
https://nb557.github.io/plugins/online_mod.js

У пользователя он уже используется — именно поэтому этот вариант выбран.

УСТАНОВКА
---------
1. Все файлы архива -> GitHub с заменой.
2. Commit.
3. Render -> Live.
4. Вернуть/оставить обычную Lampa в Media Station X.
5. Online Mod должен быть установлен как раньше.
6. Удалить старые тестовые DENYS URL, оставить один:

https://hdrezka-premium-lampa.onrender.com/plugin.js?v=70

7. Полностью перезапустить Lampa / Media Station X.

ВХОД НА VIDAA / MSX
-------------------
Нажать ВОЙТИ.
DENYS откроет штатные настройки Online Mod.

Ввести:
- Логин / email HDrezka
- Пароль HDrezka

Затем выбрать:
- Заполнить куки для HDrezka

Именно этот механизм Online Mod использует proxy/Set-Cookie и предназначен
для платформ, где обычная браузерная авторизация недостаточна.

После появления online_mod_rezka2_cookie кнопка DENYS покажет REZKA ✓.

ВАЖНО
-----
Никаких данных аккаунта DENYS v7 отдельно не хранит.
Он использует те же online_mod_rezka2_* storage, что сам Online Mod.

ПРОВЕРКА RENDER
---------------
https://hdrezka-premium-lampa.onrender.com/health

Должно быть:
version = 7.0.0
mode = online-mod-adapter
rezka_network_in_denys = false
