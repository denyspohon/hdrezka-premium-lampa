(function () {
  'use strict';

  if (window.hdrezka_premium_lampa_ready) return;
  window.hdrezka_premium_lampa_ready = true;

  var API = '__API_BASE__';
  var VERSION = '1.0.0';
  var COMPONENT = 'hdrezka_premium';

  var STORAGE = {
    login: 'hdrezka_premium_login',
    password: 'hdrezka_premium_password',
    session: 'hdrezka_premium_session',
    host: 'hdrezka_premium_host'
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

  function rawPost(path, data) {
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
    ).then(function (response) {
      return response
        .text()
        .then(function (text) {
          var json = null;

          try {
            json = JSON.parse(text);
          } catch (e) {}

          if (!response.ok) {
            throw new Error(
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
          }

          return json;
        });
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
      'HDREZKA: вход в аккаунт...'
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

      notice(
        '✅ HDREZKA: аккаунт авторизован'
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
          'HDREZKA Premium',

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
          'Ваш аккаунт HDRezka'
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
          'Только для проверки. Менять не нужно.'
      }
    });
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

        self.renderFilter();
        self.renderItems();
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

        self.renderFilter();
        self.renderItems();
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
      function (voice) {
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
            var element = {
              title:
                episode.name ||
                (
                  details.is_series
                    ? (
                        'Серия ' +
                        episode.episode_id
                      )
                    : 'Смотреть фильм'
                ),

              quality:
                'HDREZKA',

              info:
                voice &&
                voice.name
                  ? (
                      ' / ' +
                      voice.name
                    )
                  : ''
            };

            var item =
              Lampa.Template.get(
                'hdrezka_premium_item',
                element
              );

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

                    var first = {
                      url:
                        data.url,

                      title:
                        title,

                      quality:
                        data.quality || {},

                      subtitles:
                        data.subtitles || []
                    };

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
      title: 'HDREZKA Premium',
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
      'data-subtitle="HDREZKA Premium ' +
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
          'HDREZKA Premium',

        description:
          'HDRezka с вашим аккаунтом',

        component:
          COMPONENT,

        onContextMenu:
          function () {
            return {
              name:
                'HDREZKA Premium',

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

  function init() {
    try {
      addSettings();
      addTemplates();
      addMainButton();
      registerManifest();

      console.log(
        'HDREZKA Premium ' +
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
