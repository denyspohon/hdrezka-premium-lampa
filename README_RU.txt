HDREZKA Premium • DENYS EDITION v8.0
====================================

ЭТА ВЕРСИЯ СОБРАНА ОТ РАБОЧЕЙ v2.1, А НЕ ОТ v6/v7.

Что было реально подтверждено:
- v2/v2.1 уже умела искать и воспроизводить HDRezka на ПК;
- текущая проблема backend -> Rezka: Rezka отдаёт страницу
  «Проверяем, что вы не бот!»;
- это текущая защита Anubis (proof-of-work), а не обычный Cloudflare/CORS;
- текущий Lampac NextGen уже решает именно этот Anubis в своём модуле Rezka;
- Media Station X имеет отдельную проблему с cross-origin XHR/fetch:
  на форумах есть точные случаи Online Mod + HDRezka, где на ПК работает,
  а внутри MSX вход пишет «нет подключения к сети».

ПОЭТОМУ v8 РЕШАЕТ ДВЕ РАЗНЫЕ ПРОБЛЕМЫ РАЗДЕЛЬНО.

1. BACKEND / REZKA / ANUBIS
---------------------------
Backend остаётся как в ранней рабочей версии: Lampa -> Render -> HDRezka.
Но теперь Render умеет распознавать и решать текущую Anubis-защиту Rezka.

Алгоритм повторяет текущую публичную реализацию Lampac NextGen:
- читает <script id="anubis_challenge">;
- берёт challenge.id, randomData, rules.difficulty;
- решает SHA-256 proof-of-work;
- устанавливает techaro.lol-anubis-cookie-verification;
- вызывает /.within.website/x/cmd/anubis/api/pass-challenge;
- повторяет исходный запрос уже с cookie.

Затем Backend использует обычный browser TLS impersonation hdrezka 5.2.0.

Мирроры пробуются автоматически:
- rezka.ag (текущий default Lampac)
- rezka-ua.tv (тот host, на котором ранняя DENYS-версия работала на ПК)
- rezkery.com
- hdrezka.ag
- hdrezka.co
- hdrzk.org
- kvk.zone

После успешного входа host фиксируется внутри сессии; запросы между разными
зеркалами не мешаются.

2. TV / VIDAA / MEDIA STATION X
-------------------------------
На ПК API вызывается обычным fetch, как в рабочей v2.1.

На Media Station X / VIDAA API больше НЕ вызывается через XHR/fetch вообще.
Используется JSONP — динамический <script src="...">.

Это важно: Media Station X уже умеет загружать наш plugin.js с Render как
cross-origin script, а script-тег не требует CORS/XHR разрешения.

TV transport:
Lampa/MSX
  -> <script src="Render/jsonp/...">
  -> Render
  -> Rezka + Anubis
  -> callback({...})

Таким образом остаётся ваша ОБЫЧНАЯ Lampa со всеми Filmix/Online Mod/другими
плагинами. Start Parameter MSX менять не нужно.

3. БЕЗОПАСНЫЙ ВХОД НА TV
------------------------
На карточке фильма:

HDREZKA    ВОЙТИ

На телевизоре пароль НЕ вводится и НЕ кладётся в URL.

Нажать ВОЙТИ:
- TV получает короткий 6-символьный код;
- показывает адрес /connect;
- открыть этот адрес на телефоне/ПК;
- ввести код + HDRezka login/password;
- backend решает Anubis, логинится и создаёт зашифрованную Fernet-сессию;
- TV получает только encrypted session token через JSONP;
- пароль backend не сохраняет.

После этого:

HDREZKA    REZKA ✓

Сессия stateless: cookies находятся только внутри зашифрованного токена.
Каждый API-ответ может обновить токен, если Rezka обновила Anubis-cookie.

4. ПОИСК / КАРТОЧКА / PREMIUM
-----------------------------
Больше не используется хрупкий client.player()/Post parser, который раньше
падал на NoneType.

