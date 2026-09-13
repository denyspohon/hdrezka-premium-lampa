(function () {
  'use strict';

  if (window.hdrezka_premium_lampa_ready) return;
  window.hdrezka_premium_lampa_ready = true;

  var API = '__API_BASE__';
  var VERSION = '8.0.0';
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
    transport: 'hdrezka_premium_transport_v8',
    accountName: 'hdrezka_premium_account_name',
    resumeMode: 'hdrezka_premium_resume_mode_v8',
    autoNext: 'hdrezka_premium_auto_next_v8',
    prefetch: 'hdrezka_premium_prefetch_v8',
    sessionVersion: 'hdrezka_premium_session_version_v8'
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

  function isMediaStationX() {
    if (window.TVXHost || window.TVXManager) return true;

    var ua = '';
    try {
      ua = String(navigator.userAgent || '');
    } catch (e) {}

    return /Media Station X|VIDAA|Hisense|SmartTV|HbbTV|Vewd|NetCast|Tizen|Web0S/i.test(ua);
  }

  function transportMode() {
    return setting(STORAGE.transport, 'auto');
  }

  function useJsonp() {
    var mode = transportMode();
    if (mode === 'jsonp') return true;
    if (mode === 'fetch') return false;
    return isMediaStationX();
  }

  function apiJsonpPath(path) {
    if (path.indexOf('/api/') === 0) {
      return '/jsonp/' + path.substr(5);
    }
    return path;
  }

  var jsonpCounter = 0;

  function jsonpGet(path, data, attempt) {
    attempt = attempt || 0;
    data = data || {};

    return new Promise(function (resolve, reject) {
      jsonpCounter++;

      var callback =
        '__hdrezka_denys_v8_' +
        Date.now() + '_' +
        jsonpCounter;

      var params = [];

      Object.keys(data).forEach(function (key) {
        var val = data[key];
        if (val === null || typeof val === 'undefined') return;
        params.push(
          encodeURIComponent(key) +
          '=' +
          encodeURIComponent(String(val))
        );
      });

      params.push(
        'callback=' +
        encodeURIComponent(callback)
      );

      params.push('_=' + Date.now());

      var script = document.createElement('script');
      var done = false;
      var timer = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[callback]; } catch (e) { window[callback] = undefined; }
        try {
          if (script && script.parentNode) script.parentNode.removeChild(script);
        } catch (e) {}
      }

      function fail(message) {
        if (done) return;
        done = true;
        cleanup();

        if (attempt < 2) {
          setTimeout(function () {
            jsonpGet(path, data, attempt + 1).then(resolve).catch(reject);
          }, attempt === 0 ? 1200 : 2600);
          return;
        }

        reject(new Error(message || 'Нет подключения к DENYS backend'));
      }

      window[callback] = function (payload) {
        if (done) return;
        done = true;
        cleanup();

        if (payload && payload.ok === false) {
          var error = new Error(payload.error || payload.detail || 'HDREZKA backend error');
          error.status = payload.status || 0;
          reject(error);
          return;
        }

        resolve(payload || {});
      };

      script.async = true;
      script.src =
        API + path +
        (path.indexOf('?') === -1 ? '?' : '&') +
        params.join('&');

      script.onerror = function () {
        fail('Media Station X не загрузил JSONP-ответ');
      };

      timer = setTimeout(function () {
        fail('Таймаут JSONP-соединения');
      }, 70000);

      wakeStatus('● TV JSONP • запрос…');

      (document.head || document.body || document.documentElement).appendChild(script);
    }).then(function (payload) {
      wakeStatus('● TV JSONP • online');
      return payload;
    });
  }

  function fetchPost(path, data, attempt) {
    attempt = attempt || 0;

    var wakeTimer = setTimeout(function () {
      wakeStatus('● Сервер просыпается…');
      if (attempt === 0) notice('HDREZKA: сервер просыпается, подождите…');
    }, 2500);

    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    })
      .then(function (response) {
        clearTimeout(wakeTimer);
        return response.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) {}

          if (!response.ok) {
            var error = new Error(
              (json && (json.detail || json.error)) || ('HTTP ' + response.status)
            );
            error.status = response.status;
            throw error;
          }

          wakeStatus('● Сервер online');
          return json || {};
        });
      })
      .catch(function (error) {
        clearTimeout(wakeTimer);
        var status = error && error.status ? error.status : 0;
        var retryable = !status || status === 408 || status === 429 || status >= 500;

        if (retryable && attempt < 2) {
          wakeStatus('● Повтор подключения…');
          return new Promise(function (resolve) {
            setTimeout(resolve, attempt === 0 ? 1200 : 2600);
          }).then(function () {
            return fetchPost(path, data, attempt + 1);
          });
        }

        wakeStatus('● Ошибка соединения');
        throw error;
      });
  }

  function rawPost(path, data, attempt) {
    if (useJsonp()) {
      return jsonpGet(apiJsonpPath(path), data || {}, attempt || 0);
    }

    return fetchPost(path, data || {}, attempt || 0);
  }

  function updateAccountButtons() {
    try {
      var connected = !!value(STORAGE.session);

      $('.view--hdrezka-account span').text(
        connected ? 'REZKA ✓' : 'ВОЙТИ'
      );

      $('.view--hdrezka-account').attr(
        'data-subtitle',
        connected
          ? ('HDRezka подключена • ' + (value(STORAGE.accountName) || value(STORAGE.host) || 'Premium'))
          : 'Подключить Premium-аккаунт HDRezka'
      );

      wakeStatus(
        connected
          ? '● Premium подключён'
          : '○ Требуется вход'
      );
    } catch (e) {}
  }

  function saveLoginResult(data, loginName) {
    if (!data || !data.session) {
      throw new Error('Сервер не вернул сессию HDRezka');
    }

    setValue(STORAGE.session, data.session);
    setValue(STORAGE.host, data.host || '');
    if (loginName) setValue(STORAGE.accountName, loginName);

    /* Пароль нужен только на момент входа. */
    setValue(STORAGE.password, '');

    updateAccountButtons();

    notice('✅ HDREZKA Premium: аккаунт подключён');

    return data.session;
  }

  function loginWithCredentials(loginName, password) {
    loginName = String(loginName || '').trim();
    password = String(password || '');

    if (!loginName || !password) {
      return Promise.reject(new Error('Введите логин и пароль HDRezka'));
    }

    notice('HDREZKA: вход + проверка Anubis…');

    return fetchPost('/api/login', {
      login: loginName,
      password: password
    }, 0).then(function (data) {
      return saveLoginResult(data, loginName);
    });
  }

  function promptPcLogin() {
    return new Promise(function (resolve, reject) {
      var savedLogin = value(STORAGE.login);

      try {
        Lampa.Input.edit({
          title: 'HDRezka • E-mail / логин',
          value: savedLogin,
          free: true,
          nosave: true,
          keyboard: 'lampa'
        }, function (loginName) {
          loginName = String(loginName || '').trim();
          if (!loginName) {
            reject(new Error('Логин не введён'));
            return;
          }

          Lampa.Input.edit({
            title: 'HDRezka • Пароль',
            value: '',
            free: true,
            nosave: true,
            keyboard: 'lampa',
            password: true
          }, function (password) {
            password = String(password || '');
            if (!password) {
              reject(new Error('Пароль не введён'));
              return;
            }

            setValue(STORAGE.login, loginName);

            loginWithCredentials(loginName, password)
              .then(resolve)
              .catch(reject);
          });
        });
      } catch (e) {
        var loginName = value(STORAGE.login).trim();
        var password = value(STORAGE.password);
        loginWithCredentials(loginName, password).then(resolve).catch(reject);
      }
    });
  }

  var pairPoll = null;

  function stopPairPoll() {
    if (pairPoll) {
      clearInterval(pairPoll);
      pairPoll = null;
    }
  }

  function startTvPairing() {
    stopPairPoll();

    return jsonpGet('/jsonp/pair/start', {}, 0).then(function (data) {
      if (!data || !data.code) throw new Error('Backend не вернул код подключения');

      var previousController = null;
      try { previousController = Lampa.Controller.enabled().name; } catch (e) {}

      var modal = $(
        '<div class="hdrezka-pair-v8">' +
          '<div class="hdrezka-pair-v8__title">Подключение HDRezka Premium</div>' +
          '<div class="hdrezka-pair-v8__hint">Открой на телефоне или ПК:</div>' +
          '<div class="hdrezka-pair-v8__url"></div>' +
          '<div class="hdrezka-pair-v8__hint">и введи код:</div>' +
          '<div class="hdrezka-pair-v8__code"></div>' +
          '<div class="hdrezka-pair-v8__state">Ожидаем вход…</div>' +
          '<div class="hdrezka-pair-v8__brand">HDREZKA Premium • by DENYS</div>' +
        '</div>'
      );

      modal.find('.hdrezka-pair-v8__url').text(data.short_url || data.connect_url);
      modal.find('.hdrezka-pair-v8__code').text(data.code);

      var cancelPair = null;

      function closePair(cancelled) {
        stopPairPoll();
        try { Lampa.Modal.close(); } catch (e) {}
        if (previousController) {
          try { Lampa.Controller.toggle(previousController); } catch (e) {}
        }
        if (cancelled && cancelPair) {
          cancelPair(new Error('Подключение отменено'));
          cancelPair = null;
        }
      }

      try {
        Lampa.Modal.open({
          title: 'HDREZKA • Подключить аккаунт',
          html: modal,
          size: 'medium',
          onBack: function () { closePair(true); }
        });
      } catch (e) {
        notice((data.short_url || data.connect_url) + ' • код ' + data.code);
      }

      return new Promise(function (resolve, reject) {
        cancelPair = reject;
        var expiresAt = Date.now() + ((data.expires_in || 600) * 1000);

        function check() {
          if (Date.now() > expiresAt) {
            stopPairPoll();
            modal.find('.hdrezka-pair-v8__state').text('Код истёк. Откройте подключение заново.');
            reject(new Error('Код подключения истёк'));
            return;
          }

          jsonpGet('/jsonp/pair/status', { code: data.code }, 0)
            .then(function (status) {
              if (status.status === 'connected' && status.session) {
                stopPairPoll();
                setValue(STORAGE.session, status.session);
                setValue(STORAGE.host, status.host || '');
                setValue(STORAGE.accountName, status.login || 'HDRezka');
                setValue(STORAGE.password, '');
                updateAccountButtons();
                modal.find('.hdrezka-pair-v8__state').text('✅ Аккаунт подключён');
                notice('✅ HDRezka Premium подключена');
                setTimeout(function () { closePair(false); }, 900);
                resolve(status.session);
              } else if (status.status === 'expired') {
                stopPairPoll();
                modal.find('.hdrezka-pair-v8__state').text('Код истёк');
                reject(new Error('Код подключения истёк'));
              } else if (status.status === 'error') {
                modal.find('.hdrezka-pair-v8__state').text(status.error || 'Ошибка входа');
              } else if (status.status === 'working') {
                modal.find('.hdrezka-pair-v8__state').text('Проверяем аккаунт и Anubis…');
              }
            })
            .catch(function (error) {
              modal.find('.hdrezka-pair-v8__state').text('Связь: ' + error.message);
            });
        }

        check();
        pairPoll = setInterval(check, 2500);
      });
    });
  }

  function login() {
    if (useJsonp()) {
      return startTvPairing();
    }

    var storedLogin = value(STORAGE.login).trim();
    var storedPassword = value(STORAGE.password);

    if (storedLogin && storedPassword) {
      return loginWithCredentials(storedLogin, storedPassword);
    }

    return promptPcLogin();
  }

  function ensureSession() {
    var session = value(STORAGE.session);
    if (session) return Promise.resolve(session);
    return login();
  }

  function api(path, data, retry) {
    retry = typeof retry === 'undefined' ? true : retry;

    return ensureSession().then(function (session) {
      data = data || {};
      data.session = session;

      return rawPost(path, data).then(function (result) {
        /* Every backend call can refresh Anubis cookies. */
        if (result && result.session) {
          setValue(STORAGE.session, result.session);
        }
        return result;
      });
    }).catch(function (error) {
      var message = String(error && error.message || '');
      var status = error && error.status ? Number(error.status) : 0;

      if (
        retry &&
        (
          status === 401 ||
          message.toLowerCase().indexOf('сесс') !== -1 ||
          message.toLowerCase().indexOf('автор') !== -1
        )
      ) {
        setValue(STORAGE.session, '');
        updateAccountButtons();
        return login().then(function () {
          return api(path, data, false);
        });
      }

      throw error;
    });
  }

  function checkAccount() {
    var session = value(STORAGE.session);
    if (!session) return Promise.reject(new Error('Аккаунт не подключён'));

    return rawPost('/api/status', { session: session }).then(function (data) {
      if (data && data.session) setValue(STORAGE.session, data.session);
      if (!data || !data.authenticated) throw new Error('Сессия HDRezka неактивна');
      setValue(STORAGE.host, data.host || value(STORAGE.host));
      updateAccountButtons();
      return data;
    });
  }

  function disconnectAccount() {
    stopPairPoll();
    setValue(STORAGE.session, '');
    setValue(STORAGE.host, '');
    setValue(STORAGE.accountName, '');
    setValue(STORAGE.password, '');
    updateAccountButtons();
    notice('HDRezka отключена');
  }

  function openAccountMenu() {
    var connected = !!value(STORAGE.session);
    var items = [];

    if (connected) {
      items.push({ title: '✅ HDRezka подключена', subtitle: value(STORAGE.accountName) || value(STORAGE.host) || 'Premium', action: 'check' });
      items.push({ title: '🔄 Переподключить аккаунт', subtitle: useJsonp() ? 'Новый код подключения' : 'Войти заново', action: 'login' });
      items.push({ title: '🚪 Выйти из HDRezka', subtitle: 'Удалить зашифрованную сессию с устройства', action: 'logout' });
    } else {
      items.push({
        title: '🔐 Войти в HDRezka',
        subtitle: useJsonp() ? 'Код на TV → вход с телефона/ПК' : 'Ввести логин и пароль',
        action: 'login'
      });
    }

    items.push({
      title: '🧪 Проверить соединение',
      subtitle: 'Backend / аккаунт / Anubis',
      action: 'check'
    });

    var enabled = null;
    try { enabled = Lampa.Controller.enabled().name; } catch (e) {}

    Lampa.Select.show({
      title: 'HDREZKA Premium • by DENYS',
      items: items,
      onSelect: function (item) {
        try { Lampa.Select.hide(); } catch (e) {}

        if (item.action === 'login') {
          setValue(STORAGE.session, '');
          login().catch(function (error) { notice('HDREZKA: ' + error.message); });
        } else if (item.action === 'logout') {
          disconnectAccount();
        } else if (item.action === 'check') {
          notice('HDREZKA: проверяем…');
          checkAccount()
            .then(function (data) {
              notice('✅ HDRezka online • ' + (data.host || 'аккаунт активен'));
            })
            .catch(function (error) {
              notice('❌ HDREZKA: ' + error.message);
            });
        }

        if (enabled && item.action !== 'login') {
          try { Lampa.Controller.toggle(enabled); } catch (e) {}
        }
      },
      onBack: function () {
        try { Lampa.Select.hide(); } catch (e) {}
        if (enabled) {
          try { Lampa.Controller.toggle(enabled); } catch (e) {}
        }
      }
    });
  }

  var playerScope = {
    active: false,
    oldTimecode: null,
    oldNext: null,
    restoreTimer: null
  };

  function beginPlayerScope() {
    if (playerScope.restoreTimer) {
      clearTimeout(playerScope.restoreTimer);
      playerScope.restoreTimer = null;
    }

    if (!playerScope.active) {
      try { playerScope.oldTimecode = Lampa.Storage.get('player_timecode', 'continue'); } catch (e) {}
      try { playerScope.oldNext = Lampa.Storage.get('playlist_next', true); } catch (e) {}
    }

    playerScope.active = true;

    try {
      Lampa.Storage.set('player_timecode', setting(STORAGE.resumeMode, 'continue'));
      Lampa.Storage.set('playlist_next', setting(STORAGE.autoNext, '1') === '1');
    } catch (e) {}
  }

  function schedulePlayerRestore() {
    if (!playerScope.active) return;
    if (playerScope.restoreTimer) clearTimeout(playerScope.restoreTimer);

    playerScope.restoreTimer = setTimeout(function () {
      try {
        if (playerScope.oldTimecode !== null) Lampa.Storage.set('player_timecode', playerScope.oldTimecode);
      } catch (e) {}
      try {
        if (playerScope.oldNext !== null) Lampa.Storage.set('playlist_next', playerScope.oldNext);
      } catch (e) {}

      playerScope.active = false;
      playerScope.oldTimecode = null;
      playerScope.oldNext = null;
      playerScope.restoreTimer = null;
    }, 1100);
  }

  function installPlayerScopeListeners() {
    if (window.hdrezka_denys_v8_player_scope) return;
    window.hdrezka_denys_v8_player_scope = true;

    try {
      if (Lampa.Player && Lampa.Player.listener) {
        Lampa.Player.listener.follow('start', function (data) {
          if (data && data.hdrezka_denys_v8) {
            beginPlayerScope();
          }
        });

        Lampa.Player.listener.follow('destroy', function () {
          schedulePlayerRestore();
        });
      }
    } catch (e) {}
  }

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
          'hdrezka_premium_connect_v8',
        type:
          'button'
      },

      field: {
        name:
          '🔐 Подключить / проверить HDRezka',

        description:
          'На TV: безопасный код + вход с телефона. На ПК: обычный вход.'
      },

      onChange:
        openAccountMenu
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.transport,
        type:
          'select',
        values: {
          'auto': 'Авто — JSONP на TV / fetch на ПК',
          'jsonp': 'Всегда JSONP',
          'fetch': 'Всегда fetch'
        },
        default:
          'auto'
      },

      field: {
        name:
          'Транспорт',

        description:
          'JSONP использует обычный <script>, поэтому Media Station X не упирается в CORS/XHR.'
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
          'continue': 'Автоматически продолжать',
          'ask': 'Спрашивать',
          'again': 'Всегда сначала'
        },
        default:
          'continue'
      },

      field: {
        name:
          'Таймкод HDREZKA',

        description:
          'Родной Lampa Timeline. Настройка действует только пока открыт HDREZKA-плеер.'
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
          '1': 'Да',
          '0': 'Нет'
        },
        default:
          '1'
      },

      field: {
        name:
          'Авто следующая серия',

        description:
          'Настоящий Lampa.Player.playlist со всеми сериями.'
      }
    });

    Lampa.SettingsApi.addParam({
      component:
        'hdrezka_premium_settings',

      param: {
        name:
          STORAGE.prefetch,
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
          'Подготавливать следующую серию',

        description:
          'Заранее получает следующий Premium-поток для быстрого NEXT.'
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
          'DENYS EDITION • ваш аккаунт HDRezka'
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
          'Резервный вход на ПК. После успешного входа пароль очищается.'
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
          'HDREZKA Premium for Lampa • by DENYS'
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
        '.hdrezka-pair-v8{' +
          'text-align:center;' +
          'padding:1em .6em;' +
        '}' +
        '.hdrezka-pair-v8__title{' +
          'font-size:1.25em;' +
          'font-weight:700;' +
          'margin-bottom:1em;' +
        '}' +
        '.hdrezka-pair-v8__hint{' +
          'opacity:.68;' +
          'margin:.55em 0;' +
        '}' +
        '.hdrezka-pair-v8__url{' +
          'font-size:1.05em;' +
          'font-weight:600;' +
          'word-break:break-all;' +
          'margin:.3em 0 1em;' +
        '}' +
        '.hdrezka-pair-v8__code{' +
          'font-size:2.65em;' +
          'font-weight:800;' +
          'letter-spacing:.17em;' +
          'margin:.15em 0 .55em;' +
        '}' +
        '.hdrezka-pair-v8__state{' +
          'margin-top:.6em;' +
        '}' +
        '.hdrezka-pair-v8__brand{' +
          'opacity:.45;' +
          'font-size:.75em;' +
          'margin-top:1.3em;' +
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
              ? '● Premium подключён'
              : '○ Требуется вход'
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
      var movie = object.movie || {};

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

    function timelineHash(episode) {
      var title =
        timelineBaseTitle();

      if (
        details &&
        details.is_series &&
        episode
      ) {
        var season =
          episode.season_id ||
          (
            currentSeason() &&
            currentSeason().id
          ) ||
          1;

        var ep =
          episode.episode_id ||
          episode.episode ||
          1;

        var separator =
          parseInt(season, 10) > 10
            ? ':'
            : '';

        return Lampa.Utils.hash(
          [
            season,
            separator,
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
          timelineHash(episode)
        );
      }
      catch (e) {
        return {
          hash:
            timelineHash(episode),

          percent:
            0,

          time:
            0,

          duration:
            0
        };
      }
    }

    function timelineRoad(view) {
      if (!view) {
        return {
          percent: 0,
          time: 0,
          duration: 0
        };
      }

      return {
        percent:
          parseFloat(
            view.percent || 0
          ) || 0,

        time:
          parseFloat(
            view.time || 0
          ) || 0,

        duration:
          parseFloat(
            view.duration || 0
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
        if (percent >= 92) {
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
            percent >= 92
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

    var streamMemory = {};

    function orderedEpisodes() {
      if (!details || !details.episodes) return [];

      return details.episodes.slice().sort(function (a, b) {
        var sa = parseInt(a.season_id, 10) || 0;
        var sb = parseInt(b.season_id, 10) || 0;
        if (sa !== sb) return sa - sb;
        return (parseInt(a.episode_id, 10) || 0) - (parseInt(b.episode_id, 10) || 0);
      });
    }

    function streamKey(episode, voice) {
      return [
        details && details.url || '',
        voice && voice.id || '',
        episode && episode.season_id || 0,
        episode && episode.episode_id || 0
      ].join('|');
    }

    function requestStream(episode, voice) {
      var key = streamKey(episode, voice);
      if (streamMemory[key]) return streamMemory[key];

      var promise = api('/api/stream', {
        url: details.url,
        translator_id: voice.id,
        season: details.is_series && episode ? episode.season_id : null,
        episode: details.is_series && episode ? episode.episode_id : null
      }).then(function (data) {
        if (!data || !data.url) throw new Error('HDREZKA не вернула видеопоток');
        return data;
      }).catch(function (error) {
        delete streamMemory[key];
        throw error;
      });

      streamMemory[key] = promise;
      return promise;
    }

    function episodePlayerTitle(episode) {
      var title = movieTitle(object.movie || {});

      if (details && details.is_series && episode) {
        title += ' / S' + episode.season_id + 'E' + episode.episode_id;
        if (episode.name) title += ' / ' + episode.name;
      }

      return title;
    }

    function makePlayerCell(episode, voice, streamData) {
      var view = wrapTimeline(
        timelineView(details.is_series ? episode : null),
        details.is_series ? episode : null
      );

      var cell = {
        title: episodePlayerTitle(episode),
        timeline: view,
        launch_player: 'lampa',
        hdrezka_denys_v8: true,
        card: object.movie,
        movie: object.movie,
        season: details.is_series && episode ? episode.season_id : null,
        episode: details.is_series && episode ? episode.episode_id : null,
        quality: {},
        subtitles: []
      };

      if (streamData) {
        cell.url = pickQuality(streamData);
        cell.quality = streamData.quality || {};
        cell.subtitles = streamData.subtitles || [];
      }

      return cell;
    }

    function prefetchNext(episode, voice) {
      if (
        setting(STORAGE.prefetch, '1') !== '1' ||
        !details ||
        !details.is_series ||
        !episode
      ) {
        return;
      }

      var list = orderedEpisodes();
      for (var i = 0; i < list.length; i++) {
        if (
          String(list[i].season_id) === String(episode.season_id) &&
          String(list[i].episode_id) === String(episode.episode_id)
        ) {
          if (list[i + 1]) {
            requestStream(list[i + 1], voice).catch(function () {});
          }
          break;
        }
      }
    }

    function buildRealPlaylist(selectedEpisode, voice, selectedData) {
      var rows = details.is_series
        ? orderedEpisodes()
        : [null];

      var playlist = [];
      var first = null;

      rows.forEach(function (episode) {
        var same = !details.is_series || (
          String(episode.season_id) === String(selectedEpisode.season_id) &&
          String(episode.episode_id) === String(selectedEpisode.episode_id)
        );

        var cell = makePlayerCell(episode, voice, same ? selectedData : null);

        if (!same && details.is_series) {
          cell.url = function (call) {
            beginPlayerScope();

            requestStream(episode, voice)
              .then(function (data) {
                cell.url = pickQuality(data);
                cell.quality = data.quality || {};
                cell.subtitles = data.subtitles || [];
                cell.timeline = wrapTimeline(timelineView(episode), episode);
                cell.launch_player = 'lampa';
                cell.hdrezka_denys_v8 = true;
                call();
                prefetchNext(episode, voice);
              })
              .catch(function (error) {
                cell.url = '';
                notice('HDREZKA: ' + error.message);
                call();
              });
          };
        }

        if (same) first = cell;
        playlist.push(cell);
      });

      if (!first) first = playlist[0];
      return { first: first, playlist: playlist };
    }

    function launchPremium(episode, voice) {
      if (!voice) {
        notice('HDREZKA: озвучка не найдена');
        return;
      }

      saveProgress(details.is_series ? episode : null);

      try {
        if (object.movie && object.movie.id && Lampa.Favorite && Lampa.Favorite.add) {
          Lampa.Favorite.add('history', object.movie, 100);
        }
      } catch (e) {}

      notice('HDREZKA: получаем Premium-поток…');

      requestStream(details.is_series ? episode : null, voice)
        .then(function (data) {
          beginPlayerScope();

          var built = buildRealPlaylist(
            details.is_series ? episode : null,
            voice,
            data
          );

          if (!built.first || !built.first.url) {
            throw new Error('HDREZKA не вернула ссылку для плеера');
          }

          built.first.playlist = built.playlist;
          built.first.launch_player = 'lampa';
          built.first.hdrezka_denys_v8 = true;

          Lampa.Player.play(built.first);
          Lampa.Player.playlist(built.playlist);

          if (built.first.subtitles && built.first.subtitles.length && Lampa.Player.subtitles) {
            try { Lampa.Player.subtitles(built.first.subtitles); } catch (e) {}
          }

          prefetchNext(details.is_series ? episode : null, voice);
        })
        .catch(function (error) {
          notice('HDREZKA: ' + error.message);
        });
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
              road.percent < 92
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
              road.percent >= 92
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

            /*
              Нативный прогресс Lampa:
              полоска, процент, таймкод и автоматическое
              сохранение/восстановление позиции.
            */
            try {
              if (
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
                road.percent >= 92
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
                launchPremium(
                  details.is_series
                    ? episode
                    : null,
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
        this.start(true);
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
    Lampa.Listener.follow(
      'full',
      function (e) {
        if (!e || e.type !== 'complite' || !e.object || !e.object.activity) return;

        var root = e.object.activity.render();

        root.find(
          '.view--hdrezka-premium, .view--hdrezka-account'
        ).remove();

        var movie = e.data && e.data.movie ? e.data.movie : null;

        var play = $(
          '<div class="full-start__button selector view--hdrezka-premium" ' +
          'data-subtitle="HDREZKA Premium • by DENYS v' + VERSION + '">' +
            '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<circle cx="64" cy="64" r="52" stroke="currentColor" stroke-width="12"/>' +
              '<path d="M88 64L51 86V42L88 64Z" fill="currentColor"/>' +
            '</svg>' +
            '<span>HDREZKA</span>' +
          '</div>'
        );

        var account = $(
          '<div class="full-start__button selector view--hdrezka-account" ' +
          'data-subtitle="Подключить Premium-аккаунт HDRezka">' +
            '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<circle cx="64" cy="43" r="21" stroke="currentColor" stroke-width="10"/>' +
              '<path d="M28 105c5-23 18-35 36-35s31 12 36 35" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>' +
            '</svg>' +
            '<span>' + (value(STORAGE.session) ? 'REZKA ✓' : 'ВОЙТИ') + '</span>' +
          '</div>'
        );

        play.on('hover:enter', function () {
          if (!value(STORAGE.session)) {
            openAccountMenu();
            return;
          }
          loadRezka(movie);
        });

        account.on('hover:enter', openAccountMenu);

        function insertAfter(target) {
          if (!target || !target.length) return false;
          target.after(play);
          play.after(account);
          updateAccountButtons();
          return true;
        }

        var torrent = root.find('.view--torrent').first();
        if (insertAfter(torrent)) return;

        var onlineMod = root.find('.view--online_mod').first();
        if (insertAfter(onlineMod)) return;

        var buttons = root.find('.full-start__buttons').first();
        if (!buttons.length) buttons = root.find('.full-start-new__buttons').first();

        if (buttons.length) {
          buttons.append(play);
          buttons.append(account);
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
          'Premium HDRezka • Anubis backend • JSONP VIDAA/MSX • native Timeline/Playlist • by DENYS',

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
    /*
      Никакого собственного таймера больше нет.
      Lampa Player Timeline обновляет time/percent/duration сам и вызывает
      handler от Lampa.Timeline.view() при выходе и каждые 2 минуты.
    */
    installPlayerScopeListeners();
  }

  function init() {
    try {
      /* Старые v1-v7 session-токены несовместимы с зашифрованной v8-сессией. */
      if (value(STORAGE.sessionVersion) !== VERSION) {
        setValue(STORAGE.session, '');
        setValue(STORAGE.host, '');
        setValue(STORAGE.sessionVersion, VERSION);
      }

      addSettings();
      installProgressSafety();
      addStyle();
      addTemplates();
      addMainButton();
      registerManifest();
      updateAccountButtons();

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
