(function () {
  'use strict';

  if (window.hdrezka_premium_lampa_ready) return;
  window.hdrezka_premium_lampa_ready = true;

  var API = '__API_BASE__';
  var VERSION = '2.1.0';
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
    progress: 'hdrezka_premium_progress'
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

  function rawPost(path, data, attempt) {
    attempt = attempt || 0;

    var wakeTimer = setTimeout(
      function () {
        wakeStatus(
          '● Сервер просыпается…'
        );

        if (attempt === 0) {
          notice(
            'HDREZKA: сервер просыпается, подождите…'
          );
        }
      },
      2500
    );

    return fetch(
      API + path,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify(
          data || {}
        )
      }
    )
      .then(function (response) {
        clearTimeout(wakeTimer);

        return response
          .text()
          .then(function (text) {
            var json = null;

            try {
              json = JSON.parse(text);
            } catch (e) {}

            if (!response.ok) {
              var error = new Error(
                (
                  json &&
                  json.detail
                ) ||
                (
                  json &&
                  json.error
                ) ||
                (
                  'HTTP ' +
                  response.status
                )
              );

              error.status =
                response.status;

              throw error;
            }

            wakeStatus(
              '● Сервер online'
            );

            return json;
          });
      })
      .catch(function (error) {
        clearTimeout(wakeTimer);

        var status =
          error &&
          error.status
            ? error.status
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
          wakeStatus(
            '● Повтор подключения…'
          );

          return new Promise(
            function (resolve) {
              setTimeout(
                resolve,
                attempt === 0
                  ? 1500
                  : 3000
              );
            }
          ).then(
            function () {
              return rawPost(
                path,
                data,
                attempt + 1
              );
            }
          );
        }

        wakeStatus(
          '● Ошибка соединения'
        );

        throw error;
      });
  }

  function login() {
    var login =
      value(STORAGE.login).trim();

    var password =
      value(STORAGE.password);

    if (!login || !password) {
      return Promise.reject(
        new Error(
          'Введите логин и пароль в Настройки → HDREZKA Premium'
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
          'Авторизация произойдёт автоматически при открытии фильма'
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
                if (!voice) {
                  notice(
                    'HDREZKA: озвучка не найдена'
                  );
                  return;
                }

                saveProgress(
                  details.is_series
                    ? episode
                    : null
                );

                notice(
                  'HDREZKA: получаем Premium-поток...'
                );

                api(
                  '/api/stream',
                  {
                    url:
                      details.url,

                    translator_id:
                      voice.id,

                    season:
                      details.is_series
                        ? season.id
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

                    var title =
                      movieTitle(
                        object.movie || {}
                      );

                    if (
                      details.is_series
                    ) {
                      title +=
                        ' / ' +
                        (
                          episode.name ||
                          (
                            'Серия ' +
                            episode.episode_id
                          )
                        );
                    }

                    /*
                      Добавляем фильм в нативную историю Lampa.
                    */
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

                    var resumePosition =
                      (
                        timeline &&
                        timeline.time &&
                        timeline.percent < 92
                      )
                        ? timeline.time
                        : -1;

                    var first = {
                      url:
                        pickQuality(
                          data
                        ),

                      title:
                        title,

                      quality:
                        data.quality || {},

                      subtitles:
                        data.subtitles || [],

                      /*
                        Именно эти поля дают стандартному
                        плееру Lampa настоящий resume:
                        пауза -> выход -> открыть снова ->
                        продолжить с того же таймкода.
                      */
                      timeline:
                        timeline,

                      position:
                        resumePosition,

                      card:
                        object.movie,

                      movie:
                        object.movie,

                      season:
                        details.is_series &&
                        season
                          ? season.id
                          : null,

                      episode:
                        details.is_series
                          ? episode.episode_id
                          : null
                    };

                    /*
                      Для одного видео тоже передаём playlist —
                      так Lampa одинаково ведёт timeline
                      на разных платформах/сборках.
                    */
                    first.playlist = [
                      first
                    ];

                    Lampa.Player.play(
                      first
                    );

                    Lampa.Player.playlist(
                      [first]
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
    var button =
      '<div class="full-start__button selector view--hdrezka-premium" ' +
      'data-subtitle="HDREZKA Premium • by DENYS ' +
      VERSION +
      '">' +
        '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="64" cy="64" r="52" stroke="currentColor" stroke-width="12"/>' +
          '<path d="M88 64L51 86V42L88 64Z" fill="currentColor"/>' +
        '</svg>' +
        '<span>HDREZKA</span>' +
      '</div>';

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

        if (
          root.find(
            '.view--hdrezka-premium'
          ).length
        ) {
          return;
        }

        var movie =
          e.data &&
          e.data.movie
            ? e.data.movie
            : null;

        var btn =
          $(button);

        btn.on(
          'hover:enter',
          function () {
            loadRezka(
              movie
            );
          }
        );

        var torrent =
          root.find(
            '.view--torrent'
          );

        if (torrent.length) {
          torrent.after(btn);
          return;
        }

        var onlineMod =
          root.find(
            '.view--online_mod'
          );

        if (onlineMod.length) {
          onlineMod.after(btn);
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
            btn
          );
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
          'Premium HDRezka с вашим аккаунтом • DENYS EDITION',

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
      window.hdrezka_denys_progress_safety
    ) {
      return;
    }

    window.hdrezka_denys_progress_safety =
      true;

    /*
      Lampa сама обновляет timeline во время просмотра.
      Этот listener нужен как дополнительная страховка:
      при внешнем/особом плеере данные всё равно остаются
      в стандартном Timeline-хранилище Lampa.
    */
    try {
      if (
        Lampa.Timeline &&
        Lampa.Timeline.listener
      ) {
        Lampa.Timeline.listener.follow(
          'update',
          function (e) {
            try {
              if (
                !e ||
                !e.data ||
                !e.data.hash
              ) {
                return;
              }

              /*
                Ничего не перезаписываем вручную —
                сам факт listener здесь важен только
                для совместимости и будущей синхронизации.
              */
            }
            catch (err) {}
          }
        );
      }
    }
    catch (e) {}
  }

  function init() {
    try {
      addSettings();
      installProgressSafety();
      addStyle();
      addTemplates();
      addMainButton();
      registerManifest();

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
