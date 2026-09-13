(function () {
  'use strict';

  if (window.hdrezka_denys_v5_ready) return;
  window.hdrezka_denys_v5_ready = true;
  window.hdrezka_premium_lampa_ready = true;

  var API = '__API_BASE__';
  var VERSION = '5.0.0';
  var AUTHOR = 'DENYS';
  var EDITION = 'DENYS EDITION';
  var COMPONENT = 'hdrezka_premium';

  var STORAGE = {
    login: 'hdrezka_premium_login',
    password: 'hdrezka_premium_password',
    session: 'hdrezka_premium_session',
    host: 'hdrezka_premium_host',
    quality: 'hdrezka_premium_quality',
    rememberVoice: 'hdrezka_premium_remember_voice',
    continueMode: 'hdrezka_premium_continue',
    preferences: 'hdrezka_premium_preferences',
    progress: 'hdrezka_premium_progress',
    playback: 'hdrezka_denys_playback_v3',
    resumeMode: 'hdrezka_premium_resume_mode',
    watchedAt: 'hdrezka_premium_watched_at',
    showProgress: 'hdrezka_premium_show_progress',
    playerMode: 'hdrezka_premium_player_mode',
    autoNext: 'hdrezka_premium_auto_next',
    prefetchNext: 'hdrezka_premium_prefetch_next',
    focusContinue: 'hdrezka_premium_focus_continue'
  };

  function notice(text) {
    try {
      Lampa.Noty.show(text);
    } catch (e) {}
  }

  function value(key) {
    return String(
      Lampa.Storage.get(key, '') || ''
    );
  }

  function setValue(key, val) {
    Lampa.Storage.set(key, val);
  }

  function readJson(key) {
    var raw = value(key);

    if (!raw) return {};

    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeJson(key, data) {
    try {
      setValue(
        key,
        JSON.stringify(data || {})
      );
    } catch (e) {}
  }

  function setting(key, fallback) {
    var current = value(key);
    return current === '' ? fallback : current;
  }

  function wakeStatus(text) {
    try {
      $('.hdrezka-denys-brand__status').text(text);
    } catch (e) {}
  }

  function qualityLabel() {
    var q = setting(STORAGE.quality, 'max');
    return q === 'max' ? 'MAX' : q + 'p';
  }

  function pickQuality(data) {
    if (!data) return '';

    var preferred = setting(STORAGE.quality, 'max');
    var quality = data.quality || {};

    if (
      preferred === 'max' ||
      !quality ||
      typeof quality !== 'object'
    ) {
      return data.url || '';
    }

    var target = parseInt(preferred, 10);

    if (!target) {
      return data.url || '';
    }

    var rows = [];

    Object.keys(quality).forEach(
      function (key) {
        var number = parseInt(key, 10);

        if (
          number &&
          quality[key]
        ) {
          rows.push({
            number: number,
            url: quality[key]
          });
        }
      }
    );

    if (!rows.length) {
      return data.url || '';
    }

    rows.sort(function (a, b) {
      return a.number - b.number;
    });

    var chosen = null;

    rows.forEach(function (row) {
      if (row.number <= target) {
        chosen = row;
      }
    });

    if (!chosen) {
      chosen = rows[0];
    }

    return chosen.url || data.url || '';
  }

  function yearFromMovie(movie) {
    var date =
      movie.release_date ||
      movie.first_air_date ||
      movie.last_air_date ||
      '';

    var year = parseInt(
      String(date).slice(0, 4)
    );

    return year || null;
  }

  function movieTitle(movie) {
    return (
      movie.title ||
      movie.name ||
      movie.original_title ||
      movie.original_name ||
      ''
    );
  }

  function originalTitle(movie) {
    return (
      movie.original_title ||
      movie.original_name ||
      ''
    );
  }

  function apiOrigin() {
    try {
      var a =
        document.createElement(
          'a'
        );

      a.href =
        API;

      return (
        a.protocol +
        '//' +
        a.host
      );
    }
    catch (e) {
      return API;
    }
  }

  function sameOrigin() {
    try {
      return (
        apiOrigin() ===
        (
          window.location.protocol +
          '//' +
          window.location.host
        )
      );
    }
    catch (e) {
      return false;
    }
  }

  function rpcPath(path) {
    if (
      path.indexOf('/api/') === 0
    ) {
      return (
        '/rpc/' +
        path.substr(5)
      );
    }

    return path;
  }

  function decodeNetworkError(
    network,
    xhr,
    exception
  ) {
    try {
      if (
        xhr &&
        xhr.responseJSON &&
        (
          xhr.responseJSON.detail ||
          xhr.responseJSON.error
        )
      ) {
        return (
          xhr.responseJSON.detail ||
          xhr.responseJSON.error
        );
      }

      if (
        network &&
        network.errorDecode
      ) {
        return network.errorDecode(
          xhr,
          exception
        );
      }
    }
    catch (e) {}

    return (
      (
        xhr &&
        xhr.status
      )
        ? (
            'HTTP ' +
            xhr.status
          )
        : (
            exception ||
            'Нет подключения к серверу'
          )
    );
  }

  /*
    ============================================================
    DENYS v5 NETWORK
    ============================================================

    На TV/MSX v5 работает с Lampa и backend НА ОДНОМ origin.
    Поэтому никаких CORS proxy / iframe / cross-origin запросов нет.

    На same-origin используем тот же Lampa.Reguest, что Filmix/Online Mod.
    JSON fetch оставлен только как fallback для ПК, если plugin.js
    установлен в чужую Lampa.
  */
  function rawPost(
    path,
    data,
    attempt
  ) {
    attempt =
      attempt ||
      0;

    var wakeTimer =
      setTimeout(
        function () {
          wakeStatus(
            '● Сервер просыпается…'
          );

          if (
            attempt === 0
          ) {
            notice(
              'HDREZKA: сервер просыпается…'
            );
          }
        },
        2500
      );

    if (
      sameOrigin() &&
      window.Lampa &&
      Lampa.Reguest
    ) {
      return new Promise(
        function (
          resolve,
          reject
        ) {
          var network =
            new Lampa.Reguest();

          network.timeout(
            65000
          );

          network.silent(
            API +
            rpcPath(
              path
            ),

            function (
              result
            ) {
              clearTimeout(
                wakeTimer
              );

              wakeStatus(
                '● SAME ORIGIN • online'
              );

              resolve(
                result
              );
            },

            function (
              xhr,
              exception
            ) {
              clearTimeout(
                wakeTimer
              );

              var status =
                xhr &&
                xhr.status
                  ? Number(
                      xhr.status
                    )
                  : 0;

              var retryable =
                !status ||
                status === 408 ||
                status === 429 ||
                status === 500 ||
                status === 502 ||
                status === 503 ||
                status === 504;

              if (
                retryable &&
                attempt < 2
              ) {
                setTimeout(
                  function () {
                    rawPost(
                      path,
                      data,
                      attempt + 1
                    )
                      .then(
                        resolve
                      )
                      .catch(
                        reject
                      );
                  },
                  attempt === 0
                    ? 1200
                    : 2500
                );

                return;
              }

              reject(
                new Error(
                  decodeNetworkError(
                    network,
                    xhr,
                    exception
                  )
                )
              );
            },

            data ||
            {},

            {
              dataType:
                'json',

              timeout:
                65000,

              attempts:
                0
            }
          );
        }
      );
    }

    /*
      Desktop / external-Lampa compatibility.
    */
    if (
      typeof fetch ===
      'function'
    ) {
      return fetch(
        API +
        path,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              data ||
              {}
            )
        }
      )
        .then(
          function (
            response
          ) {
            clearTimeout(
              wakeTimer
            );

            return response
              .text()
              .then(
                function (
                  text
                ) {
                  var json =
                    null;

                  try {
                    json =
                      JSON.parse(
                        text
                      );
                  }
                  catch (e) {}

                  if (
                    !response.ok
                  ) {
                    throw new Error(
                      (
                        json &&
                        (
                          json.detail ||
                          json.error
                        )
                      ) ||
                      (
                        'HTTP ' +
                        response.status
                      )
                    );
                  }

                  return json;
                }
              );
          }
        );
    }

    clearTimeout(
      wakeTimer
    );

    return Promise.reject(
      new Error(
        'Нет совместимого сетевого транспорта'
      )
    );
  }

  function accountConnected() {
    return Boolean(
      value(
        STORAGE.session
      )
    );
  }

  function accountLabel() {
    return (
      value(
        STORAGE.accountName
      ) ||
      value(
        STORAGE.login
      ) ||
      'HDRezka'
    );
  }

  var pairTimer =
    null;

  function stopPairPolling() {
    if (
      pairTimer
    ) {
      clearInterval(
        pairTimer
      );

      pairTimer =
        null;
    }
  }

  function updateAccountButtons() {
    try {
      var connected =
        accountConnected();

      $('.view--hdrezka-account span')
        .text(
          connected
            ? 'REZKA ✓'
            : 'ВОЙТИ'
        );

      $('.view--hdrezka-account')
        .attr(
          'data-subtitle',
          connected
            ? (
                'HDRezka подключена • ' +
                accountLabel()
              )
            : (
                'Подключить Premium-аккаунт HDRezka'
              )
        );
    }
    catch (e) {}
  }

  function pairStatus(
    code
  ) {
    return rawPost(
      '/api/pair/status',
      {
        code:
          code
      }
    );
  }

  function openPairing() {
    stopPairPolling();

    notice(
      'HDREZKA: создаём код подключения…'
    );

    rawPost(
      '/api/pair/start',
      {}
    )
      .then(
        function (
          result
        ) {
          if (
            !result ||
            !result.code
          ) {
            throw new Error(
              'Сервер не вернул код подключения'
            );
          }

          setValue(
            STORAGE.pairCode,
            result.code
          );

          var enabled =
            null;

          try {
            enabled =
              Lampa.Controller.enabled();
          }
          catch (e) {}

          var html =
            $('<div class="hdrezka-pair">' +
              '<div class="hdrezka-pair__title">Подключение HDRezka Premium</div>' +
              '<div class="hdrezka-pair__hint">Открой на телефоне или ПК:</div>' +
              '<div class="hdrezka-pair__url"></div>' +
              '<div class="hdrezka-pair__hint">и введи код:</div>' +
              '<div class="hdrezka-pair__code"></div>' +
              '<div class="hdrezka-pair__state">Ожидаем вход…</div>' +
              '<div class="hdrezka-pair__brand">HDREZKA Premium • DENYS EDITION</div>' +
            '</div>');

          html
            .find(
              '.hdrezka-pair__url'
            )
            .text(
              result.short_url ||
              result.connect_url ||
              (
                API +
                '/connect'
              )
            );

          html
            .find(
              '.hdrezka-pair__code'
            )
            .text(
              result.code
            );

          function closePair() {
            stopPairPolling();

            try {
              Lampa.Modal.close();
            }
            catch (e) {}

            try {
              if (
                enabled &&
                enabled.name
              ) {
                Lampa.Controller.toggle(
                  enabled.name
                );
              }
              else {
                Lampa.Controller.toggle(
                  'content'
                );
              }
            }
            catch (e) {}
          }

          try {
            Lampa.Modal.open({
              title:
                'HDREZKA • Подключить аккаунт',

              html:
                html,

              size:
                'medium',

              onBack:
                closePair
            });
          }
          catch (e) {
            notice(
              'Код: ' +
              result.code +
              ' • ' +
              (
                result.short_url ||
                result.connect_url
              )
            );
          }

          function check() {
            pairStatus(
              result.code
            )
              .then(
                function (
                  status
                ) {
                  if (
                    !status
                  ) {
                    return;
                  }

                  if (
                    status.status ===
                    'connected' &&
                    status.session
                  ) {
                    stopPairPolling();

                    setValue(
                      STORAGE.session,
                      status.session
                    );

                    setValue(
                      STORAGE.accountName,
                      status.login ||
                      'HDRezka'
                    );

                    /*
                      После pairing пароль на TV не нужен.
                    */
                    setValue(
                      STORAGE.password,
                      ''
                    );

                    html
                      .find(
                        '.hdrezka-pair__state'
                      )
                      .text(
                        '✅ Аккаунт подключён'
                      );

                    wakeStatus(
                      '● HDRezka подключена'
                    );

                    updateAccountButtons();

                    notice(
                      '✅ HDRezka Premium подключена'
                    );

                    setTimeout(
                      closePair,
                      1000
                    );
                  }
                  else if (
                    status.status ===
                    'expired'
                  ) {
                    stopPairPolling();

                    html
                      .find(
                        '.hdrezka-pair__state'
                      )
                      .text(
                        'Код истёк. Открой подключение заново.'
                      );
                  }
                }
              )
              .catch(
                function (
                  error
                ) {
                  html
                    .find(
                      '.hdrezka-pair__state'
                    )
                    .text(
                      'Связь: ' +
                      error.message
                    );
                }
              );
          }

          check();

          pairTimer =
            setInterval(
              check,
              3000
            );
        }
      )
      .catch(
        function (
          error
        ) {
          notice(
            'HDREZKA: ' +
            error.message
          );
        }
      );
  }

  function disconnectAccount() {
    stopPairPolling();

    setValue(
      STORAGE.session,
      ''
    );

    setValue(
      STORAGE.accountName,
      ''
    );

    setValue(
      STORAGE.password,
      ''
    );

    updateAccountButtons();

    notice(
      'HDRezka отключена'
    );
  }

  function checkAccount() {
    var session =
      value(
        STORAGE.session
      );

    if (!session) {
      openPairing();
      return;
    }

    notice(
      'HDREZKA: проверяем аккаунт…'
    );

    rawPost(
      '/api/status',
      {
        session:
          session
      }
    )
      .then(
        function (
          result
        ) {
          if (
            result &&
            result.authenticated
          ) {
            notice(
              '✅ HDRezka: аккаунт активен'
            );
          }
          else {
            notice(
              '⚠ HDRezka: нужна повторная авторизация'
            );
          }
        }
      )
      .catch(
        function (
          error
        ) {
          notice(
            'HDREZKA: ' +
            error.message
          );
        }
      );
  }

  function openAccountMenu() {
    if (
      !accountConnected()
    ) {
      openPairing();
      return;
    }

    var items = [
      {
        title:
          '✅ ' +
          accountLabel(),

        subtitle:
          'Проверить подключение HDRezka',

        action:
          'status'
      },
      {
        title:
          '🔄 Подключить другой аккаунт',

        subtitle:
          'Получить новый код входа',

        action:
          'pair'
      },
      {
        title:
          '🚪 Отключить HDRezka',

        subtitle:
          'Удалить сессию с этого устройства',

        action:
          'logout'
      }
    ];

    try {
      Lampa.Select.show({
        title:
          'HDREZKA Premium • by DENYS',

        items:
          items,

        onSelect:
          function (
            item
          ) {
            try {
              Lampa.Select.hide();
            }
            catch (e) {}

            if (
              item.action ===
              'status'
            ) {
              checkAccount();
            }
            else if (
              item.action ===
              'pair'
            ) {
              openPairing();
            }
            else if (
              item.action ===
              'logout'
            ) {
              disconnectAccount();
            }
          },

        onBack:
          function () {
            try {
              Lampa.Select.hide();
            }
            catch (e) {}
          }
      });
    }
    catch (e) {
      checkAccount();
    }
  }


  function login() {
    var login =
      value(STORAGE.login).trim();

    var password =
      value(STORAGE.password);

    if (!login || !password) {
      return Promise.reject(
        new Error(
          'Аккаунт не подключён. Нажмите REZKA / ВОЙТИ и подключите его по коду.'
        )
      );
    }

    notice(
      'HDREZKA Premium by DENYS: вход в аккаунт…'
    );

    return rawPost(
      '/api/login',
      {
        login: login,
        password: password
      }
    ).then(function (data) {
      if (
        !data ||
        !data.session
      ) {
        throw new Error(
          'Сервер не вернул сессию'
        );
      }

      setValue(
        STORAGE.session,
        data.session
      );

      setValue(
        STORAGE.host,
        data.host || ''
      );

      wakeStatus(
        '● Аккаунт подключён · ' +
        (
          data.host ||
          value(STORAGE.host) ||
          'HDRezka'
        )
          .replace('https://', '')
          .replace(/\/$/, '')
      );

      setValue(
        STORAGE.accountName,
        login
      );

      updateAccountButtons();

      notice(
        '✅ HDREZKA Premium: аккаунт авторизован'
      );

      return data.session;
    });
  }

  function ensureSession() {
    var session =
      value(STORAGE.session);

    if (session) {
      return Promise.resolve(
        session
      );
    }

    return login();
  }

  function api(path, data, retry) {
    retry =
      typeof retry === 'undefined'
        ? true
        : retry;

    return ensureSession()
      .then(function (session) {
        data = data || {};
        data.session = session;

        return rawPost(
          path,
          data
        );
      })
      .catch(function (error) {
        var message =
          String(
            error &&
            error.message ||
            ''
          );

        if (
          retry &&
          (
            message.indexOf('401') !== -1 ||
            message.toLowerCase().indexOf('сесс') !== -1 ||
            message.toLowerCase().indexOf('автор') !== -1
          )
        ) {
          setValue(
            STORAGE.session,
            ''
          );

          return login().then(
            function () {
              return api(
                path,
                data,
                false
              );
            }
          );
        }

        throw error;
      });
  }


  /*
    ============================================================
    DENYS PLAYBACK ENGINE v3
    ============================================================
    Не надеемся только на Lampa.Timeline.handler.
    Берём фактический currentTime у HTML5 video и сохраняем его
    каждые ~2 секунды + на pause/seeking/destroy/ended.
    Параллельно обновляем нативный Lampa.Timeline.
  */
  var DenysPlayback = (function () {
    var active = null;
    var video = null;
    var handlers = null;
    var pollTimer = null;
    var saveTimer = null;
    var bindAttempts = 0;
    var resumeApplied = false;

    function savedMap() {
      return readJson(STORAGE.playback);
    }

    function getSaved(key) {
      var all = savedMap();
      return all[key] || {};
    }

    function getVideo() {
      var v = null;

      try {
        if (
          Lampa.Player &&
          typeof Lampa.Player.video === 'function'
        ) {
          v = Lampa.Player.video();
        }
      } catch (e) {}

      if (!v || typeof v.currentTime === 'undefined') {
        try {
          v = document.querySelector('.player video') ||
              document.querySelector('video');
        } catch (e) {}
      }

      return v && typeof v.currentTime !== 'undefined' ? v : null;
    }

    function threshold() {
      var n = parseInt(setting(STORAGE.watchedAt, '95'), 10);
      return n >= 70 && n <= 100 ? n : 95;
    }

    function snapshot(forcePercent) {
      if (!active) return null;

      var v = video || getVideo();
      var old = getSaved(active.key);

      var time = old.time || 0;
      var duration = old.duration || 0;

      try {
        if (v) {
          if (isFinite(v.currentTime)) time = Math.max(0, Number(v.currentTime) || 0);
          if (isFinite(v.duration)) duration = Math.max(0, Number(v.duration) || 0);
        }
      } catch (e) {}

      var percent = duration > 0 ? Math.max(0, Math.min(100, time / duration * 100)) : (old.percent || 0);
      if (typeof forcePercent === 'number') percent = forcePercent;

      return {
        time: time,
        duration: duration,
        percent: percent,
        completed: percent >= threshold(),
        updated: Date.now(),
        season: active.season || null,
        episode: active.episode || null,
        title: active.title || '',
        voice: active.voice || ''
      };
    }

    function persist(forcePercent) {
      if (!active) return;

      var data = snapshot(forcePercent);
      if (!data) return;

      var all = savedMap();
      all[active.key] = data;
      writeJson(STORAGE.playback, all);

      try {
        if (
          active.timelineHash &&
          Lampa.Timeline &&
          Lampa.Timeline.update
        ) {
          Lampa.Timeline.update({
            hash: active.timelineHash,
            percent: data.percent,
            time: data.time,
            duration: data.duration,
            received: true
          });
        }
      } catch (e) {}

      try {
        if (active.onProgress) active.onProgress(data);
      } catch (e) {}
    }

    function applyResume() {
      if (!active || resumeApplied) return;
      if (setting(STORAGE.resumeMode, '1') !== '1') return;

      var v = video || getVideo();
      if (!v) return;

      var saved = getSaved(active.key);
      var time = Number(saved.time || active.resumeTime || 0);
      var percent = Number(saved.percent || 0);

      if (!(time > 8) || percent >= threshold()) {
        resumeApplied = true;
        return;
      }

      try {
        var duration = Number(v.duration || saved.duration || 0);
        if (duration > 0 && time >= duration - 10) {
          resumeApplied = true;
          return;
        }

        /*
          currentTime ставим сами. Это работает даже на сборках Lampa,
          где поле player.position не применяется.
        */
        v.currentTime = time;
        resumeApplied = true;
        notice('▶ Продолжаем с ' + Lampa.Utils.secondsToTime(time, true));
      } catch (e) {}
    }

    function detach() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      if (saveTimer) {
        clearInterval(saveTimer);
        saveTimer = null;
      }

      if (video && handlers) {
        try { video.removeEventListener('loadedmetadata', handlers.loaded); } catch (e) {}
        try { video.removeEventListener('canplay', handlers.canplay); } catch (e) {}
        try { video.removeEventListener('timeupdate', handlers.timeupdate); } catch (e) {}
        try { video.removeEventListener('pause', handlers.pause); } catch (e) {}
        try { video.removeEventListener('seeking', handlers.seeking); } catch (e) {}
        try { video.removeEventListener('ended', handlers.ended); } catch (e) {}
      }

      video = null;
      handlers = null;
      bindAttempts = 0;
      resumeApplied = false;
    }

    function bindVideo() {
      if (!active) return false;

      var v = getVideo();
      if (!v) return false;

      if (video === v && handlers) {
        applyResume();
        return true;
      }

      if (video && handlers) {
        try { persist(); } catch (e) {}
      }

      video = v;
      resumeApplied = false;

      var lastTimeUpdate = 0;

      handlers = {
        loaded: function () {
          setTimeout(applyResume, 100);
          setTimeout(applyResume, 500);
        },
        canplay: function () {
          setTimeout(applyResume, 100);
        },
        timeupdate: function () {
          var now = Date.now();
          if (now - lastTimeUpdate > 1800) {
            lastTimeUpdate = now;
            persist();
          }
        },
        pause: function () {
          persist();
        },
        seeking: function () {
          setTimeout(function () { persist(); }, 250);
        },
        ended: function () {
          persist(100);
          var callback = active && active.onEnded;
          setTimeout(function () {
            try { if (callback) callback(); } catch (e) {}
          }, 350);
        }
      };

      try { video.addEventListener('loadedmetadata', handlers.loaded); } catch (e) {}
      try { video.addEventListener('canplay', handlers.canplay); } catch (e) {}
      try { video.addEventListener('timeupdate', handlers.timeupdate); } catch (e) {}
      try { video.addEventListener('pause', handlers.pause); } catch (e) {}
      try { video.addEventListener('seeking', handlers.seeking); } catch (e) {}
      try { video.addEventListener('ended', handlers.ended); } catch (e) {}

      saveTimer = setInterval(function () {
        persist();
      }, 2500);

      setTimeout(applyResume, 250);
      setTimeout(applyResume, 900);
      setTimeout(applyResume, 1800);

      return true;
    }

    function arm(context) {
      try { persist(); } catch (e) {}
      detach();

      active = context;
      bindAttempts = 0;

      /*
        Player.play может создать <video> не сразу, поэтому ждём до 15 сек.
      */
      pollTimer = setInterval(function () {
        bindAttempts++;
        if (bindVideo() || bindAttempts > 60) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 250);

      setTimeout(bindVideo, 0);
      setTimeout(bindVideo, 300);
      setTimeout(bindVideo, 1000);
    }

    function playerStarted() {
      if (!active) return;
      setTimeout(bindVideo, 50);
      setTimeout(bindVideo, 400);
      setTimeout(bindVideo, 1200);
    }

    function playerDestroyed() {
      try { persist(); } catch (e) {}
      detach();
      active = null;
    }

    return {
      arm: arm,
      started: playerStarted,
      destroyed: playerDestroyed,
      save: persist,
      getSaved: getSaved,
      threshold: threshold
    };
  })();

  function addSettings() {
    if (!Lampa.SettingsApi) return;

    try {
      Lampa.SettingsApi.addComponent({
        component:
          'hdrezka_premium_settings',

        name:
          'HDREZKA Premium • by DENYS',

        icon:
          '<svg width="24" height="24" viewBox="0 0 24 24">' +
          '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
          '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/>' +
          '</svg>'
      });
    } catch (e) {}

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          'hdrezka_pair_account',

        type:
          'button'
      },

      field: {
        name:
          '🔐 Подключить HDRezka',

        description:
          'Filmix-style: код на TV → вход с телефона/ПК. Пароль на телевизоре не хранится.'
      },

      onChange:
        function () {
          openAccountMenu();
        }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.login,
        type:
          'input',
        values:
          '',
        default:
          ''
      },

      field: {
        name:
          'Логин / E-mail HDRezka',

        description:
          'Резервный способ входа. Рекомендуется кнопка «Подключить HDRezka»'
      },

      onChange:
        function () {
          setValue(
            STORAGE.session,
            ''
          );
        }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.password,
        type:
          'input',
        values:
          '',
        default:
          ''
      },

      field: {
        name:
          'Пароль HDRezka',

        description:
          'Резервный способ. При подключении по коду пароль на TV не хранится.'
      },

      onChange:
        function () {
          setValue(
            STORAGE.session,
            ''
          );
        }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.quality,
        type:
          'select',
        values: {
          'max': 'Максимальное',
          '2160': 'До 2160p',
          '1080': 'До 1080p',
          '720': 'До 720p',
          '480': 'До 480p'
        },
        default:
          'max'
      },

      field: {
        name:
          'Качество по умолчанию',

        description:
          'Плеер всё равно получает весь список качеств'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.rememberVoice,
        type:
          'select',
        values: {
          '1': 'Да',
          '0': 'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Запоминать озвучку',

        description:
          'Для каждого фильма и сериала отдельно'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.continueMode,
        type:
          'select',
        values: {
          '1': 'Да',
          '0': 'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Продолжать с последнего сезона',

        description:
          'Помечает последнюю запущенную серию и возвращает к её сезону'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.playerMode,
        type:
          'select',
        values: {
          'lampa':
            'Встроенный Lampa — рекомендуется',
          'system':
            'Как в общих настройках Lampa'
        },
        default:
          'lampa'
      },

      field: {
        name:
          'Плеер HDREZKA',

        description:
          'Встроенный Lampa нужен для нормального таймкода, NEXT/PREV и плейлиста'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.resumeMode,
        type:
          'select',
        values: {
          'continue':
            'Автоматически продолжать',
          'ask':
            'Спрашивать: продолжить или сначала',
          'again':
            'Всегда с начала'
        },
        default:
          'continue'
      },

      field: {
        name:
          'Таймкод HDREZKA',

        description:
          'Работает независимо от общей настройки Lampa, пока открыт HDREZKA'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.autoNext,
        type:
          'select',
        values: {
          '1':
            'Да',
          '0':
            'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Авто следующая серия',

        description:
          'После конца серии Lampa сама включает следующую, включая переход между сезонами'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.prefetchNext,
        type:
          'select',
        values: {
          '1':
            'Да',
          '0':
            'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Подготавливать следующую серию',

        description:
          'Заранее получает следующий Premium-поток, чтобы NEXT запускался быстрее'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.focusContinue,
        type:
          'select',
        values: {
          '1':
            'Да',
          '0':
            'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Фокус на серии «Продолжить»',

        description:
          'При входе сразу выделяет последнюю незавершённую серию'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.watchedAt,
        type:
          'select',
        values: {
          '85': '85%',
          '90': '90%',
          '95': '95%',
          '98': '98%'
        },
        default:
          '95'
      },

      field: {
        name:
          'Считать просмотренным после',

        description:
          'После этого процента показывается ✓ Просмотрено'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.showProgress,
        type:
          'select',
        values: {
          '1': 'Да',
          '0': 'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Показывать прогресс',

        description:
          'Процент, таймкод и полоска прямо в списке серий'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          'hdrezka_premium_denys_edition',
        type:
          'select',
        values: {
          'denys':
            'DENYS EDITION • v' +
            VERSION
        },
        default:
          'denys'
      },

      field: {
        name:
          'Автор',

        description:
          'HDREZKA Premium for Lampa • SAME-ORIGIN MSX • by DENYS'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          'hdrezka_premium_server',
        type:
          'input',
        values:
          '',
        default:
          API
      },

      field: {
        name:
          'Сервер',

        description:
          'Backend HDREZKA Premium • by DENYS. Менять не нужно.'
      }
    });
  }

  function addStyle() {
    try {
      if ($('#hdrezka-denys-style').length) {
        return;
      }

      var css =
        '<style id="hdrezka-denys-style">' +
        '.hdrezka-denys-brand{' +
          'display:flex;' +
          'align-items:center;' +
          'gap:.7em;' +
          'padding:.65em 1em;' +
          'margin:0 0 .65em 0;' +
          'border:1px solid rgba(255,255,255,.16);' +
          'border-radius:.65em;' +
          'background:rgba(0,0,0,.14);' +
        '}' +
        '.hdrezka-denys-brand__logo{' +
          'font-size:1.05em;' +
          'font-weight:700;' +
          'letter-spacing:.04em;' +
        '}' +
        '.hdrezka-denys-brand__edition{' +
          'opacity:.72;' +
          'font-size:.86em;' +
        '}' +
        '.hdrezka-denys-brand__status{' +
          'margin-left:auto;' +
          'opacity:.78;' +
          'font-size:.82em;' +
          'white-space:nowrap;' +
        '}' +
        '.view--hdrezka-premium span:after{' +
          'content:" • DENYS";' +
          'opacity:.58;' +
          'font-size:.72em;' +
        '}' +
        '.view--hdrezka-account span{' +
          'font-size:.82em;' +
          'font-weight:700;' +
        '}' +
        '.hdrezka-pair{' +
          'text-align:center;' +
          'padding:1.2em .8em;' +
        '}' +
        '.hdrezka-pair__title{' +
          'font-size:1.25em;' +
          'font-weight:700;' +
          'margin-bottom:1.1em;' +
        '}' +
        '.hdrezka-pair__hint{' +
          'opacity:.7;' +
          'margin:.55em 0;' +
        '}' +
        '.hdrezka-pair__url{' +
          'font-size:1.05em;' +
          'font-weight:600;' +
          'word-break:break-all;' +
          'margin:.4em 0 1em;' +
        '}' +
        '.hdrezka-pair__code{' +
          'font-size:2.6em;' +
          'font-weight:800;' +
          'letter-spacing:.18em;' +
          'margin:.2em 0 .65em;' +
        '}' +
        '.hdrezka-pair__state{' +
          'font-size:1em;' +
          'margin-top:.7em;' +
        '}' +
        '.hdrezka-pair__brand{' +
          'opacity:.5;' +
          'font-size:.75em;' +
          'margin-top:1.4em;' +
        '}' +
        '</style>';

      $('head').append(css);
    } catch (e) {}
  }

  function addTemplates() {
    try {
      Lampa.Template.add(
        'hdrezka_premium_item',
        '<div class="online selector">' +
          '<div class="online__body">' +
            '<div class="online__title">{title}</div>' +
            '<div class="online__quality">{quality}{info}</div>' +
          '</div>' +
        '</div>'
      );
    } catch (e) {}
  }


  /*
    ============================================================
    DENYS PLAYER SCOPE v4
    ============================================================
    Корень двух прошлых проблем был не в Rezka:
    1) Lampa могла отдавать HDRezka во внешний/системный плеер.
       Тогда Lampa.Timeline и Lampa Playlist вообще не управляют видео.
    2) В v3 мы передавали playlist = [first], то есть следующей серии
       физически не существовало в плейлисте.

    v4 по умолчанию запускает именно ВНУТРЕННИЙ плеер Lampa,
    временно включает native timecode "continue" и playlist_next,
    а после выхода возвращает пользовательские настройки обратно.
  */
  var DenysPlayerScope = (function () {
    var active = false;
    var originalTimecode = null;
    var originalPlaylistNext = null;
    var restoreTimer = null;

    function resumePolicy() {
      var raw = setting(
        STORAGE.resumeMode,
        'continue'
      );

      /* миграция старых значений v2/v3 */
      if (raw === '1') return 'continue';
      if (raw === '0') return 'again';

      if (
        raw !== 'continue' &&
        raw !== 'ask' &&
        raw !== 'again'
      ) {
        return 'continue';
      }

      return raw;
    }

    function useInternalPlayer() {
      return setting(
        STORAGE.playerMode,
        'lampa'
      ) !== 'system';
    }

    function begin() {
      if (restoreTimer) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }

      if (!active) {
        try {
          originalTimecode =
            Lampa.Storage.get(
              'player_timecode',
              'continue'
            );
        } catch (e) {
          originalTimecode =
            'continue';
        }

        try {
          originalPlaylistNext =
            Lampa.Storage.get(
              'playlist_next',
              true
            );
        } catch (e) {
          originalPlaylistNext =
            true;
        }
      }

      active = true;

      if (useInternalPlayer()) {
        try {
          Lampa.Storage.set(
            'player_timecode',
            resumePolicy()
          );
        } catch (e) {}

        if (
          setting(
            STORAGE.autoNext,
            '1'
          ) === '1'
        ) {
          try {
            Lampa.Storage.set(
              'playlist_next',
              true
            );
          } catch (e) {}
        }
      }
    }

    function decorate(item) {
      item =
        item ||
        {};

      item.hdrezka_denys =
        true;

      /*
        Ключевой фикс.
        'lampa' принудительно запускает внутренний player.js,
        где реально работают Timeline и Playlist.
      */
      if (useInternalPlayer()) {
        item.launch_player =
          'lampa';
      }

      return item;
    }

    function onStart(data) {
      if (
        data &&
        data.hdrezka_denys
      ) {
        begin();
      }
    }

    function restore() {
      if (!active) return;

      try {
        if (
          originalTimecode !== null
        ) {
          Lampa.Storage.set(
            'player_timecode',
            originalTimecode
          );
        }
      } catch (e) {}

      try {
        if (
          originalPlaylistNext !== null
        ) {
          Lampa.Storage.set(
            'playlist_next',
            originalPlaylistNext
          );
        }
      } catch (e) {}

      active = false;
      originalTimecode = null;
      originalPlaylistNext = null;
      restoreTimer = null;
    }

    function onDestroy() {
      if (!active) return;

      /*
        При NEXT внутри Lampa:
        destroy текущей серии -> сразу start следующей.
        Поэтому не восстанавливаем настройки мгновенно.
      */
      if (restoreTimer) {
        clearTimeout(
          restoreTimer
        );
      }

      restoreTimer =
        setTimeout(
          restore,
          900
        );
    }

    return {
      begin: begin,
      decorate: decorate,
      onStart: onStart,
      onDestroy: onDestroy,
      resumePolicy: resumePolicy,
      internal: useInternalPlayer
    };
  })();

  function component(object) {
    var scroll =
      new Lampa.Scroll({
        mask: true,
        over: true
      });

    var files =
      new Lampa.Explorer(object);

    var filter =
      new Lampa.Filter(object);

    var brand =
      $(
        '<div class="hdrezka-denys-brand">' +
          '<div class="hdrezka-denys-brand__logo">HDREZKA Premium</div>' +
          '<div class="hdrezka-denys-brand__edition">by DENYS · v' +
          VERSION +
          '</div>' +
          '<div class="hdrezka-denys-brand__status">' +
          (
            value(STORAGE.session)
              ? '● Аккаунт подключён'
              : '○ Вход при первом запуске'
          ) +
          '</div>' +
        '</div>'
      );

    var details = null;
    var last = null;

    var choice = {
      voice: 0,
      season: 0
    };

    scroll
      .body()
      .addClass('torrent-list');

    scroll.minus(
      files
        .render()
        .find(
          '.explorer__files-head'
        )
    );

    function currentVoice() {
      if (
        !details ||
        !details.voices ||
        !details.voices.length
      ) {
        return null;
      }

      if (
        !details.voices[
          choice.voice
        ]
      ) {
        choice.voice = 0;
      }

      return details.voices[
        choice.voice
      ];
    }

    function currentSeason() {
      if (
        !details ||
        !details.seasons ||
        !details.seasons.length
      ) {
        return null;
      }

      if (
        !details.seasons[
          choice.season
        ]
      ) {
        choice.season = 0;
      }

      return details.seasons[
        choice.season
      ];
    }

    function preferenceKey() {
      if (
        details &&
        details.url
      ) {
        return details.url;
      }

      var movie =
        object.movie || {};

      return (
        movieTitle(movie) +
        '|' +
        (
          yearFromMovie(movie) ||
          ''
        )
      );
    }


    function timelineBaseTitle() {
      var movie =
        object.movie ||
        {};

      return (
        movie.original_name ||
        movie.original_title ||
        movie.name ||
        movie.title ||
        (
          details &&
          details.name
        ) ||
        'HDREZKA'
      );
    }

    /*
      Используем ТОТ ЖЕ hash, что официальный Lampa и лучшие
      online-плагины. Благодаря этому:
      - native resume;
      - полоска прогресса;
      - синхронизация Timeline аккаунта Lampa;
      - watched status;
      - совместимость с другими online-источниками.
    */
    function timelineHash(episode) {
      var title =
        timelineBaseTitle();

      if (
        details &&
        details.is_series &&
        episode
      ) {
        var season =
          parseInt(
            episode.season_id,
            10
          ) || 1;

        var ep =
          parseInt(
            episode.episode_id,
            10
          ) || 1;

        return Lampa.Utils.hash(
          [
            season,
            season > 10
              ? ':'
              : '',
            ep,
            title
          ].join('')
        );
      }

      return Lampa.Utils.hash(
        title
      );
    }

    function timelineView(episode) {
      try {
        return Lampa.Timeline.view(
          timelineHash(
            episode
          )
        );
      }
      catch (e) {
        return {
          hash:
            timelineHash(
              episode
            ),
          percent:
            0,
          time:
            0,
          duration:
            0
        };
      }
    }

    function timelineRoad(
      view
    ) {
      return {
        percent:
          parseFloat(
            view &&
            view.percent ||
            0
          ) || 0,

        time:
          parseFloat(
            view &&
            view.time ||
            0
          ) || 0,

        duration:
          parseFloat(
            view &&
            view.duration ||
            0
          ) || 0
      };
    }

    function nextEpisodeAfter(episode) {
      if (
        !details ||
        !details.is_series ||
        !episode ||
        !details.episodes
      ) {
        return null;
      }

      var ordered =
        details.episodes
          .slice()
          .sort(
            function (a, b) {
              var sa =
                parseInt(
                  a.season_id,
                  10
                ) || 0;

              var sb =
                parseInt(
                  b.season_id,
                  10
                ) || 0;

              if (sa !== sb) {
                return sa - sb;
              }

              return (
                (
                  parseInt(
                    a.episode_id,
                    10
                  ) || 0
                ) -
                (
                  parseInt(
                    b.episode_id,
                    10
                  ) || 0
                )
              );
            }
          );

      for (
        var i = 0;
        i < ordered.length;
        i++
      ) {
        if (
          String(
            ordered[i].season_id
          ) ===
          String(
            episode.season_id
          ) &&
          String(
            ordered[i].episode_id
          ) ===
          String(
            episode.episode_id
          )
        ) {
          return (
            ordered[i + 1] ||
            null
          );
        }
      }

      return null;
    }

    function saveTimelineProgress(
      episode,
      road
    ) {
      if (!details) return;

      savePreference();

      var key =
        preferenceKey();

      var all =
        readJson(
          STORAGE.progress
        );

      var current =
        all[key] ||
        {};

      var voice =
        currentVoice();

      var season =
        currentSeason();

      var percent =
        parseFloat(
          road &&
          road.percent ||
          0
        ) || 0;

      var time =
        parseFloat(
          road &&
          road.time ||
          0
        ) || 0;

      var duration =
        parseFloat(
          road &&
          road.duration ||
          0
        ) || 0;

      current.voice =
        voice
          ? voice.name
          : (
              current.voice ||
              ''
            );

      current.time =
        time;

      current.duration =
        duration;

      current.percent =
        percent;

      current.updated =
        Date.now();

      if (
        details.is_series &&
        episode
      ) {
        current.season =
          episode.season_id ||
          (
            season
              ? season.id
              : null
          );

        current.episode =
          episode.episode_id;

        /*
          Если серия реально досмотрена,
          "Продолжить" переносим на следующую.
          Таймлайн текущей серии при этом остаётся
          в нативном Lampa.Timeline и показывает 100%.
        */
        if (percent >= DenysPlayback.threshold()) {
          var next =
            nextEpisodeAfter(
              episode
            );

          if (next) {
            current.season =
              next.season_id;

            current.episode =
              next.episode_id;

            current.time =
              0;

            current.duration =
              0;

            current.percent =
              0;
          }
        }
      }

      all[key] =
        current;

      writeJson(
        STORAGE.progress,
        all
      );
    }

    function wrapTimeline(
      view,
      episode
    ) {
      if (!view) return view;

      if (
        view._hdrezka_denys_wrapped
      ) {
        return view;
      }

      var original =
        view.handler;

      var lastSave =
        0;

      view.handler =
        function (
          percent,
          time,
          duration
        ) {
          if (original) {
            try {
              original(
                percent,
                time,
                duration
              );
            }
            catch (e) {}
          }

          var now =
            Date.now();

          if (
            now - lastSave >
              1000 ||
            percent >= DenysPlayback.threshold()
          ) {
            lastSave =
              now;

            saveTimelineProgress(
              episode,
              {
                percent:
                  percent,

                time:
                  time,

                duration:
                  duration
              }
            );
          }
        };

      view._hdrezka_denys_wrapped =
        true;

      return view;
    }

    function findVoiceIndex(name) {
      if (
        !name ||
        !details ||
        !details.voices
      ) {
        return -1;
      }

      for (
        var i = 0;
        i < details.voices.length;
        i++
      ) {
        if (
          details.voices[i] &&
          details.voices[i].name === name
        ) {
          return i;
        }
      }

      return -1;
    }

    function findSeasonIndex(id) {
      if (
        id === null ||
        typeof id === 'undefined' ||
        !details ||
        !details.seasons
      ) {
        return -1;
      }

      for (
        var i = 0;
        i < details.seasons.length;
        i++
      ) {
        if (
          String(
            details.seasons[i].id
          ) ===
          String(id)
        ) {
          return i;
        }
      }

      return -1;
    }

    function savedState() {
      var key =
        preferenceKey();

      var preferences =
        readJson(
          STORAGE.preferences
        );

      var progress =
        readJson(
          STORAGE.progress
        );

      return {
        pref:
          preferences[key] ||
          {},
        progress:
          progress[key] ||
          {}
      };
    }

    function savePreference() {
      if (!details) return;

      var key =
        preferenceKey();

      var preferences =
        readJson(
          STORAGE.preferences
        );

      var current =
        preferences[key] ||
        {};

      var voice =
        currentVoice();

      var season =
        currentSeason();

      if (
        setting(
          STORAGE.rememberVoice,
          '1'
        ) === '1' &&
        voice
      ) {
        current.voice =
          voice.name;
      }

      if (season) {
        current.season =
          season.id;
      }

      current.updated =
        Date.now();

      preferences[key] =
        current;

      writeJson(
        STORAGE.preferences,
        preferences
      );
    }

    function saveProgress(episode) {
      if (!details) return;

      savePreference();

      var key =
        preferenceKey();

      var progress =
        readJson(
          STORAGE.progress
        );

      var current =
        progress[key] ||
        {};

      var voice =
        currentVoice();

      var season =
        currentSeason();

      current.voice =
        voice
          ? voice.name
          : (
              current.voice ||
              ''
            );

      current.updated =
        Date.now();

      if (
        details.is_series &&
        episode
      ) {
        current.season =
          episode.season_id ||
          (
            season
              ? season.id
              : null
          );

        current.episode =
          episode.episode_id;
      }

      /*
        Не сбрасываем time/duration/percent при повторном
        открытии той же серии/фильма — это и есть resume.
      */

      progress[key] =
        current;

      writeJson(
        STORAGE.progress,
        progress
      );
    }

    function restoreChoice() {
      if (!details) {
        return null;
      }

      var state =
        savedState();

      var wantedSeason =
        null;

      if (
        setting(
          STORAGE.rememberVoice,
          '1'
        ) === '1'
      ) {
        var voiceName =
          (
            state.progress &&
            state.progress.voice
          ) ||
          (
            state.pref &&
            state.pref.voice
          );

        var voiceIndex =
          findVoiceIndex(
            voiceName
          );

        if (
          voiceIndex >= 0
        ) {
          choice.voice =
            voiceIndex;
        }
      }

      if (
        setting(
          STORAGE.continueMode,
          '1'
        ) === '1'
      ) {
        wantedSeason =
          (
            state.progress &&
            state.progress.season
          );
      }

      if (
        wantedSeason === null ||
        typeof wantedSeason ===
          'undefined'
      ) {
        wantedSeason =
          (
            state.pref &&
            state.pref.season
          );
      }

      return wantedSeason;
    }

    function applySeason(id) {
      var index =
        findSeasonIndex(id);

      if (
        index >= 0
      ) {
        choice.season =
          index;
      }
    }

    function finishDetails(self) {
      var wantedSeason =
        restoreChoice();

      var voice =
        currentVoice();

      if (
        details &&
        details.is_series &&
        voice &&
        String(voice.id) !==
          String(
            details.default_voice_id
          )
      ) {
        self.loadEpisodes(
          voice,
          wantedSeason
        );
        return;
      }

      applySeason(
        wantedSeason
      );

      self.renderFilter();
      self.renderItems();
    }

    function loadDetails(url) {
      var self = this;

      self.activity.loader(true);

      return api(
        '/api/details',
        {
          url: url
        }
      ).then(function (data) {
        if (
          !data ||
          !data.details
        ) {
          throw new Error(
            'HDREZKA: пустой ответ'
          );
        }

        details = data.details;
        choice.voice = 0;
        choice.season = 0;

        finishDetails(
          self
        );
      });
    }

    function resolveMovie() {
      var self = this;
      var movie = object.movie || {};

      self.activity.loader(true);
      self.reset();

      return api(
        '/api/resolve',
        {
          title:
            movieTitle(movie),

          original_title:
            originalTitle(movie),

          year:
            yearFromMovie(movie)
        }
      ).then(function (data) {
        if (
          data &&
          data.select &&
          data.results &&
          data.results.length
        ) {
          var rows =
            data.results.map(
              function (row) {
                return {
                  title:
                    row.name +
                    (
                      row.year
                        ? (
                            ' (' +
                            row.year +
                            ')'
                          )
                        : ''
                    ),

                  subtitle:
                    [
                      row.country,
                      row.genre
                    ]
                      .filter(Boolean)
                      .join(' · '),

                  data:
                    row
                };
              }
            );

          Lampa.Select.show({
            title:
              'Выберите фильм HDREZKA',

            items:
              rows,

            onSelect:
              function (row) {
                loadDetails
                  .call(
                    self,
                    row.data.url
                  )
                  .catch(
                    function (error) {
                      self.empty(
                        error.message
                      );
                    }
                  );
              }
          });

          self.activity.loader(false);
          return;
        }

        if (
          !data ||
          !data.details
        ) {
          throw new Error(
            'HDREZKA: фильм не найден'
          );
        }

        details = data.details;
        choice.voice = 0;
        choice.season = 0;

        finishDetails(
          self
        );
      });
    }

    this.create = function () {
      var self = this;

      this.activity.loader(true);

      filter.onSearch =
        function (value) {
          Lampa.Activity.replace({
            search:
              value,
            search_date:
              '',
            clarification:
              true
          });
        };

      filter.onBack =
        function () {
          self.start();
        };

      filter.onSelect =
        function (
          type,
          a,
          b
        ) {
          if (
            type !==
            'filter'
          ) {
            return;
          }

          if (a.reset) {
            choice.voice = 0;
            choice.season = 0;

            savePreference();

            if (
              details &&
              details.is_series
            ) {
              self.loadEpisodes(
                currentVoice()
              );
            }
            else {
              self.renderFilter();
              self.renderItems();
            }

            return;
          }

          if (
            a.stype ===
            'balancer'
          ) {
            return;
          }

          if (
            a.stype ===
            'voice'
          ) {
            choice.voice =
              b.index;

            choice.season = 0;

            if (
              details &&
              details.is_series
            ) {
              self.loadEpisodes(
                currentVoice()
              );
            }
            else {
              self.renderFilter();
              self.renderItems();
            }

            return;
          }

          if (
            a.stype ===
            'season'
          ) {
            choice.season =
              b.index;

            savePreference();

            self.renderFilter();
            self.renderItems();
          }
        };

      try {
        filter
          .render()
          .find(
            '.filter--sort'
          )
          .hide();
      } catch (e) {}

      files.appendHead(
        brand
      );

      files.appendHead(
        filter.render()
      );

      files.appendFiles(
        scroll.render()
      );

      resolveMovie
        .call(this)
        .catch(
          function (error) {
            self.empty(
              error.message ||
              'Ошибка HDREZKA'
            );
          }
        );

      return this.render();
    };

    this.loadEpisodes =
      function (
        voice,
        wantedSeason
      ) {
        var self = this;

        if (
          !details ||
          !voice
        ) {
          this.empty(
            'HDREZKA: озвучка не найдена'
          );
          return;
        }

        this.activity.loader(true);

        api(
          '/api/episodes',
          {
            url:
              details.url,

            translator_id:
              voice.id
          }
        ).then(function (data) {
          details.seasons =
            data.seasons || [];

          details.episodes =
            data.episodes || [];

          choice.season = 0;

          applySeason(
            wantedSeason
          );

          savePreference();

          self.renderFilter();
          self.renderItems();
        }).catch(function (error) {
          self.empty(
            error.message
          );
        });
      };

    this.renderFilter =
      function () {
        if (!details) return;

        var select = [
          {
            title:
              'Сбросить',

            reset:
              true
          },
          {
            title:
              'Балансер',

            subtitle:
              'HDREZKA Premium',

            stype:
              'balancer',

            items: [
              {
                title:
                  'HDREZKA Premium',

                selected:
                  true,

                index:
                  0
              }
            ]
          }
        ];

        function add(
          type,
          title,
          source,
          selectedIndex
        ) {
          if (
            !source ||
            !source.length
          ) {
            return;
          }

          var items =
            source.map(
              function (
                row,
                index
              ) {
                return {
                  title:
                    row.name ||
                    String(
                      index + 1
                    ),

                  selected:
                    index ===
                    selectedIndex,

                  index:
                    index
                };
              }
            );

          select.push({
            title:
              title,

            subtitle:
              items[
                selectedIndex
              ]
                ? items[
                    selectedIndex
                  ].title
                : '',

            items:
              items,

            stype:
              type
          });
        }

        add(
          'voice',
          'Озвучка',
          details.voices || [],
          choice.voice
        );

        if (
          details.is_series
        ) {
          add(
            'season',
            'Сезон',
            details.seasons || [],
            choice.season
          );
        }

        filter.set(
          'filter',
          select
        );

        var chosen = [
          'Балансер: HDREZKA Premium'
        ];

        var voice =
          currentVoice();

        var season =
          currentSeason();

        if (
          voice &&
          voice.name
        ) {
          chosen.push(
            'Озвучка: ' +
            voice.name
          );
        }

        if (
          details.is_series &&
          season &&
          season.name
        ) {
          chosen.push(
            'Сезон: ' +
            season.name
          );
        }

        try {
          filter.chosen(
            'filter',
            chosen
          );
        } catch (e) {}
      };

    var streamMemory =
      {};

    function episodeKey(
      episode,
      voice
    ) {
      return [
        details &&
        details.url ||
        '',
        voice &&
        voice.id ||
        '',
        episode &&
        episode.season_id ||
        0,
        episode &&
        episode.episode_id ||
        0
      ].join('|');
    }

    function requestStream(
      episode,
      voice
    ) {
      var key =
        episodeKey(
          episode,
          voice
        );

      if (
        streamMemory[key]
      ) {
        return streamMemory[key];
      }

      var promise =
        api(
          '/api/stream',
          {
            url:
              details.url,

            translator_id:
              voice.id,

            season:
              details.is_series
                ? episode.season_id
                : null,

            episode:
              details.is_series
                ? episode.episode_id
                : null
          }
        ).then(
          function (data) {
            if (
              !data ||
              !data.url
            ) {
              throw new Error(
                'HDREZKA не вернула видеопоток'
              );
            }

            return data;
          }
        ).catch(
          function (error) {
            delete streamMemory[key];
            throw error;
          }
        );

      streamMemory[key] =
        promise;

      return promise;
    }

    function sortedEpisodes() {
      return (
        details &&
        details.episodes
          ? details.episodes.slice()
          : []
      ).sort(
        function (a, b) {
          var sa =
            parseInt(
              a.season_id,
              10
            ) || 0;

          var sb =
            parseInt(
              b.season_id,
              10
            ) || 0;

          if (sa !== sb) {
            return sa - sb;
          }

          return (
            (
              parseInt(
                a.episode_id,
                10
              ) || 0
            ) -
            (
              parseInt(
                b.episode_id,
                10
              ) || 0
            )
          );
        }
      );
    }

    function episodePlayerTitle(
      episode
    ) {
      var base =
        movieTitle(
          object.movie ||
          {}
        );

      if (
        !details ||
        !details.is_series ||
        !episode
      ) {
        return base;
      }

      return (
        base +
        ' / S' +
        episode.season_id +
        'E' +
        episode.episode_id +
        ' / ' +
        (
          episode.name ||
          (
            'Серия ' +
            episode.episode_id
          )
        )
      );
    }

    function addHistory() {
      try {
        if (
          object.movie &&
          object.movie.id &&
          Lampa.Favorite &&
          Lampa.Favorite.add
        ) {
          Lampa.Favorite.add(
            'history',
            object.movie,
            100
          );
        }
      }
      catch (e) {}
    }

    function preparePlayerItem(
      episode,
      voice
    ) {
      var timeline =
        wrapTimeline(
          timelineView(
            details.is_series
              ? episode
              : null
          ),
          details.is_series
            ? episode
            : null
        );

      var item = {
        title:
          episodePlayerTitle(
            episode
          ),

        quality:
          {},

        subtitles:
          [],

        timeline:
          timeline,

        card:
          object.movie,

        movie:
          object.movie,

        season:
          details.is_series
            ? episode.season_id
            : null,

        episode:
          details.is_series
            ? episode.episode_id
            : null
      };

      DenysPlayerScope.decorate(
        item
      );

      return item;
    }

    function buildRealPlaylist(
      selectedEpisode,
      voice,
      selectedData
    ) {
      var listEpisodes =
        details.is_series
          ? sortedEpisodes()
          : [
              {
                season_id:
                  null,
                episode_id:
                  null,
                name:
                  'Смотреть фильм'
              }
            ];

      var playlist =
        [];

      var first =
        null;

      listEpisodes.forEach(
        function (ep) {
          var playerItem =
            preparePlayerItem(
              ep,
              voice
            );

          var isCurrent =
            !details.is_series ||
            (
              String(
                ep.season_id
              ) ===
              String(
                selectedEpisode.season_id
              ) &&
              String(
                ep.episode_id
              ) ===
              String(
                selectedEpisode.episode_id
              )
            );

          if (isCurrent) {
            playerItem.url =
              pickQuality(
                selectedData
              );

            playerItem.quality =
              selectedData.quality ||
              {};

            playerItem.subtitles =
              selectedData.subtitles ||
              [];

            first =
              playerItem;
          }
          else {
            /*
              Официальный Playlist Lampa умеет url как function(call).
              Поэтому NEXT/PREV может сам запросить поток нужной серии
              без выхода из плеера.
            */
            playerItem.url =
              function (call) {
                saveProgress(
                  ep
                );

                DenysPlayerScope.begin();

                notice(
                  'HDREZKA: серия ' +
                  ep.episode_id +
                  '…'
                );

                requestStream(
                  ep,
                  voice
                ).then(
                  function (data) {
                    playerItem.url =
                      pickQuality(
                        data
                      );

                    playerItem.quality =
                      data.quality ||
                      {};

                    playerItem.subtitles =
                      data.subtitles ||
                      [];

                    playerItem.timeline =
                      wrapTimeline(
                        timelineView(
                          ep
                        ),
                        ep
                      );

                    DenysPlayerScope.decorate(
                      playerItem
                    );

                    /*
                      Когда URL уже готов — родной Lampa Playlist
                      сам уничтожит текущую серию и запустит эту.
                    */
                    call();

                    prefetchAround(
                      ep,
                      voice
                    );
                  }
                ).catch(
                  function (error) {
                    notice(
                      'HDREZKA: ' +
                      error.message
                    );

                    try {
                      Lampa.Player.close();
                    } catch (e) {}
                  }
                );
              };
          }

          playlist.push(
            playerItem
          );
        }
      );

      if (!first) {
        first =
          playlist[0];
      }

      return {
        first:
          first,
        playlist:
          playlist
      };
    }

    function prefetchAround(
      episode,
      voice
    ) {
      if (
        setting(
          STORAGE.prefetchNext,
          '1'
        ) !== '1' ||
        !details.is_series
      ) {
        return;
      }

      var ordered =
        sortedEpisodes();

      var index =
        -1;

      for (
        var i = 0;
        i < ordered.length;
        i++
      ) {
        if (
          String(
            ordered[i].season_id
          ) ===
          String(
            episode.season_id
          ) &&
          String(
            ordered[i].episode_id
          ) ===
          String(
            episode.episode_id
          )
        ) {
          index = i;
          break;
        }
      }

      if (
        index >= 0 &&
        ordered[index + 1]
      ) {
        /*
          Ошибку prefetch не показываем — это только ускорение.
        */
        requestStream(
          ordered[index + 1],
          voice
        ).catch(
          function () {}
        );
      }
    }

    function launchPremium(
      episode,
      voice
    ) {
      saveProgress(
        details.is_series
          ? episode
          : null
      );

      addHistory();

      DenysPlayerScope.begin();

      notice(
        'HDREZKA: получаем Premium-поток…'
      );

      requestStream(
        details.is_series
          ? episode
          : {
              season_id:
                null,
              episode_id:
                null
            },
        voice
      ).then(
        function (data) {
          var built =
            buildRealPlaylist(
              details.is_series
                ? episode
                : {
                    season_id:
                      null,
                    episode_id:
                      null
                  },
              voice,
              data
            );

          var first =
            built.first;

          var playlist =
            built.playlist;

          /*
            Это настоящий playlist, а не [first].
            В сериале он содержит ВСЕ серии ВСЕХ сезонов
            выбранной озвучки.
          */
          first.playlist =
            playlist;

          DenysPlayerScope.decorate(
            first
          );

          Lampa.Player.play(
            first
          );

          Lampa.Player.playlist(
            playlist
          );

          prefetchAround(
            details.is_series
              ? episode
              : null,
            voice
          );
        }
      ).catch(
        function (error) {
          notice(
            'HDREZKA: ' +
            error.message
          );
        }
      );
    }

    this.renderItems =
      function () {
        var self = this;

        this.reset();

        if (!details) {
          this.empty(
            'HDREZKA: нет данных'
          );
          return;
        }

        var voice =
          currentVoice();

        var season =
          currentSeason();

        var items = [];

        if (
          details.is_series
        ) {
          if (!season) {
            this.empty(
              'HDREZKA: сезоны не найдены'
            );
            return;
          }

          items =
            (
              details.episodes ||
              []
            ).filter(
              function (episode) {
                return (
                  String(
                    episode.season_id
                  ) ===
                  String(
                    season.id
                  )
                );
              }
            );
        }
        else {
          items = [
            {
              name:
                'Смотреть фильм'
            }
          ];
        }

        if (!items.length) {
          this.empty(
            details.is_series
              ? 'HDREZKA: серии не найдены'
              : 'HDREZKA: видео не найдено'
          );
          return;
        }

        var continueTarget =
          null;

        items.forEach(
          function (episode) {
            var timeline =
              wrapTimeline(
                timelineView(
                  details.is_series
                    ? episode
                    : null
                ),
                details.is_series
                  ? episode
                  : null
              );

            var road =
              timelineRoad(
                timeline
              );

            var progress =
              readJson(
                STORAGE.progress
              )[
                preferenceKey()
              ] || {};

            var isContinue =
              details.is_series &&
              setting(
                STORAGE.continueMode,
                '1'
              ) === '1' &&
              season &&
              String(
                progress.season
              ) ===
              String(
                season.id
              ) &&
              String(
                progress.episode
              ) ===
              String(
                episode.episode_id
              );

            var displayTitle =
              episode.name ||
              (
                details.is_series
                  ? (
                      'Серия ' +
                      episode.episode_id
                    )
                  : 'Смотреть фильм'
              );

            if (isContinue) {
              displayTitle =
                '▶ ' +
                displayTitle;
            }

            var progressInfo =
              '';

            if (
              road.duration > 0 &&
              road.percent > 0 &&
              road.percent < DenysPlayback.threshold()
            ) {
              try {
                progressInfo =
                  ' • ' +
                  Math.round(
                    road.percent
                  ) +
                  '% • ' +
                  Lampa.Utils.secondsToTime(
                    road.time,
                    true
                  );
              }
              catch (e) {
                progressInfo =
                  ' • ' +
                  Math.round(
                    road.percent
                  ) +
                  '%';
              }
            }
            else if (
              road.percent >= DenysPlayback.threshold()
            ) {
              progressInfo =
                ' • ✓ ПРОСМОТРЕНО';
            }

            var element = {
              title:
                displayTitle,

              quality:
                qualityLabel(),

              info:
                (
                  voice &&
                  voice.name
                    ? (
                        ' / ' +
                        voice.name
                      )
                    : ''
                ) +
                (
                  isContinue
                    ? ' • ПРОДОЛЖИТЬ'
                    : ''
                ) +
                progressInfo
            };

            var item =
              Lampa.Template.get(
                'hdrezka_premium_item',
                element
              );

            if (
              isContinue &&
              setting(
                STORAGE.focusContinue,
                '1'
              ) === '1'
            ) {
              continueTarget =
                item[0];
            }

            /*
              Нативный прогресс Lampa:
              полоска, процент, таймкод и автоматическое
              сохранение/восстановление позиции.
            */
            try {
              if (
                setting(
                  STORAGE.showProgress,
                  '1'
                ) === '1' &&
                Lampa.Timeline &&
                Lampa.Timeline.render
              ) {
                item.append(
                  Lampa.Timeline.render(
                    timeline
                  )
                );
              }

              if (
                Lampa.Timeline &&
                Lampa.Timeline.details
              ) {
                item
                  .find(
                    '.online__quality'
                  )
                  .append(
                    Lampa.Timeline.details(
                      timeline,
                      ' / '
                    )
                  );
              }

              if (
                road.percent >= DenysPlayback.threshold()
              ) {
                item.append(
                  '<div class="torrent-item__viewed">' +
                  Lampa.Template.get(
                    'icon_star',
                    {},
                    true
                  ) +
                  '</div>'
                );
              }
            }
            catch (e) {}

            item.on(
              'hover:focus',
              function (e) {
                last =
                  e.target;

                scroll.update(
                  $(e.target),
                  true
                );
              }
            );

            item.on(
              'hover:enter',
              function () {
                if (!voice) {
                  notice(
                    'HDREZKA: озвучка не найдена'
                  );
                  return;
                }

                launchPremium(
                  details.is_series
                    ? episode
                    : {
                        season_id:
                          null,
                        episode_id:
                          null,
                        name:
                          'Смотреть фильм'
                      },
                  voice
                );
              }
            );

            scroll.append(
              item
            );
          }
        );

        this.activity.loader(false);

        if (
          continueTarget
        ) {
          last =
            continueTarget;

          this.start(false);

          setTimeout(
            function () {
              try {
                scroll.update(
                  $(continueTarget),
                  true
                );
              } catch (e) {}
            },
            80
          );
        }
        else {
          this.start(true);
        }
      };

    this.reset = function () {
      scroll
        .render()
        .find('.empty')
        .remove();

      scroll.clear();
      scroll.reset();
    };

    this.empty = function (message) {
      var empty =
        Lampa.Template.get(
          'list_empty'
        );

      if (message) {
        empty
          .find(
            '.empty__descr'
          )
          .text(message);
      }

      scroll.append(
        empty
      );

      this.activity.loader(false);
      this.start(true);
    };

    this.start = function (
      firstSelect
    ) {
      if (
        Lampa.Activity.active()
          .activity !==
        this.activity
      ) {
        return;
      }

      if (firstSelect) {
        last =
          scroll
            .render()
            .find(
              '.selector'
            )
            .eq(0)[0];
      }

      try {
        Lampa.Background.immediately(
          Lampa.Utils.cardImgBackground(
            object.movie
          )
        );
      } catch (e) {}

      Lampa.Controller.add(
        'content',
        {
          toggle:
            function () {
              Lampa.Controller
                .collectionSet(
                  scroll.render(),
                  files.render()
                );

              Lampa.Controller
                .collectionFocus(
                  last || false,
                  scroll.render()
                );
            },

          up:
            function () {
              if (
                Navigator.canmove(
                  'up'
                )
              ) {
                Navigator.move(
                  'up'
                );
              }
              else {
                Lampa.Controller.toggle(
                  'head'
                );
              }
            },

          down:
            function () {
              Navigator.move(
                'down'
              );
            },

          right:
            function () {
              if (
                Navigator.canmove(
                  'right'
                )
              ) {
                Navigator.move(
                  'right'
                );
              }
              else {
                filter.show(
                  'Фильтр',
                  'filter'
                );
              }
            },

          left:
            function () {
              if (
                Navigator.canmove(
                  'left'
                )
              ) {
                Navigator.move(
                  'left'
                );
              }
              else {
                Lampa.Controller.toggle(
                  'menu'
                );
              }
            },

          back:
            this.back
        }
      );

      Lampa.Controller.toggle(
        'content'
      );
    };

    this.render =
      function () {
        return files.render();
      };

    this.back =
      function () {
        Lampa.Activity.backward();
      };

    this.pause =
      function () {};

    this.stop =
      function () {};

    this.destroy =
      function () {
        try {
          files.destroy();
        } catch (e) {}

        try {
          scroll.destroy();
        } catch (e) {}
      };
  }

  function loadRezka(movie) {
    if (!movie) {
      notice(
        'HDREZKA: не удалось определить фильм'
      );
      return;
    }

    try {
      Lampa.Component.add(
        COMPONENT,
        component
      );
    } catch (e) {}

    Lampa.Activity.push({
      url: '',
      title: 'HDREZKA Premium • by DENYS',
      component: COMPONENT,
      search:
        movie.title ||
        movie.name ||
        '',
      search_one:
        movie.title ||
        movie.name ||
        '',
      search_two:
        movie.original_title ||
        movie.original_name ||
        '',
      movie:
        movie,
      page:
        1
    });
  }

  function addMainButton() {
    function playButton() {
      return $(
        '<div class="full-start__button selector view--hdrezka-premium" ' +
        'data-subtitle="HDREZKA Premium • by DENYS ' +
        VERSION +
        '">' +
          '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="64" cy="64" r="52" stroke="currentColor" stroke-width="12"/>' +
            '<path d="M88 64L51 86V42L88 64Z" fill="currentColor"/>' +
          '</svg>' +
          '<span>HDREZKA</span>' +
        '</div>'
      );
    }

    function accountButton() {
      var connected =
        accountConnected();

      return $(
        '<div class="full-start__button selector view--hdrezka-account" ' +
        'data-subtitle="' +
        (
          connected
            ? (
                'HDRezka подключена • ' +
                accountLabel()
              )
            : (
                'Подключить Premium-аккаунт HDRezka'
              )
        ) +
        '">' +
          '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="64" cy="43" r="21" stroke="currentColor" stroke-width="10"/>' +
            '<path d="M28 105c5-23 18-35 36-35s31 12 36 35" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>' +
          '</svg>' +
          '<span>' +
          (
            connected
              ? 'REZKA ✓'
              : 'ВОЙТИ'
          ) +
          '</span>' +
        '</div>'
      );
    }

    Lampa.Listener.follow(
      'full',
      function (e) {
        if (
          !e ||
          e.type !== 'complite' ||
          !e.object ||
          !e.object.activity
        ) {
          return;
        }

        var root =
          e.object.activity.render();

        /*
          Если старая версия успела оставить кнопку —
          заменяем её нашей v5.
        */
        root
          .find(
            '.view--hdrezka-premium, .view--hdrezka-account'
          )
          .remove();

        var movie =
          e.data &&
          e.data.movie
            ? e.data.movie
            : null;

        var play =
          playButton();

        var account =
          accountButton();

        play.on(
          'hover:enter',
          function () {
            if (
              !accountConnected() &&
              (
                !value(
                  STORAGE.login
                ) ||
                !value(
                  STORAGE.password
                )
              )
            ) {
              openPairing();
              return;
            }

            loadRezka(
              movie
            );
          }
        );

        account.on(
          'hover:enter',
          function () {
            openAccountMenu();
          }
        );

        function insertAfter(
          target
        ) {
          if (
            !target ||
            !target.length
          ) {
            return false;
          }

          target.after(
            play
          );

          play.after(
            account
          );

          updateAccountButtons();

          return true;
        }

        if (
          insertAfter(
            root.find(
              '.view--torrent'
            )
          )
        ) {
          return;
        }

        if (
          insertAfter(
            root.find(
              '.view--online_mod'
            )
          )
        ) {
          return;
        }

        var buttons =
          root.find(
            '.full-start__buttons'
          );

        if (!buttons.length) {
          buttons =
            root.find(
              '.full-start-new__buttons'
            );
        }

        if (buttons.length) {
          buttons.append(
            play
          );

          buttons.append(
            account
          );

          updateAccountButtons();
        }
      }
    );
  }

  function registerManifest() {
    try {
      Lampa.Manifest.plugins = {
        type:
          'video',

        version:
          VERSION,

        name:
          'HDREZKA Premium • by DENYS',

        description:
          'HDRezka Premium • SAME-ORIGIN MSX • pairing • playlist • timeline • by DENYS',

        component:
          COMPONENT,

        onContextMenu:
          function () {
            return {
              name:
                'HDREZKA Premium • by DENYS',

              description:
                'Ваш аккаунт HDRezka'
            };
          },

        onContextLauch:
          function (movie) {
            loadRezka(movie);
          }
      };
    } catch (e) {}
  }

  function installProgressSafety() {
    if (
      window.hdrezka_denys_progress_safety_v4
    ) {
      return;
    }

    window.hdrezka_denys_progress_safety_v4 =
      true;

    /*
      Используем родные события Lampa Player.
      Таймкод сохраняет официальный Player Timeline.
    */
    try {
      if (
        Lampa.Player &&
        Lampa.Player.listener
      ) {
        Lampa.Player.listener.follow(
          'start',
          function (data) {
            DenysPlayerScope.onStart(
              data
            );
          }
        );

        Lampa.Player.listener.follow(
          'destroy',
          function () {
            DenysPlayerScope.onDestroy();
          }
        );
      }
    }
    catch (e) {}
  }

  function init() {
    try {
      /*
        Миграция v2/v3:
        1 = continue, 0 = again.
      */
      if (
        value(
          STORAGE.resumeMode
        ) === '1'
      ) {
        setValue(
          STORAGE.resumeMode,
          'continue'
        );
      }
      else if (
        value(
          STORAGE.resumeMode
        ) === '0'
      ) {
        setValue(
          STORAGE.resumeMode,
          'again'
        );
      }

      addSettings();
      installProgressSafety();
      addStyle();
      addTemplates();
      addMainButton();
      registerManifest();
      updateAccountButtons();

      if (sameOrigin()) {
        wakeStatus(
          '● SAME ORIGIN • готов'
        );
      }

      console.log(
        'HDREZKA Premium • by DENYS ' +
        VERSION +
        ' started'
      );
    } catch (e) {
      notice(
        'HDREZKA Premium: ' +
        e.message
      );
    }
  }

  if (window.appready) {
    init();
  }
  else if (
    Lampa.Listener &&
    Lampa.Listener.follow
  ) {
    Lampa.Listener.follow(
      'app',
      function (e) {
        if (
          e &&
          e.type === 'ready'
        ) {
          init();
        }
      }
    );
  }
  else {
    setTimeout(
      init,
      1000
    );
  }
})();
