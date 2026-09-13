HDREZKA Premium • DENYS EDITION v5.0 MSX SAME-ORIGIN
========================================================

ЭТО НЕ ЕЩЁ ОДИН CORS-ФИКС ПЛАГИНА.

v5 меняет саму архитектуру для Hisense VIDAA + Media Station X.

ЧТО МЫ ВЫЯСНИЛИ ПО РЕАЛЬНЫМ ПЛАГИНАМ
-------------------------------------
1. Filmix и Online Mod используют Lampa.Reguest, но для проблемных источников
   Online Mod всё равно использует отдельные CORS proxy.

2. На VIDAA функция Lampa.Reguest.native() НЕ является настоящим системным
   HTTP-клиентом. Настоящий Android.httpReq включается только на Android.
   На VIDAA остаётся браузерный AJAX.

3. Filmix для воспроизведения строит настоящий полный playlist и передаёт:
   Lampa.Player.play(first)
   Lampa.Player.playlist(playlist)

4. Lampa Timeline работает, когда каждому фильму/эпизоду передан
   Lampa.Timeline.view(hash).

5. Официальная Lampa для Media Station X прямо предусматривает собственный
   хостинг. Lampac использует ту же идею: MSX открывает Lampa с сервера,
   где находится backend.

ЧТО ДЕЛАЕТ v5
-------------
Render теперь является одновременно:

  Media Station X
       ↓
  Lampa (официальная сборка)
       ↓ SAME ORIGIN
  HDREZKA plugin
       ↓ SAME ORIGIN
  FastAPI backend
       ↓
  HDRezka

То есть страница Lampa и API имеют ОДИН домен:
https://hdrezka-premium-lampa.onrender.com

Cross-origin между Lampa и нашим backend больше вообще нет.

ОФИЦИАЛЬНАЯ LAMPA
-----------------
Docker во время сборки сам забирает официальную MSX-сборку:
https://github.com/yumata/lampa

Она зафиксирована на commit:
0f50f0c4cb3f602ecaff84925dca07f96bbd38a8

В архив сама Lampa не упакована — Render получает её при Docker build.

КАК УСТАНОВИТЬ НА MEDIA STATION X
---------------------------------
1. Загрузить ВСЕ файлы этого архива в корень GitHub с заменой.
2. Commit.
3. Дождаться Render -> Live.

4. В Media Station X:
   Settings
   -> Start Parameter
   -> Setup

5. Включить HTTPS / Security Lock.

6. Ввести НЕ lampa.mx, а:

hdrezka-premium-lampa.onrender.com

Media Station X автоматически запросит:
https://hdrezka-premium-lampa.onrender.com/msx/start.json

И откроет Lampa уже с нашего Render.

ВАЖНО:
старую ссылку plugin.js на TV добавлять НЕ НУЖНО.
В этой Lampa HDREZKA v5 загружается автоматически.

ПОДКЛЮЧЕНИЕ HDREZKA КАК FILMIX
------------------------------
На карточке фильма есть две кнопки:

HDREZKA
ВОЙТИ

Нажать ВОЙТИ.

На TV появятся:
- адрес https://hdrezka-premium-lampa.onrender.com/connect
- короткий код из 6 символов

Открыть адрес на телефоне/ПК.
Ввести:
- код с TV
- логин HDRezka
- пароль HDRezka

После успешного входа TV автоматически получает сессию.

На TV пароль НЕ хранится.
Кнопка превращается в:

REZKA ✓

ЧТО СОХРАНЕНО ИЗ PRO-ВЕРСИИ
---------------------------
- Premium аккаунт HDRezka
- озвучки
- сезоны / серии
- качества
- субтитры
- native Lampa Timeline
- полный lazy playlist
- NEXT / PREV
- autoplay следующей серии
- переход между сезонами
- запоминание озвучки
- запоминание сезона
- прогресс и просмотренные серии
- backend cache
- DENYS EDITION

PC
--
Backend и plugin.js по-прежнему можно открыть отдельно на ПК.
Но для VIDAA/MSX правильный режим v5 — запуск самой Lampa с этого Render,
чтобы Lampa и API были same-origin.

ЛИЦЕНЗИЯ LAMPA
--------------
Lampa загружается при Docker build из официального GPL-2.0 репозитория
yumata/lampa. Исходный проект и лицензия сохраняются внутри загруженной
сборки Lampa.