- поиск: обычная /search/ + fallback engine/ajax/search.php;
- карточка: безопасный HTML parser;
- post id: URL /123-name.html + initCDN* fallback;
- переводчики: #translators-list;
- premium translator сохраняется;
- series/movie определяется по initCDNSeriesEvents / initCDNMoviesEvents;
- сезоны: ajax/get_cdn_series action=get_episodes;
- серия: action=get_stream;
- фильм: action=get_movie;
- передаются is_camrip / is_ads / is_director / favs;
- payload декодируется hdrezka 5.2.0 только на уровне URLs, без Post parser.

5. ТАЙМКОД И ПЛЕЙЛИСТ
---------------------
Самодельные video.currentTime polling-хуки v3/v4 удалены.

Используется родная схема официального Lampa Rezka plugin:
- каждому фильму/эпизоду Lampa.Timeline.view(hash);
- timeline передаётся прямо в Lampa.Player.play;
- внутренний Lampa player принудительно для HDREZKA через launch_player='lampa';
- player_timecode временно ставится в Continue/Ask/Again согласно настройке;
- после выхода глобальная настройка пользователя возвращается;
- Lampa сама обновляет percent/time/duration и вызывает timeline.handler.

Сериал получает НАСТОЯЩИЙ lazy playlist ВСЕХ серий ВСЕХ сезонов:
- Lampa.Player.play(first)
- Lampa.Player.playlist(full_playlist)
- URL следующей серии — function(call), как в официальном plugin/online/rezka.js;
- NEXT/PREV;
- Auto Next;
- переход между сезонами;
- prefetch следующей серии.

УСТАНОВКА
---------
1. Распаковать архив.
2. ВСЕ файлы загрузить в корень GitHub-репозитория с заменой.
3. Commit.
4. Дождаться Render -> Live.
5. В вашей обычной Lampa удалить старые тестовые DENYS URL и добавить только:

https://hdrezka-premium-lampa.onrender.com/plugin.js?v=80

6. Полностью закрыть Media Station X / Lampa и открыть снова.

НЕ МЕНЯТЬ Start Parameter MSX.
НЕ УДАЛЯТЬ Filmix / Online Mod / остальные плагины.
Они остаются как раньше.

ПЕРВАЯ ПРОВЕРКА
---------------
ПК/телефон:
https://hdrezka-premium-lampa.onrender.com/health

Должно быть:
version = 8.0.0
anubis_solver = true
tv_transport = jsonp-script

На TV:
1. Открыть любую карточку.
2. Нажать ВОЙТИ.
3. Получить код.
4. На телефоне открыть показанный /connect.
5. Ввести код + аккаунт HDRezka.
6. Дождаться REZKA ✓.
7. Нажать HDREZKA.

НАСТРОЙКИ
---------
Транспорт:
Авто — JSONP на TV / fetch на ПК

Таймкод:
Автоматически продолжать

Auto Next:
Да

Prefetch следующей серии:
Да

Качество:
MAX или нужный предел

ТЕСТЫ ПЕРЕД СБОРКОЙ АРХИВА
--------------------------
- Python py_compile: OK
- Node --check plugin.js: OK
- synthetic Anubis challenge parse: OK
- Anubis SHA-256 PoW: OK
- mock pass-challenge -> retry: OK
- search parser: OK
- movie/series parser: OK
- encrypted session roundtrip: OK
- JSONP pair/start route: OK
- JSONP callback validation: OK
- plugin.js API base substitution: OK
- static player check: native Timeline + launch_player=lampa + lazy playlist: OK

ВАЖНО
-----
Живой Rezka-запрос нельзя полноценно выполнить в локальном build-контейнере,
потому что у него нет внешнего DNS/интернета. Поэтому мы не называем релиз
«гарантированно проверенным на вашем аккаунте» до первого Render deploy.
Но в отличие от предыдущих попыток, две известные причины уже закрыты кодом:
Anubis на Rezka и XHR/CORS Media Station X.
