(function () {
  'use strict';

  if (window.hdrezka_denys_v7_adapter_ready) return;
  window.hdrezka_denys_v7_adapter_ready = true;

  var VERSION = '7.0.0';
  var ONLINE_MOD_COMPONENT = 'online_mod';
  var REZKA_SOURCE = 'rezka2';
  var focusRezkaSettings = false;
  var launchInProgress = false;

  var STORAGE = {
    forceProxyTv: 'hdrezka_denys_adapter_force_proxy_tv',
    requireCookieTv: 'hdrezka_denys_adapter_require_cookie_tv',
    showAccountButton: 'hdrezka_denys_adapter_show_account',
    debug: 'hdrezka_denys_adapter_debug'
  };

  function get(name, fallback) {
    var value = Lampa.Storage.get(name, fallback);
    return typeof value === 'undefined' || value === null ? fallback : value;
  }

  function set(name, value) {
    try { Lampa.Storage.set(name, value); } catch (e) {}
  }

  function setting(name, fallback) {
    var value = get(name, fallback);
    return String(value === null || typeof value === 'undefined' ? fallback : value);
  }

  function enabled(name, fallback) {
    var value = setting(name, fallback ? 'true' : 'false');
    return value === 'true' || value === '1';
  }

  function log() {
    if (!enabled(STORAGE.debug, false)) return;
    try {
      console.log.apply(console, ['[HDREZKA DENYS ADAPTER]'].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  function notice(text) {
    try { Lampa.Noty.show(String(text || '')); } catch (e) {}
  }

  function isMSX() {
    return !!(window.TVXHost || window.TVXManager);
  }

  function isPlatform(name) {
    try {
      return !!(Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is(name));
    } catch (e) {
      return false;
    }
  }

  function isTV() {
    return isMSX() || isPlatform('webos') || isPlatform('tizen') || isPlatform('orsay');
  }

  function rezkaCookie() {
    return String(get('online_mod_rezka2_cookie', '') || '');
  }

  function rezkaStatus() {
    return String(get('online_mod_rezka2_status', 'false') || 'false');
  }

  function isRezkaConnected() {
    /*
      На TV Online Mod при proxy-режиме передаёт cookie вручную.
      Поэтому наличие сохранённой cookie — наиболее честный признак.
      На ПК допускаем и браузерную session status.
    */
    if (isTV()) return !!rezkaCookie();
    return !!rezkaCookie() || rezkaStatus() === 'true';
  }

  function onlineModButton(root) {
    root = root || (Lampa.Activity.active() && Lampa.Activity.active().activity
      ? Lampa.Activity.active().activity.render()
      : $('body'));

    return root.find('.view--online_mod').first();
  }

  function onlineModAvailable(root) {
    return !!onlineModButton(root).length;
  }

  function showMissingEngine() {
    var message =
      'Нужен установленный Online Mod. Этот DENYS-плагин больше не копирует его сеть/парсер, а запускает его рабочий HDRezka-движок напрямую.';

    try {
      var enabledController = Lampa.Controller.enabled().name;
      var html = $(
        '<div style="padding:.4em 0;line-height:1.5">' +
          '<div style="font-size:1.15em;font-weight:700;margin-bottom:.8em">Online Mod не найден</div>' +
          '<div>' + message + '</div>' +
          '<div style="opacity:.7;margin-top:1em">Официальный URL:</div>' +
          '<div style="word-break:break-all;margin-top:.35em">https://nb557.github.io/plugins/online_mod.js</div>' +
        '</div>'
      );

      Lampa.Modal.open({
        title: 'HDREZKA Premium • by DENYS',
        html: html,
        size: 'medium',
        onBack: function () {
          Lampa.Modal.close();
          try { Lampa.Controller.toggle(enabledController); } catch (e) {}
        }
      });
    } catch (e) {
      notice(message);
    }
  }

  function recommendedTvAuthSetup() {
    if (!isTV()) return;

    /*
      Ключевой момент: это ровно storage Online Mod.
      Никакого нашего proxy-кода здесь нет.
    */
    set('online_mod_proxy_rezka2', 'true');
    set('online_mod_proxy_rezka2_mirror', 'false');
  }

  function focusRezkaBlock(e) {
    if (!focusRezkaSettings || !e || e.name !== 'online_mod') return;
    focusRezkaSettings = false;

    setTimeout(function () {
      try {
        var body = e.body;
        var target = body.find('[data-name="online_mod_rezka2_name"]').first();

        if (rezkaCookie()) {
          var fill = body.find('[data-name="online_mod_rezka2_fill_cookie"]').first();
          if (fill.length) target = fill;
        }

        if (target.length) {
          try { target[0].scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (err) {}
          try { target.trigger('hover:focus'); } catch (err) {}
        }
      } catch (err) {}
    }, 120);
  }

  function onlineModSettingsAvailable() {
    try {
      if (
        Lampa.Settings &&
        Lampa.Settings.main &&
        Lampa.Settings.main() &&
        Lampa.Settings.main().render().find('[data-component="online_mod"]').length
      ) {
        return true;
      }
    } catch (e) {}

    return false;
  }

  function openOnlineModRezkaSettings(root) {
    /*
      Настройки Online Mod можно открыть и не из карточки фильма,
      поэтому не привязываемся только к наличию .view--online_mod.
    */
    if (!onlineModAvailable(root) && !onlineModSettingsAvailable()) {
      showMissingEngine();
      return;
    }

    recommendedTvAuthSetup();
    focusRezkaSettings = true;

    notice(
      isTV()
        ? 'HDREZKA: логин → пароль → «Заполнить куки для HDrezka»'
        : 'HDREZKA: открываем штатный вход Online Mod'
    );

    try {
      Lampa.Settings.create('online_mod');
    } catch (e) {
      showMissingEngine();
    }
  }

  function updateAccountButtons(root) {
    try {
      var connected = isRezkaConnected();
      var scope = root || $('body');

      scope.find('.view--hdrezka-denys-account span').text(
        connected ? 'REZKA ✓' : 'ВОЙТИ'
      );

      scope.find('.view--hdrezka-denys-account').attr(
        'data-subtitle',
        connected
          ? 'HDRezka подключена через Online Mod'
          : 'Войти в HDRezka через рабочую авторизацию Online Mod'
      );
    } catch (e) {}
  }

  function restoreStorage(backup) {
    if (!backup) return;

    set('online_mod_balanser', backup.balanser);
    set('online_mod_save_last_balanser', backup.saveLast);
    set('online_mod_proxy_rezka2', backup.proxyRezka);
    set('online_mod_proxy_rezka2_mirror', backup.proxyMirror);
  }

  function waitOnlineModStarted(backup) {
    var startedAt = Date.now();
    var timer = setInterval(function () {
      var active = null;

      try { active = Lampa.Activity.active(); } catch (e) {}

      if (active && active.component === ONLINE_MOD_COMPONENT) {
        clearInterval(timer);

        /*
          component(object) уже создан и прочитал balanser/proxy в локальные
          переменные. Возвращаем пользователю его обычные Online Mod настройки.
        */
        setTimeout(function () {
          restoreStorage(backup);
          launchInProgress = false;
          log('Online Mod Rezka2 started; user settings restored');
        }, 350);

        return;
      }

      if (Date.now() - startedAt > 30000) {
        clearInterval(timer);
        restoreStorage(backup);
        launchInProgress = false;
        notice('HDREZKA: Online Mod не запустился за 30 секунд');
      }
    }, 120);
  }

  function launchThroughOnlineMod(root, movie) {
    if (launchInProgress) return;

    var onlineButton = onlineModButton(root);

    if (!onlineButton.length) {
      showMissingEngine();
      return;
    }

    if (
      isTV() &&
      enabled(STORAGE.requireCookieTv, true) &&
      !rezkaCookie()
    ) {
      notice('HDREZKA: сначала подключите аккаунт');
      openOnlineModRezkaSettings(root);
      return;
    }

    launchInProgress = true;

    var backup = {
      balanser: get('online_mod_balanser', ''),
      saveLast: get('online_mod_save_last_balanser', 'false'),
      proxyRezka: get('online_mod_proxy_rezka2', 'false'),
      proxyMirror: get('online_mod_proxy_rezka2_mirror', 'false')
    };

    /*
      Это вся "магия" адаптера.
      Никаких наших запросов к HDRezka:
      мы лишь говорим существующему Online Mod запустить rezka2.
    */
    set('online_mod_balanser', REZKA_SOURCE);
    set('online_mod_save_last_balanser', 'false');

    if (isTV() && enabled(STORAGE.forceProxyTv, true)) {
      set('online_mod_proxy_rezka2', 'true');
      set('online_mod_proxy_rezka2_mirror', 'false');
    }

    notice('HDREZKA Premium • DENYS → Online Mod / HDrezka');
    log('launch', movie && (movie.title || movie.name), backup);

    waitOnlineModStarted(backup);

    /*
      ВАЖНО: вызываем ИМЕННО родную кнопку Online Mod.
      Поэтому отрабатывает его собственный loadOnline(): checkMyIp,
      current host, proxy, component init, Timeline, playlist и player.
    */
    try {
      onlineButton.trigger('hover:enter');
    } catch (error) {
      restoreStorage(backup);
      launchInProgress = false;
      notice('HDREZKA: не удалось запустить Online Mod');
    }
  }

  function showAccountMenu(root) {
    var connected = isRezkaConnected();
    var items = [];

    items.push({
      title: connected ? '✅ HDRezka подключена' : '🔐 Войти в HDRezka',
      subtitle: connected
        ? 'Используется сессия Online Mod'
        : 'Открыть штатную авторизацию HDRezka из Online Mod',
      action: 'settings'
    });

    if (isTV()) {
      items.push({
        title: '📺 Подготовить VIDAA / MSX',
        subtitle: 'Включить proxy Rezka2 и правильный режим зеркала Online Mod',
        action: 'tv'
      });
    }

    items.push({
      title: '🧪 Статус',
      subtitle:
        'cookie=' + (rezkaCookie() ? 'есть' : 'нет') +
        ' • status=' + rezkaStatus() +
        ' • proxy=' + String(get('online_mod_proxy_rezka2', 'false')),
      action: 'status'
    });

    var enabledController = null;
    try { enabledController = Lampa.Controller.enabled().name; } catch (e) {}

    Lampa.Select.show({
      title: 'HDREZKA Premium • by DENYS',
      items: items,
      onSelect: function (item) {
        try { Lampa.Select.hide(); } catch (e) {}

        if (item.action === 'settings') {
          openOnlineModRezkaSettings(root);
        } else if (item.action === 'tv') {
          recommendedTvAuthSetup();
          notice('✅ VIDAA/MSX: HDRezka proxy Online Mod включён');
        } else if (item.action === 'status') {
          notice(
            (isRezkaConnected() ? '✅ ' : '⚠ ') +
            'HDRezka / Online Mod • cookie ' +
            (rezkaCookie() ? 'есть' : 'нет')
          );
        }

        if (enabledController && item.action !== 'settings') {
          try { Lampa.Controller.toggle(enabledController); } catch (e) {}
        }
      },
      onBack: function () {
        try { Lampa.Select.hide(); } catch (e) {}
        if (enabledController) {
          try { Lampa.Controller.toggle(enabledController); } catch (e) {}
        }
      }
    });
  }

  function addButtonsToFull(e) {
    if (!e || e.type !== 'complite' || !e.object || !e.object.activity) return;

    var root = e.object.activity.render();
    var movie = e.data && e.data.movie ? e.data.movie : null;

    /* Удаляем любые наши старые версии, но не трогаем Online Mod. */
    root.find(
      '.view--hdrezka-premium,' +
      '.view--hdrezka-account,' +
      '.view--hdrezka-denys-adapter,' +
      '.view--hdrezka-denys-account'
    ).remove();

    var play = $(
      '<div class="full-start__button selector view--hdrezka-denys-adapter" ' +
      'data-subtitle="HDREZKA Premium • Online Mod engine • by DENYS v' + VERSION + '">' +
        '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="64" cy="64" r="52" stroke="currentColor" stroke-width="12"/>' +
          '<path d="M88 64L51 86V42L88 64Z" fill="currentColor"/>' +
        '</svg>' +
        '<span>HDREZKA</span>' +
      '</div>'
    );

    var account = $(
      '<div class="full-start__button selector view--hdrezka-denys-account" ' +
      'data-subtitle="HDRezka аккаунт через Online Mod">' +
        '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="64" cy="43" r="21" stroke="currentColor" stroke-width="10"/>' +
          '<path d="M28 105c5-23 18-35 36-35s31 12 36 35" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>' +
        '</svg>' +
        '<span>' + (isRezkaConnected() ? 'REZKA ✓' : 'ВОЙТИ') + '</span>' +
      '</div>'
    );

    play.on('hover:enter', function () {
      launchThroughOnlineMod(root, movie);
    });

    account.on('hover:enter', function () {
      showAccountMenu(root);
    });

    function insert() {
      var online = root.find('.view--online_mod').first();

      if (online.length) {
        online.after(play);
        if (enabled(STORAGE.showAccountButton, true)) play.after(account);
        updateAccountButtons(root);
        return true;
      }

      return false;
    }

    if (insert()) return;

    /*
      Listener order у плагинов не гарантирован. Даём Online Mod до 2 сек,
      чтобы добавить свою кнопку, после чего ставим нашу рядом с torrent.
    */
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;

      if (insert()) {
        clearInterval(timer);
        return;
      }

      if (attempts >= 20) {
        clearInterval(timer);

        var torrent = root.find('.view--torrent').first();
        if (torrent.length) {
          torrent.after(play);
          if (enabled(STORAGE.showAccountButton, true)) play.after(account);
          updateAccountButtons(root);
        } else {
          var buttons = root.find('.full-start__buttons,.full-start-new__buttons').first();
          if (buttons.length) {
            buttons.append(play);
            if (enabled(STORAGE.showAccountButton, true)) buttons.append(account);
            updateAccountButtons(root);
          }
        }
      }
    }, 100);
  }

  function addStyle() {
    if ($('#hdrezka-denys-adapter-style').length) return;

    $('head').append(
      '<style id="hdrezka-denys-adapter-style">' +
        '.view--hdrezka-denys-adapter span:after{' +
          'content:" • DENYS";opacity:.58;font-size:.72em;' +
        '}' +
        '.view--hdrezka-denys-account span{' +
          'font-size:.82em;font-weight:700;' +
        '}' +
      '</style>'
    );
  }

  function addSettings() {
    if (!Lampa.SettingsApi) return;

    try {
      Lampa.SettingsApi.addComponent({
        component: 'hdrezka_denys_adapter_settings',
        name: 'HDREZKA • DENYS',
        icon:
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/>' +
          '</svg>'
      });
    } catch (e) {}

    function param(name, type, values, def, title, description, onChange) {
      var data = {
        component: 'hdrezka_denys_adapter_settings',
        param: { name: name, type: type, default: def },
        field: { name: title, description: description || '' }
      };

      if (typeof values !== 'undefined') data.param.values = values;
      if (onChange) data.onChange = onChange;

      try { Lampa.SettingsApi.addParam(data); } catch (e) {}
    }

    param(
      'hdrezka_denys_open_online_settings',
      'button',
      undefined,
      '',
      '🔐 Вход HDRezka',
      'Открыть штатную HDRezka-авторизацию Online Mod.',
      function () { openOnlineModRezkaSettings(); }
    );

    param(
      STORAGE.forceProxyTv,
      'select',
      { 'true': 'Да', 'false': 'Нет' },
      'true',
      'VIDAA/MSX: принудительно Rezka proxy',
      'При запуске DENYS временно включает online_mod_proxy_rezka2 и после старта возвращает ваши настройки.'
    );

    param(
      STORAGE.requireCookieTv,
      'select',
      { 'true': 'Да', 'false': 'Нет' },
      'true',
      'Не запускать на TV без cookie',
      'Вместо бессмысленной ошибки сразу открывает вход HDRezka.'
    );

    param(
      STORAGE.showAccountButton,
      'select',
      { 'true': 'Да', 'false': 'Нет' },
      'true',
      'Показывать кнопку REZKA ✓ / ВОЙТИ',
      'Отдельная кнопка аккаунта рядом с HDREZKA.'
    );

    param(
      'hdrezka_denys_tv_prepare',
      'button',
      undefined,
      '',
      '📺 Подготовить VIDAA/MSX',
      'Постоянно включить Rezka2 proxy в Online Mod для авторизации.',
      recommendedTvAuthSetup
    );

    param(
      STORAGE.debug,
      'select',
      { 'false': 'Нет', 'true': 'Да' },
      'false',
      'Debug',
      'Логи только адаптера в консоль.'
    );

    param(
      'hdrezka_denys_adapter_about',
      'select',
      { 'v7': 'DENYS ADAPTER v' + VERSION },
      'v7',
      'Движок',
      'Сеть, поиск, авторизация, Timeline и Player полностью выполняет установленный Online Mod.'
    );
  }

  function init() {
    addStyle();
    addSettings();

    if (Lampa.Settings && Lampa.Settings.listener) {
      Lampa.Settings.listener.follow('open', focusRezkaBlock);
    }

    Lampa.Listener.follow('full', addButtonsToFull);

    /* Обновляем надпись после возврата из настроек. */
    try {
      Lampa.Storage.listener.follow('change', function (e) {
        if (
          e &&
          (
            e.name === 'online_mod_rezka2_cookie' ||
            e.name === 'online_mod_rezka2_status'
          )
        ) {
          updateAccountButtons();
        }
      });
    } catch (e) {}

    console.log(
      'HDREZKA Premium • by DENYS v' + VERSION +
      ' loaded as Online Mod / rezka2 adapter'
    );
  }

  if (window.Lampa) {
    init();
  } else {
    var wait = setInterval(function () {
      if (window.Lampa) {
        clearInterval(wait);
        init();
      }
    }, 250);
  }
})();
