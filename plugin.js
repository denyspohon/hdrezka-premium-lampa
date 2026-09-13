(function () {
  'use strict';

  if (window.hdrezka_denys_v6_ready) return;
  window.hdrezka_denys_v6_ready = true;

  var VERSION = '6.0.0';
  var AUTHOR = 'DENYS';
  var COMPONENT = 'hdrezka_denys';
  var SETTINGS = 'hdrezka_denys_settings';

  var STORAGE = {
    login: 'hdrezka_denys_login',
    password: 'hdrezka_denys_password',
    cookie: 'hdrezka_denys_cookie',
    sid: 'hdrezka_denys_sid',
    status: 'hdrezka_denys_status',
    authMode: 'hdrezka_denys_auth_mode',
    activeHost: 'hdrezka_denys_active_host',
    mirror: 'hdrezka_denys_mirror',
    proxyMode: 'hdrezka_denys_proxy_mode',
    customProxy: 'hdrezka_denys_custom_proxy',
    syncOnlineMod: 'hdrezka_denys_sync_online_mod',
    proxyAck: 'hdrezka_denys_proxy_ack',
    quality: 'hdrezka_denys_quality',
    format: 'hdrezka_denys_format',
    streamMode: 'hdrezka_denys_stream_mode',
    streamProxy: 'hdrezka_denys_stream_proxy',
    playerMode: 'hdrezka_denys_player_mode',
    resumeMode: 'hdrezka_denys_resume_mode',
    autoNext: 'hdrezka_denys_auto_next',
    rememberVoice: 'hdrezka_denys_remember_voice',
    rememberSeason: 'hdrezka_denys_remember_season',
    focusContinue: 'hdrezka_denys_focus_continue',
    watchedAt: 'hdrezka_denys_watched_at',
    choices: 'hdrezka_denys_choices',
    lastRoute: 'hdrezka_denys_last_route',
    debug: 'hdrezka_denys_debug'
  };

  var currentNetwork = null;
  var currentActivity = null;
  var routeDebug = '';
  var playerRestoreTimer = null;
  var playerScopeActive = false;
  var oldTimecode = null;
  var oldPlaylistNext = null;

  function log() {
    try {
      if (setting(STORAGE.debug, '0') === '1' && window.console && console.log) {
        console.log.apply(console, ['[HDREZKA DENYS]'].concat([].slice.call(arguments)));
      }
    } catch (e) {}
  }

  function notice(text) {
    try {
      Lampa.Noty.show(String(text || ''));
    } catch (e) {}
  }

  function get(key, fallback) {
    var value = Lampa.Storage.get(key, fallback);
    return typeof value === 'undefined' || value === null ? fallback : value;
  }

  function set(key, value) {
    try {
      Lampa.Storage.set(key, value);
    } catch (e) {}
  }

  function setting(key, fallback) {
    var value = get(key, '');
    return value === '' || typeof value === 'undefined' ? fallback : String(value);
  }

  function readJson(key) {
    var raw = get(key, '');
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeJson(key, value) {
    try {
      set(key, JSON.stringify(value || {}));
    } catch (e) {}
  }

  function boolValue(key, fallback) {
    var raw = setting(key, fallback ? '1' : '0');
    return raw === '1' || raw === 'true';
  }

  function trimSlash(url) {
    url = String(url || '').trim();
    while (url.length > 0 && url.charAt(url.length - 1) === '/') {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  function startsWith(str, search) {
    str = String(str || '');
    search = String(search || '');
    return str.lastIndexOf(search, 0) === 0;
  }

  function endsWith(str, search) {
    str = String(str || '');
    search = String(search || '');
    var start = str.length - search.length;
    if (start < 0) return false;
    return str.indexOf(search, start) === start;
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

  function isAndroid() {
    return isPlatform('android');
  }

  function baseUserAgent() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
  }

  function randomId(len) {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    for (var i = 0; i < len; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function parseURL(link) {
    var a = document.createElement('a');
    a.href = link;
    return {
      protocol: a.protocol,
      host: a.host,
      origin: a.protocol + '//' + a.host,
      pathname: a.pathname || '/',
      search: a.search || '',
      hash: a.hash || ''
    };
  }

  function fixLink(link, referrer) {
    if (!link) return link;
    link = String(link);
    if (!referrer || link.indexOf('://') !== -1) return link;
    var url = parseURL(referrer);
    if (startsWith(link, '//')) return url.protocol + link;
    if (startsWith(link, '/')) return url.origin + link;
    if (startsWith(link, '?')) return url.origin + url.pathname + link;
    if (startsWith(link, '#')) return url.origin + url.pathname + url.search + link;
    var base = url.origin + url.pathname;
    base = base.substring(0, base.lastIndexOf('/') + 1);
    return base + link;
  }

  function forceHost(link, host) {
    if (!link) return host + '/';
    link = fixLink(link, host + '/');
    try {
      var p = parseURL(link);
      return trimSlash(host) + (p.pathname || '/') + (p.search || '') + (p.hash || '');
    } catch (e) {
      return link;
    }
  }

  function proxyLink(link, proxy, proxyEnc, enc) {
    if (!link || !proxy) return link;
    if (proxyEnc == null) proxyEnc = '';
    if (enc == null) enc = 'enc';

    if (enc === 'enc') {
      var pos = link.indexOf('/');
      if (pos !== -1 && link.charAt(pos + 1) === '/') pos++;
      var part1 = pos !== -1 ? link.substring(0, pos + 1) : '';
      var part2 = pos !== -1 ? link.substring(pos + 1) : link;
      return proxy + 'enc/' + encodeURIComponent(btoa(proxyEnc + part1)) + '/' + part2;
    }

    if (enc === 'enc1') {
      var p = link.lastIndexOf('/');
      var part = p !== -1 ? link.substring(0, p + 1) : '';
      var partB = p !== -1 ? link.substring(p + 1) : link;
      return proxy + 'enc1/' + encodeURIComponent(btoa(proxyEnc + part)) + '/' + partB;
    }

    if (enc === 'enc2' || enc === 'enc2t') {
      var posEnd = link.lastIndexOf('?');
      var posStart = link.lastIndexOf('://');
      if (posEnd === -1 || posEnd <= posStart) posEnd = link.length;
      if (posStart === -1) posStart = -3;
      var name = link.substring(posStart + 3, posEnd);
      posStart = name.lastIndexOf('/');
      name = posStart !== -1 ? name.substring(posStart + 1) : '';
      name = name.replace(/\.(php|asp|aspx|jsp|jspx|cgi|pl|py|rb|env|ini|conf|config|htaccess|htpasswd|git|yml|yaml|sql)$/, '.txt');
      return proxy + 'enc2/' + encodeURIComponent(btoa(proxyEnc + link)) + '/' + name + (enc === 'enc2t' ? '?jacred.test' : '');
    }

    return proxy + proxyEnc + link;
  }

  function primaryProxy() {
    var custom = trimSlash(setting(STORAGE.customProxy, ''));
    if (custom) return custom + '/';
    return new Date().getHours() % 2
      ? 'https://cors.nb557.workers.dev/'
      : 'https://cors.fx666.workers.dev/';
  }

  function proxyList() {
    var list = [
      primaryProxy(),
      'https://cors.nb557.workers.dev/',
      'https://cors.fx666.workers.dev/',
      'https://cors.nb557.deno.net/'
    ];
    var unique = [];
    list.forEach(function (item) {
      item = String(item || '');
      if (item && unique.indexOf(item) === -1) unique.push(item);
    });
    return unique;
  }

  function onlineModMirror() {
    var mirror = String(get('online_mod_rezka2_mirror', '') || '');
    return trimSlash(mirror);
  }

  function directMirror() {
    var own = trimSlash(setting(STORAGE.mirror, ''));
    if (own) return own;
    var online = onlineModMirror();
    if (online) {
      if (online.indexOf('://') === -1) online = 'https://' + online;
      return trimSlash(online);
    }
    return 'https://kvk.zone';
  }

  function proxyHost() {
    var active = trimSlash(setting(STORAGE.activeHost, ''));
    var authMode = setting(STORAGE.authMode, '');
    if (active && authMode === 'proxy') return active;

    var own = trimSlash(setting(STORAGE.mirror, ''));
    if (own && boolValue('hdrezka_denys_proxy_mirror', false)) {
      if (own.indexOf('://') === -1) own = 'https://' + own;
      return own;
    }

    return 'https://rezka.ag';
  }

  function routeMode() {
    return setting(STORAGE.proxyMode, 'auto');
  }

  function shouldProxy() {
    var mode = routeMode();
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return isTV() || isMSX();
  }

  function activeCookie() {
    var cookie = String(get(STORAGE.cookie, '') || '');
    if (!cookie) return '';

    var sid = String(get(STORAGE.sid, '') || '');
    if (!sid) {
      sid = randomId(26);
      set(STORAGE.sid, sid);
    }

    if (cookie.indexOf('PHPSESSID=') === -1) {
      cookie = 'PHPSESSID=' + sid + (cookie ? '; ' + cookie : '');
    }

    return cookie;
  }

  function syncToOnlineMod(cookie) {
    if (!boolValue(STORAGE.syncOnlineMod, true)) return;
    try {
      if (cookie) {
        set('online_mod_rezka2_cookie', cookie.replace(/(^|;\s*)PHPSESSID=[^;]*/g, '').replace(/^;\s*|\s*;$/g, ''));
        set('online_mod_rezka2_status', 'true');
      }
      var login = String(get(STORAGE.login, '') || '');
      if (login) set('online_mod_rezka2_name', login);
    } catch (e) {}
  }

  function importOnlineModSession(silent) {
    var cookie = String(get('online_mod_rezka2_cookie', '') || '');
    if (!cookie) {
      if (!silent) notice('Online Mod: сохранённая HDRezka-сессия не найдена');
      return false;
    }

    set(STORAGE.cookie, cookie);
    set(STORAGE.status, 'true');
    set(STORAGE.authMode, 'proxy');
    set(STORAGE.activeHost, 'https://rezka.ag');

    var login = String(get('online_mod_rezka2_name', '') || '');
    if (login && !get(STORAGE.login, '')) set(STORAGE.login, login);

    if (!silent) notice('✅ HDRezka-сессия импортирована из Online Mod');
    updateAccountButtons();
    return true;
  }

  function normalizeSetCookie(headers) {
    if (!headers) return [];
    var value = headers['set-cookie'] || headers['Set-Cookie'] || null;
    if (!value) return [];
    if (typeof value === 'string') return [value];
    return value && value.forEach ? value : [];
  }

  function cookieObject(cookie) {
    var out = {};
    String(cookie || '').split(';').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var eq = part.indexOf('=');
      if (eq === -1) return;
      var name = part.substring(0, eq).trim();
      var value = part.substring(eq + 1).trim();
      if (name) out[name] = value;
    });
    return out;
  }

  function cookieString(values) {
    var out = [];
    for (var name in values) {
      if (values.hasOwnProperty(name) && values[name] !== null && typeof values[name] !== 'undefined') {
        out.push(name + '=' + values[name]);
      }
    }
    return out.join('; ');
  }

  function mergeSetCookie(baseCookie, headers) {
    var values = cookieObject(baseCookie);
    normalizeSetCookie(headers).forEach(function (line) {
      var first = String(line || '').split(';')[0];
      var eq = first.indexOf('=');
      if (eq === -1) return;
      var name = first.substring(0, eq).trim();
      var value = first.substring(eq + 1).trim();
      if (!name) return;
      if (value === 'deleted' || value === '') {
        delete values[name];
      } else {
        values[name] = value;
      }
    });
    return cookieString(values);
  }

  function buildProxyEnc(host, cookie, captureHeaders) {
    var enc = '';
    enc += 'param/Origin=' + encodeURIComponent(host) + '/';
    enc += 'param/Referer=' + encodeURIComponent(host + '/') + '/';
    enc += 'param/User-Agent=' + encodeURIComponent(baseUserAgent()) + '/';
    if (captureHeaders) enc += 'cookie_plus/param/Cookie=/';
    if (cookie) enc += 'param/Cookie=' + encodeURIComponent(cookie) + '/';
    return enc;
  }

  function networkError(network, xhr, exception) {
    try {
      if (network && network.errorDecode) return network.errorDecode(xhr, exception);
    } catch (e) {}
    if (xhr && xhr.status) return 'HTTP ' + xhr.status;
    return exception || 'Нет подключения';
  }

  function unwrapBody(result) {
    if (result && typeof result === 'object' && typeof result.body !== 'undefined') {
      return result.body;
    }
    return result;
  }

  function inspectHtml(str) {
    str = String(str || '');
    if (!str) return '';

    if (
      str.indexOf('Проверяем, что вы не бот!') !== -1 ||
      str.indexOf('checking that you are not a bot') !== -1 ||
      str.indexOf('cf-chl-') !== -1
    ) {
      return 'Антибот-проверка HDRezka';
    }

    if (/<form[^>]+id=["']check-form["'][^>]*>/i.test(str)) {
      return 'HDRezka требует авторизацию';
    }

    if (/<span>MIRROR<\/span>.*?\$\.cookie\(/i.test(str)) {
      return 'HDRezka требует cookie зеркала';
    }

    var error = str.match(/(<div class="error-code">[\s\S]*?<\/div>)\s*(<div class="error-title">[\s\S]*?<\/div>)/i);
    if (error) {
      try {
        return $(error[0]).text().trim() || 'Ошибка HDRezka';
      } catch (e) {
        return 'Ошибка HDRezka';
      }
    }

    if (startsWith(str, 'Fatal error:')) return str.substring(0, 300);
    return '';
  }

  function routeCandidates(forceProxy) {
    var activeHost = trimSlash(setting(STORAGE.activeHost, ''));
    var authMode = setting(STORAGE.authMode, '');
    var useProxy = typeof forceProxy === 'boolean' ? forceProxy : shouldProxy();
    var routes = [];

    if (authMode === 'browser' && activeHost && !useProxy) {
      routes.push({ host: activeHost, proxy: '', kind: 'direct' });
      return routes;
    }

    if (authMode === 'proxy' && activeHost && useProxy) {
      proxyList().forEach(function (proxy) {
        routes.push({ host: activeHost, proxy: proxy, kind: 'proxy' });
      });
      return routes;
    }

    if (useProxy) {
      var phost = proxyHost();
      proxyList().forEach(function (proxy) {
        routes.push({ host: phost, proxy: proxy, kind: 'proxy' });
      });

      var mirror = directMirror();
      if (mirror !== phost) {
        proxyList().forEach(function (proxy) {
          routes.push({ host: mirror, proxy: proxy, kind: 'proxy' });
        });
      }
    } else {
      routes.push({ host: directMirror(), proxy: '', kind: 'direct' });
      if (routeMode() === 'auto') {
        var ph = proxyHost();
        proxyList().forEach(function (proxy) {
          routes.push({ host: ph, proxy: proxy, kind: 'proxy' });
        });
      }
    }

    var unique = [];
    var seen = {};
    routes.forEach(function (route) {
      var key = route.host + '|' + route.proxy;
      if (!seen[key]) {
        seen[key] = true;
        unique.push(route);
      }
    });
    return unique;
  }

  function requestOne(route, path, options) {
    options = options || {};

    return new Promise(function (resolve, reject) {
      var network = new Lampa.Reguest();
      currentNetwork = network;

      var url = startsWith(path, 'http://') || startsWith(path, 'https://')
        ? forceHost(path, route.host)
        : trimSlash(route.host) + (startsWith(path, '/') ? path : '/' + path);

      var cookie = options.cookie;
      if (typeof cookie === 'undefined') cookie = activeCookie();

      var data = typeof options.data === 'undefined' ? false : options.data;
      var settings = {
        timeout: options.timeout || 12000
      };

      network.timeout(options.timeout || 12000);

      if (route.proxy) {
        var enc = buildProxyEnc(route.host, cookie, !!options.captureHeaders);
        url = proxyLink(url, route.proxy, enc, 'enc2t');
        if (!options.captureHeaders && options.dataType) settings.dataType = options.dataType;
      } else {
        settings.withCredentials = true;
        if (options.dataType) settings.dataType = options.dataType;

        if (isAndroid()) {
          settings.headers = {
            'Origin': route.host,
            'Referer': route.host + '/',
            'User-Agent': baseUserAgent()
          };
          if (cookie) settings.headers.Cookie = cookie;
        }

        if (options.captureHeaders && isAndroid()) {
          settings.returnHeaders = true;
        }
      }

      log('request', route.kind, route.host, route.proxy, path);

      network.native(
        url,
        function (result) {
          routeDebug = route.kind + ' • ' + route.host + (route.proxy ? ' • ' + route.proxy : '');
          set(STORAGE.lastRoute, routeDebug);
          resolve({ result: result, route: route });
        },
        function (xhr, exception) {
          reject({
            message: networkError(network, xhr, exception),
            status: xhr && xhr.status ? Number(xhr.status) : 0,
            xhr: xhr,
            exception: exception,
            route: route
          });
        },
        data,
        settings
      );
    });
  }

  function requestRezka(path, options) {
    options = options || {};
    var routes = options.routes || routeCandidates(options.forceProxy);
    var index = 0;
    var lastError = null;

    function next() {
      if (index >= routes.length) {
        var message = lastError && lastError.message ? lastError.message : 'Нет рабочего маршрута HDRezka';
        return Promise.reject(new Error(message));
      }

      var route = routes[index++];
      return requestOne(route, path, options)
        .then(function (response) {
          if (options.rejectChallenge) {
            var body = unwrapBody(response.result);
            if (typeof body === 'string') {
              var reason = inspectHtml(body);
              if (reason) {
                lastError = { message: reason + ' • ' + route.host };
                return next();
              }
            }
          }
          return response;
        })
        .catch(function (error) {
          lastError = error || lastError;
          return next();
        });
    }

    return next();
  }

  function parseVerifyCookie(body) {
    var match = String(body || '').match(/<span>MIRROR<\/span>[\s\S]*?<button[^>]+onclick="\$\.cookie\(([^)]*)\)/i);
    if (!match) return null;

    try {
      var args = match[1];
      var fn = new Function(
        'return (function(){ var out=null; function c(name,value){out={name:name,value:value};} c(' + args + '); return out; })();'
      );
      return fn();
    } catch (e) {
      return null;
    }
  }

  function proxyLoginRoute(route, login, password) {
    var loginPath = '/ajax/login/';
    var postdata =
      'login_name=' + encodeURIComponent(login) +
      '&login_password=' + encodeURIComponent(password) +
      '&login_not_save=0';

    return requestOne(route, loginPath, {
      data: postdata,
      captureHeaders: true,
      cookie: '',
      timeout: 15000
    }).then(function (response) {
      var wrapper = response.result || {};
      var body = unwrapBody(wrapper);
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {}
      }

      if (!body || (!body.success && body.message !== 'Уже авторизован на сайте. Необходимо обновить страницу!')) {
        throw new Error(body && body.message ? body.message : 'HDRezka не подтвердила вход');
      }

      var cookie = mergeSetCookie('', wrapper.headers || {});
      if (!cookie) {
        throw new Error('Прокси не вернул cookie HDRezka');
      }

      var sid = cookieObject(cookie).PHPSESSID || randomId(26);
      set(STORAGE.sid, sid);

      function validate(currentCookie, pass) {
        return requestOne(route, '/', {
          captureHeaders: true,
          cookie: currentCookie,
          timeout: 15000
        }).then(function (rootResponse) {
          var rootWrapper = rootResponse.result || {};
          var html = String(unwrapBody(rootWrapper) || '');
          currentCookie = mergeSetCookie(currentCookie, rootWrapper.headers || {});

          var verify = parseVerifyCookie(html);
          if (verify && pass < 2) {
            var values = cookieObject(currentCookie);
            values[verify.name] = verify.value;
            currentCookie = cookieString(values);
            return validate(currentCookie, pass + 1);
          }

          var reason = inspectHtml(html);
          if (reason && reason !== 'HDRezka требует cookie зеркала') {
            throw new Error(reason);
          }

          if (/<form[^>]+id=["']check-form["'][^>]*>/i.test(html)) {
            throw new Error('HDRezka не сохранила авторизацию');
          }

          return currentCookie;
        });
      }

      return validate(cookie, 0).then(function (finalCookie) {
        set(STORAGE.cookie, finalCookie);
        set(STORAGE.status, 'true');
        set(STORAGE.authMode, 'proxy');
        set(STORAGE.activeHost, route.host);
        set(STORAGE.password, '');
        syncToOnlineMod(finalCookie);
        return true;
      });
    });
  }

  function proxyLogin(login, password) {
    var routes = routeCandidates(true);
    var i = 0;
    var lastError = null;

    function next() {
      if (i >= routes.length) {
        throw new Error(lastError && lastError.message ? lastError.message : 'Не удалось войти через TV-прокси');
      }

      var route = routes[i++];
      return proxyLoginRoute(route, login, password)
        .catch(function (error) {
          lastError = error;
          return next();
        });
    }

    return Promise.resolve().then(next);
  }

  function directLogin(login, password) {
    var route = { host: directMirror(), proxy: '', kind: 'direct' };
    var postdata =
      'login_name=' + encodeURIComponent(login) +
      '&login_password=' + encodeURIComponent(password) +
      '&login_not_save=0';

    return requestOne(route, '/ajax/login/', {
      data: postdata,
      timeout: 12000
    }).then(function (response) {
      var json = response.result;
      if (typeof json === 'string') {
        try { json = JSON.parse(json); } catch (e) {}
      }

      if (!json || (!json.success && json.message !== 'Уже авторизован на сайте. Необходимо обновить страницу!')) {
        throw new Error(json && json.message ? json.message : 'HDRezka не подтвердила вход');
      }

      return requestOne(route, '/', {
        dataType: 'text',
        timeout: 12000
      }).then(function (root) {
        var html = String(root.result || '');
        var reason = inspectHtml(html);
        if (reason) throw new Error(reason);

        set(STORAGE.status, 'true');
        set(STORAGE.authMode, 'browser');
        set(STORAGE.activeHost, route.host);
        set(STORAGE.password, '');
        return true;
      });
    });
  }

  function proxyConsent() {
    if (!shouldProxy()) return Promise.resolve(true);
    if (setting(STORAGE.proxyAck, '0') === '1') return Promise.resolve(true);

    return new Promise(function (resolve, reject) {
      var enabled = null;
      try {
        enabled = Lampa.Controller.enabled().name;
      } catch (e) {}

      Lampa.Select.show({
        title: 'HDREZKA • вход на VIDAA',
        items: [
          {
            title: 'Продолжить',
            subtitle: 'На TV используется совместимый CORS-прокси как в Online Mod. Прокси технически видит запрос входа и cookie.',
            allow: true
          },
          {
            title: 'Отмена',
            subtitle: 'Можно вставить cookie вручную в настройках.',
            allow: false
          }
        ],
        onSelect: function (item) {
          try { Lampa.Select.hide(); } catch (e) {}
          if (item.allow) {
            set(STORAGE.proxyAck, '1');
            resolve(true);
          } else {
            reject(new Error('Вход отменён'));
          }
          if (enabled) {
            try { Lampa.Controller.toggle(enabled); } catch (e) {}
          }
        },
        onBack: function () {
          try { Lampa.Select.hide(); } catch (e) {}
          reject(new Error('Вход отменён'));
          if (enabled) {
            try { Lampa.Controller.toggle(enabled); } catch (e) {}
          }
        }
      });
    });
  }

  function loginAccount() {
    var login = String(get(STORAGE.login, '') || '').trim();
    var password = String(get(STORAGE.password, '') || '');

    if (!login || !password) {
      return Promise.reject(new Error('Введите логин и пароль HDRezka в настройках'));
    }

    return proxyConsent().then(function () {
      if (shouldProxy()) {
        return proxyLogin(login, password);
      }

      return directLogin(login, password).catch(function (directError) {
        if (routeMode() !== 'auto') throw directError;
        return proxyLogin(login, password);
      });
    }).then(function () {
      notice('✅ HDRezka Premium подключена');
      updateAccountButtons();
      return true;
    });
  }

  function logoutAccount() {
    set(STORAGE.cookie, '');
    set(STORAGE.sid, '');
    set(STORAGE.status, 'false');
    set(STORAGE.authMode, '');
    set(STORAGE.activeHost, '');
    set(STORAGE.password, '');

    if (boolValue(STORAGE.syncOnlineMod, true)) {
      set('online_mod_rezka2_cookie', '');
      set('online_mod_rezka2_status', 'false');
    }

    updateAccountButtons();
    notice('HDRezka отключена');
  }

  function accountConnected() {
    if (setting(STORAGE.status, 'false') === 'true') return true;
    if (activeCookie()) return true;
    return false;
  }

  function checkAccount() {
    if (!accountConnected()) {
      return Promise.reject(new Error('HDRezka не подключена'));
    }

    return requestRezka('/', {
      dataType: 'text',
      rejectChallenge: false,
      timeout: 12000
    }).then(function (response) {
      var html = String(unwrapBody(response.result) || '');
      var reason = inspectHtml(html);

      if (/<form[^>]+id=["']check-form["'][^>]*>/i.test(html)) {
        set(STORAGE.status, 'false');
        throw new Error('Сессия HDRezka истекла');
      }

      if (reason && reason !== 'HDRezka требует cookie зеркала') {
        throw new Error(reason);
      }

      set(STORAGE.status, 'true');
      updateAccountButtons();
      return true;
    });
  }

  function openSettings() {
    try {
      if (Lampa.Settings && Lampa.Settings.create) {
        Lampa.Settings.create(SETTINGS);
        return;
      }
    } catch (e) {}

    try {
      Lampa.Controller.toggle('settings');
    } catch (e) {}

    notice('Настройки → HDREZKA Premium • by DENYS');
  }

  function showDiagnostics() {
    var platform = isMSX()
      ? 'Media Station X'
      : isAndroid()
        ? 'Android'
        : isPlatform('webos')
          ? 'WebOS'
          : isPlatform('tizen')
            ? 'Tizen'
            : 'Web';

    var lines = [
      'HDREZKA Premium • by DENYS v' + VERSION,
      'Платформа: ' + platform,
      'Режим сети: ' + routeMode(),
      'Текущий host: ' + (setting(STORAGE.activeHost, '') || 'не выбран'),
      'Mirror: ' + directMirror(),
      'Cookie: ' + (activeCookie() ? 'есть' : 'нет'),
      'Auth: ' + (setting(STORAGE.authMode, '') || 'нет'),
      'Online Mod cookie: ' + (get('online_mod_rezka2_cookie', '') ? 'есть' : 'нет'),
      'Последний маршрут: ' + (setting(STORAGE.lastRoute, '') || routeDebug || 'нет')
    ];

    var html = $('<div class="hdrezka-diag"></div>');
    lines.forEach(function (line) {
      html.append($('<div></div>').text(line));
    });

    var enabled = null;
    try { enabled = Lampa.Controller.enabled().name; } catch (e) {}

    try {
      Lampa.Modal.open({
        title: 'Диагностика HDREZKA',
        html: html,
        size: 'medium',
        onBack: function () {
          Lampa.Modal.close();
          if (enabled) Lampa.Controller.toggle(enabled);
        }
      });
    } catch (e) {
      notice(lines.join(' • '));
    }
  }

  function openAccountMenu() {
    var items = [];

    if (accountConnected()) {
      items.push({
        title: '✅ HDRezka подключена',
        subtitle: String(get(STORAGE.login, '') || 'Premium-сессия'),
        action: 'check'
      });
      items.push({
        title: '🔄 Войти заново',
        subtitle: 'Использовать логин/пароль из настроек',
        action: 'login'
      });
      items.push({
        title: '🚪 Отключить аккаунт',
        subtitle: 'Удалить cookie с этого устройства',
        action: 'logout'
      });
    } else {
      items.push({
        title: '🔐 Войти в HDRezka',
        subtitle: 'Логин/пароль берутся из настроек',
        action: 'login'
      });
      if (get('online_mod_rezka2_cookie', '')) {
        items.push({
          title: '⚡ Импортировать сессию Online Mod',
          subtitle: 'Использовать уже сохранённую HDRezka-cookie',
          action: 'import'
        });
      }
    }

    items.push({
      title: '⚙ Настройки HDREZKA',
      subtitle: 'Mirror, proxy, качество, плеер, таймкод',
      action: 'settings'
    });

    items.push({
      title: '🧪 Диагностика',
      subtitle: 'Показать host/proxy/cookie/платформу',
      action: 'diag'
    });

    var enabled = null;
    try { enabled = Lampa.Controller.enabled().name; } catch (e) {}

    Lampa.Select.show({
      title: 'HDREZKA Premium • by DENYS',
      items: items,
      onSelect: function (item) {
        try { Lampa.Select.hide(); } catch (e) {}

        if (item.action === 'check') {
          notice('HDREZKA: проверяем аккаунт…');
          checkAccount()
            .then(function () { notice('✅ Сессия HDRezka активна'); })
            .catch(function (error) { notice('❌ ' + error.message); });
        } else if (item.action === 'login') {
          notice('HDREZKA: выполняем вход…');
          loginAccount().catch(function (error) {
            notice('❌ ' + error.message);
            openSettings();
          });
        } else if (item.action === 'logout') {
          logoutAccount();
        } else if (item.action === 'import') {
          importOnlineModSession(false);
        } else if (item.action === 'settings') {
          openSettings();
        } else if (item.action === 'diag') {
          showDiagnostics();
        }

        if (enabled && item.action !== 'settings' && item.action !== 'diag') {
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

  function updateAccountButtons() {
    try {
      var connected = accountConnected();
      $('.view--hdrezka-account span').text(connected ? 'REZKA ✓' : 'ВОЙТИ');
      $('.view--hdrezka-account').attr(
        'data-subtitle',
        connected ? 'HDRezka Premium подключена' : 'Подключить Premium-аккаунт HDRezka'
      );
      $('.hdrezka-denys-brand__status').text(
        connected
          ? '● Premium подключён'
          : '○ Требуется вход'
      );
    } catch (e) {}
  }

  function parsePlaylist(str) {
    var pl = [];
    try {
      if (startsWith(str, '[')) {
        str.substring(1).split(/, *\[/).forEach(function (item) {
          item = item.trim();
          if (endsWith(item, ',')) item = item.substring(0, item.length - 1).trim();
          var labelEnd = item.indexOf(']');
          if (labelEnd >= 0) {
            var label = item.substring(0, labelEnd).trim();

            if (item.charAt(labelEnd + 1) === '{') {
              item.substring(labelEnd + 2).split(/; *\{/).forEach(function (voiceItem) {
                voiceItem = voiceItem.trim();
                if (endsWith(voiceItem, ';')) {
                  voiceItem = voiceItem.substring(0, voiceItem.length - 1).trim();
                }
                var voiceEnd = voiceItem.indexOf('}');
                if (voiceEnd >= 0) {
                  var voice = voiceItem.substring(0, voiceEnd).trim();
                  pl.push({
                    label: label,
                    voice: voice,
                    links: voiceItem.substring(voiceEnd + 1).split(' or ').map(function (link) {
                      return link.trim();
                    }).filter(function (link) { return link; })
                  });
                }
              });
            } else {
              pl.push({
                label: label,
                links: item.substring(labelEnd + 1).split(' or ').map(function (link) {
                  return link.trim();
                }).filter(function (link) { return link; })
              });
            }
          }
        });

        pl = pl.filter(function (item) {
          return item.links && item.links.length;
        });
      }
    } catch (e) {}

    return pl;
  }

  function decodeRezka(data) {
    if (!startsWith(data, '#')) return data;

    function enc(str) {
      return btoa(
        encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
          return String.fromCharCode('0x' + p1);
        })
      );
    }

    function dec(str) {
      return decodeURIComponent(
        atob(str).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
    }

    var trashList = [
      '$$!!@$$@^!@#$$@',
      '@@@@@!##!^^^',
      '####^!!##!@@',
      '^^^!@##!!##',
      '$$#!!@#!@##'
    ];

    var x = data.substring(2);
    trashList.forEach(function (trash) {
      x = x.replace('//_//' + enc(trash), '');
    });

    try {
      x = dec(x);
    } catch (e) {
      x = '';
    }

    return x;
  }

  function qualityNumber(label) {
    var match = String(label || '').match(/(\d\d\d+)/);
    if (match) return parseInt(match[1], 10);

    match = String(label || '').match(/(\d+)K/i);
    if (match) return parseInt(match[1], 10) * 1000;

    return 0;
  }

  function chooseStreamLink(item) {
    var mode = setting(STORAGE.format, 'hls');
    var links = item.links || [];
    var filtered = [];

    if (mode === 'mp4') {
      filtered = links.filter(function (url) {
        return /\.mp4(\?|$)/i.test(url);
      });
    } else if (mode === 'hls') {
      filtered = links.filter(function (url) {
        return /\.m3u8(\?|$)/i.test(url) || /:hls:manifest\.m3u8/i.test(url);
      });
    }

    if (!filtered.length) filtered = links;
    return filtered[0] || '';
  }

  function processStream(url) {
    if (!url) return url;

    var mode = setting(STORAGE.streamMode, 'off');

    if (mode === 'fix') {
      return url.replace(
        /\/\/(stream\.voidboost\.(cc|top|link|club)|[^\/]*\.ukrtelcdn\.net)\//i,
        '//femeretes.org/'
      );
    }

    if (mode === 'ukr') {
      var host = setting(STORAGE.streamProxy, 'prx.ukrtelcdn.net');
      return url.replace(
        /\/\/(stream\.voidboost\.(cc|top|link|club)|[^\/]*\.ukrtelcdn\.net|vdbmate\.org|sambray\.org|rumbegg\.org|laptostack\.org|frntroy\.org|femeretes\.org)\//i,
        '//' + host + '/'
      );
    }

    return url;
  }

  function streamsFromPayload(str) {
    var decoded = decodeRezka(str || '');
    var list = parsePlaylist(decoded);
    var rows = [];

    list.forEach(function (item) {
      var link = chooseStreamLink(item);
      if (!link) return;
      rows.push({
        label: item.label,
        quality: qualityNumber(item.label),
        file: processStream(link)
      });
    });

    rows.sort(function (a, b) {
      if (b.quality !== a.quality) return b.quality - a.quality;
      return String(b.label).localeCompare(String(a.label));
    });

    return rows;
  }

  function subtitlesFromPayload(str) {
    if (!str) return [];
    return parsePlaylist(str).map(function (item) {
      return {
        label: item.label,
        url: item.links && item.links[0] ? item.links[0] : ''
      };
    }).filter(function (item) {
      return item.url;
    });
  }

  function pickQuality(qualityMap, fallback) {
    if (!qualityMap) return fallback;

    var preferred = setting(STORAGE.quality, 'max');
    var labels = Object.keys(qualityMap);

    if (!labels.length) return fallback;
    if (preferred === 'max') return qualityMap[labels[0]] || fallback;

    var target = parseInt(preferred, 10) || 1080;
    var rows = labels.map(function (label) {
      return {
        label: label,
        q: qualityNumber(label),
        url: qualityMap[label]
      };
    }).sort(function (a, b) {
      return b.q - a.q;
    });

    var picked = null;
    rows.forEach(function (row) {
      if (!picked && row.q <= target) picked = row;
    });

    if (!picked) picked = rows[rows.length - 1];
    return picked && picked.url ? picked.url : fallback;
  }

  function renameQualityMap(map) {
    if (!map) return map;
    var renamed = {};
    for (var label in map) {
      if (map.hasOwnProperty(label)) renamed['\u200B' + label] = map[label];
    }
    return renamed;
  }

  function normalizeTitle(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    a = normalizeTitle(a);
    b = normalizeTitle(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var v0 = [];
    var v1 = [];
    var i;
    for (i = 0; i <= b.length; i++) v0[i] = i;

    for (i = 0; i < a.length; i++) {
      v1[0] = i + 1;

      for (var j = 0; j < b.length; j++) {
        var cost = a.charAt(i) === b.charAt(j) ? 0 : 1;
        v1[j + 1] = Math.min(
          v1[j] + 1,
          v0[j + 1] + 1,
          v0[j] + cost
        );
      }

      var tmp = v0;
      v0 = v1;
      v1 = tmp;
    }

    return v0[b.length];
  }

  function titleScore(a, b) {
    a = normalizeTitle(a);
    b = normalizeTitle(b);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 88;

    var max = Math.max(a.length, b.length);
    var distance = levenshtein(a, b);
    return Math.round((1 - distance / max) * 100);
  }

  function movieYear(movie) {
    var date = movie.release_date || movie.first_air_date || movie.last_air_date || '';
    var year = parseInt(String(date).slice(0, 4), 10);
    return year || 0;
  }

  function movieTitle(movie) {
    return movie.title || movie.name || movie.original_title || movie.original_name || '';
  }

  function originalTitle(movie) {
    return movie.original_title || movie.original_name || '';
  }

  function searchResultScore(row, movie) {
    var score = Math.max(
      titleScore(row.title, movieTitle(movie)),
      titleScore(row.title, originalTitle(movie)),
      titleScore(row.orig_title, originalTitle(movie))
    );

    var wanted = movieYear(movie);
    if (wanted && row.year) {
      var diff = Math.abs(wanted - row.year);
      if (diff === 0) score += 20;
      else if (diff === 1) score += 6;
      else if (diff >= 3) score -= 18;
    }

    return score;
  }

  function parseFastSearch(html, host) {
    var root = $('<div>' + String(html || '') + '</div>');
    var nodes = root.find('.b-search__section_list li, .b-search__live_section li');
    if (!nodes.length) nodes = root.find('li');

    var rows = [];
    var seen = {};

    nodes.each(function () {
      var a = $(this).find('a').first();
      var href = a.attr('href') || '';
      if (!href) return;

      var enty = a.find('.enty').first();
      var title = enty.text().trim();
      var clone = a.clone();
      clone.find('.enty,.rating').remove();
      var tail = clone.text().trim();

      if (!title) title = a.text().trim();

      var yearMatch = tail.match(/\b((?:19|20)\d{2})\b/);
      var year = yearMatch ? parseInt(yearMatch[1], 10) : 0;

      var orig = '';
      var altMatch = tail.match(/^\s*([^а-яА-ЯёЁ]+),\s*(?:19|20)\d{2}/);
      if (altMatch) orig = altMatch[1].trim();

      var link = forceHost(href, host);
      if (!seen[link]) {
        seen[link] = true;
        rows.push({
          title: title,
          orig_title: orig,
          year: year,
          link: link
        });
      }
    });

    return rows;
  }

  function parseFullSearch(html, host) {
    var root = $('<div>' + String(html || '') + '</div>');
    var rows = [];
    var seen = {};

    root.find('.b-content__inline_item').each(function () {
      var block = $(this).find('.b-content__inline_item-link').first();
      var a = block.find('a').first();
      var href = a.attr('href') || '';
      if (!href) return;

      var title = a.text().trim();
      var info = block.find('div').last().text().trim();
      var yearMatch = info.match(/\b((?:19|20)\d{2})\b/);
      var year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
      var link = forceHost(href, host);

      if (!seen[link]) {
        seen[link] = true;
        rows.push({
          title: title,
          orig_title: '',
          year: year,
          link: link
        });
      }
    });

    return rows;
  }

  function searchQuery(query) {
    var post = 'q=' + encodeURIComponent(query);

    return requestRezka('/engine/ajax/search.php', {
      data: post,
      dataType: 'text',
      rejectChallenge: true,
      timeout: 12000
    }).then(function (response) {
      var html = String(response.result || '');
      var rows = parseFastSearch(html, response.route.host);
      if (rows.length) return rows;

      return requestRezka(
        '/search/?do=search&subaction=search&q=' + encodeURIComponent(query) + '&page=1',
        {
          dataType: 'text',
          rejectChallenge: true,
          timeout: 12000,
          routes: [response.route]
        }
      ).then(function (full) {
        return parseFullSearch(String(full.result || ''), full.route.host);
      });
    });
  }

  function resolveMovie(movie, manualQuery) {
    var queries = [];
    if (manualQuery) queries.push(manualQuery);
    if (movieTitle(movie)) queries.push(movieTitle(movie));
    if (originalTitle(movie) && queries.indexOf(originalTitle(movie)) === -1) {
      queries.push(originalTitle(movie));
    }

    var index = 0;
    var collected = [];

    function next() {
      if (index >= queries.length) return Promise.resolve(collected);

      var query = queries[index++];
      return searchQuery(query)
        .then(function (rows) {
          rows.forEach(function (row) {
            if (!collected.some(function (x) { return x.link === row.link; })) {
              collected.push(row);
            }
          });

          if (collected.length) return collected;
          return next();
        })
        .catch(function (error) {
          if (index < queries.length) return next();
          throw error;
        });
    }

    return next().then(function (rows) {
      rows.forEach(function (row) {
        row.score = searchResultScore(row, movie);
      });

      rows.sort(function (a, b) {
        return b.score - a.score;
      });

      return rows;
    });
  }

  function parsePage(html, url) {
    var str = String(html || '').replace(/\n/g, '');
    var challenge = inspectHtml(str);
    if (challenge) throw new Error(challenge);

    var extract = {
      url: url,
      voice: [],
      season: [],
      episode: [],
      voice_data: {},
      is_series: false,
      film_id: '',
      favs: '',
      blocked: false
    };

    var translation = str.match(/<h2>В переводе<\/h2>:<\/td>\s*(<td>.*?<\/td>)/);
    var cdnSeries = str.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
    var cdnMovie = str.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
    var devVoiceName = '';

    if (translation) {
      try { devVoiceName = $(translation[1]).text().trim(); } catch (e) {}
    }
    if (!devVoiceName) devVoiceName = 'Оригинал';

    var defVoice = null;
    var defSeason = null;
    var defEpisode = null;

    if (cdnSeries) {
      extract.is_series = true;
      extract.film_id = cdnSeries[1];
      defVoice = {
        name: devVoiceName,
        id: cdnSeries[2]
      };
      defSeason = {
        name: 'Сезон ' + cdnSeries[3],
        id: cdnSeries[3]
      };
      defEpisode = {
        name: 'Серия ' + cdnSeries[4],
        season_id: cdnSeries[3],
        episode_id: cdnSeries[4],
        translator_id: cdnSeries[2]
      };
    } else if (cdnMovie) {
      extract.film_id = cdnMovie[1];
      defVoice = {
        name: devVoiceName,
        id: cdnMovie[2],
        is_camrip: cdnMovie[3],
        is_ads: cdnMovie[4],
        is_director: cdnMovie[5]
      };
    }

    var voices = str.match(/(<ul id="translators-list"[\s\S]*?<\/ul>)/);
    if (voices) {
      var voiceRoot = $(voices[1]);

      $('.b-translator__item', voiceRoot).each(function () {
        var title = ($(this).attr('title') || $(this).text() || '').trim();

        $('img', this).each(function () {
          var lang = ($(this).attr('title') || $(this).attr('alt') || '').trim();
          if (lang && title.indexOf(lang) === -1) title += ' (' + lang + ')';
        });

        extract.voice.push({
          name: title || 'Оригинал',
          id: $(this).attr('data-translator_id'),
          is_camrip: $(this).attr('data-camrip'),
          is_ads: $(this).attr('data-ads'),
          is_director: $(this).attr('data-director')
        });
      });
    }

    if (!extract.voice.length && defVoice) extract.voice.push(defVoice);

    if (extract.is_series) {
      var seasons = str.match(/(<ul id="simple-seasons-tabs"[\s\S]*?<\/ul>)/);
      if (seasons) {
        var seasonRoot = $(seasons[1]);
        $('.b-simple_season__item', seasonRoot).each(function () {
          extract.season.push({
            name: $(this).text().trim(),
            id: $(this).attr('data-tab_id')
          });
        });
      }
      if (!extract.season.length && defSeason) extract.season.push(defSeason);

      var episodes = str.match(/(<div id="simple-episodes-tabs"[\s\S]*?<\/div>)/);
      if (episodes) {
        var epRoot = $(episodes[1]);
        $('.b-simple_episode__item', epRoot).each(function () {
          extract.episode.push({
            name: $(this).text().trim(),
            translator_id: defVoice ? defVoice.id : '',
            season_id: $(this).attr('data-season_id'),
            episode_id: $(this).attr('data-episode_id')
          });
        });
      }
      if (!extract.episode.length && defEpisode) extract.episode.push(defEpisode);
    }

    var favs = str.match(/<input type="hidden" id="ctrl_favs" value="([^"]*)"/);
    if (favs) extract.favs = favs[1];

    if (/class="b-player__restricted__block_message"/.test(str)) {
      extract.blocked = true;
    }

    if (!extract.film_id) {
      throw new Error('HDRezka: страница открылась, но player ID не найден');
    }

    return extract;
  }

  function fetchPage(link) {
    return requestRezka(link, {
      dataType: 'text',
      rejectChallenge: true,
      timeout: 15000
    }).then(function (response) {
      return parsePage(String(response.result || ''), forceHost(link, response.route.host));
    });
  }

  function fetchEpisodes(details, voice) {
    if (!details.is_series) return Promise.resolve(details);

    var translatorId = voice.id;
    if (details.voice_data[translatorId]) {
      details.season = details.voice_data[translatorId].season;
      details.episode = details.voice_data[translatorId].episode;
      return Promise.resolve(details);
    }

    var postdata =
      'id=' + encodeURIComponent(details.film_id) +
      '&translator_id=' + encodeURIComponent(translatorId) +
      '&favs=' + encodeURIComponent(details.favs || '') +
      '&action=get_episodes';

    return requestRezka('/ajax/get_cdn_series/?t=' + Date.now(), {
      data: postdata,
      timeout: 12000
    }).then(function (response) {
      var json = response.result;
      if (typeof json === 'string') {
        try { json = JSON.parse(json); } catch (e) {}
      }

      if (!json || (!json.seasons && !json.episodes)) {
        throw new Error(json && json.message ? json.message : 'HDRezka не вернула список серий');
      }

      var data = { season: [], episode: [] };

      if (json.seasons) {
        var seasonRoot = $('<ul>' + json.seasons + '</ul>');
        $('.b-simple_season__item', seasonRoot).each(function () {
          data.season.push({
            name: $(this).text().trim(),
            id: $(this).attr('data-tab_id')
          });
        });
      }

      if (json.episodes) {
        var episodeRoot = $('<div>' + json.episodes + '</div>');
        $('.b-simple_episode__item', episodeRoot).each(function () {
          data.episode.push({
            name: $(this).text().trim(),
            translator_id: translatorId,
            season_id: $(this).attr('data-season_id'),
            episode_id: $(this).attr('data-episode_id')
          });
        });
      }

      details.voice_data[translatorId] = data;
      details.season = data.season;
      details.episode = data.episode;
      return details;
    });
  }

  function streamKey(details, media) {
    return [
      details.url,
      media && (media.translator_id || media.id) || '',
      media && media.season_id || '',
      media && media.episode_id || ''
    ].join('|');
  }

  var streamCache = {};

  function fetchStream(details, media) {
    var key = streamKey(details, media);
    if (streamCache[key]) return streamCache[key];

    var postdata = 'id=' + encodeURIComponent(details.film_id);

    if (details.is_series) {
      postdata += '&translator_id=' + encodeURIComponent(media.translator_id);
      postdata += '&season=' + encodeURIComponent(media.season_id);
      postdata += '&episode=' + encodeURIComponent(media.episode_id);
      postdata += '&favs=' + encodeURIComponent(details.favs || '');
      postdata += '&action=get_stream';
    } else {
      postdata += '&translator_id=' + encodeURIComponent(media.id);
      postdata += '&is_camrip=' + encodeURIComponent(media.is_camrip || 0);
      postdata += '&is_ads=' + encodeURIComponent(media.is_ads || 0);
      postdata += '&is_director=' + encodeURIComponent(media.is_director || 0);
      postdata += '&favs=' + encodeURIComponent(details.favs || '');
      postdata += '&action=get_movie';
    }

    var promise = requestRezka('/ajax/get_cdn_series/?t=' + Date.now(), {
      data: postdata,
      timeout: 15000
    }).then(function (response) {
      var json = response.result;
      if (typeof json === 'string') {
        try { json = JSON.parse(json); } catch (e) {}
      }

      if (!json || !json.url) {
        var message = json && json.message ? json.message : '';
        if (json && json.premium_content) {
          message = message || 'Этот перевод требует HDRezka Premium';
        }
        throw new Error(message || 'HDRezka не вернула видеопоток');
      }

      var rows = streamsFromPayload(json.url);
      if (!rows.length) throw new Error('HDRezka вернула поток, но не удалось разобрать качества');

      var quality = {};
      rows.forEach(function (row) {
        quality[row.label] = row.file;
      });

      return {
        url: rows[0].file,
        quality: quality,
        subtitles: subtitlesFromPayload(json.subtitle || '')
      };
    }).catch(function (error) {
      delete streamCache[key];
      throw error;
    });

    streamCache[key] = promise;
    return promise;
  }

  function timelineBase(movie) {
    return movie.original_title || movie.original_name || movie.title || movie.name || 'HDRezka';
  }

  function timelineHash(movie, media) {
    var base = timelineBase(movie);

    if (media && media.season_id && media.episode_id) {
      var season = parseInt(media.season_id, 10) || 1;
      return Lampa.Utils.hash([
        season,
        season > 10 ? ':' : '',
        media.episode_id,
        base
      ].join(''));
    }

    return Lampa.Utils.hash(base);
  }

  function timelineView(movie, media) {
    return Lampa.Timeline.view(timelineHash(movie, media));
  }

  function watchedThreshold() {
    var value = parseInt(setting(STORAGE.watchedAt, '95'), 10);
    if (!value || value < 50 || value > 100) value = 95;
    return value;
  }

  function choiceKey(movie) {
    return String(movie.id || timelineBase(movie)) + '|' + String(movieYear(movie) || '');
  }

  function loadChoice(movie) {
    return readJson(STORAGE.choices)[choiceKey(movie)] || {};
  }

  function saveChoice(movie, choice) {
    var all = readJson(STORAGE.choices);
    all[choiceKey(movie)] = choice;
    writeJson(STORAGE.choices, all);
  }

  function beginPlayerScope() {
    if (playerRestoreTimer) {
      clearTimeout(playerRestoreTimer);
      playerRestoreTimer = null;
    }

    if (!playerScopeActive) {
      try { oldTimecode = Lampa.Storage.get('player_timecode', 'continue'); } catch (e) {}
      try { oldPlaylistNext = Lampa.Storage.get('playlist_next', true); } catch (e) {}
    }

    playerScopeActive = true;

    try {
      Lampa.Storage.set('player_timecode', setting(STORAGE.resumeMode, 'continue'));
    } catch (e) {}

    try {
      Lampa.Storage.set('playlist_next', boolValue(STORAGE.autoNext, true));
    } catch (e) {}

    if (setting(STORAGE.playerMode, 'lampa') === 'lampa') {
      try { Lampa.Player.runas('lampa'); } catch (e) {}
    }
  }

  function schedulePlayerRestore() {
    if (!playerScopeActive) return;
    if (playerRestoreTimer) clearTimeout(playerRestoreTimer);

    playerRestoreTimer = setTimeout(function () {
      try {
        if (oldTimecode !== null && typeof oldTimecode !== 'undefined') {
          Lampa.Storage.set('player_timecode', oldTimecode);
        }
      } catch (e) {}

      try {
        if (oldPlaylistNext !== null && typeof oldPlaylistNext !== 'undefined') {
          Lampa.Storage.set('playlist_next', oldPlaylistNext);
        }
      } catch (e) {}

      playerScopeActive = false;
      oldTimecode = null;
      oldPlaylistNext = null;
      playerRestoreTimer = null;
    }, 1000);
  }

  function addPlayerListeners() {
    if (window.hdrezka_denys_player_listeners) return;
    window.hdrezka_denys_player_listeners = true;

    try {
      if (Lampa.Player && Lampa.Player.listener) {
        Lampa.Player.listener.follow('destroy', function () {
          schedulePlayerRestore();
        });

        Lampa.Player.listener.follow('start', function () {
          if (playerRestoreTimer) {
            clearTimeout(playerRestoreTimer);
            playerRestoreTimer = null;
          }
        });
      }
    } catch (e) {}
  }

  function component(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var last = null;
    var details = null;
    var choice = { voice: 0, season: 0 };
    var selectedLink = '';
    var self = this;

    var brand = $(
      '<div class="hdrezka-denys-brand">' +
        '<div class="hdrezka-denys-brand__logo">HDREZKA Premium</div>' +
        '<div class="hdrezka-denys-brand__edition">by DENYS · v' + VERSION + '</div>' +
        '<div class="hdrezka-denys-brand__status">' +
          (accountConnected() ? '● Premium подключён' : '○ Требуется вход') +
        '</div>' +
      '</div>'
    );

    scroll.body().addClass('torrent-list');
    scroll.minus(files.render().find('.explorer__files-head'));

    function currentVoice() {
      if (!details || !details.voice || !details.voice.length) return null;
      if (!details.voice[choice.voice]) choice.voice = 0;
      return details.voice[choice.voice];
    }

    function currentSeason() {
      if (!details || !details.season || !details.season.length) return null;
      if (!details.season[choice.season]) choice.season = 0;
      return details.season[choice.season];
    }

    function restoreChoice() {
      var saved = loadChoice(object.movie || {});

      if (boolValue(STORAGE.rememberVoice, true) && saved.voice_name && details.voice) {
        details.voice.forEach(function (voice, index) {
          if (voice.name === saved.voice_name) choice.voice = index;
        });
      }

      if (boolValue(STORAGE.rememberSeason, true) && saved.season_id && details.season) {
        details.season.forEach(function (season, index) {
          if (String(season.id) === String(saved.season_id)) choice.season = index;
        });
      }
    }

    function persistChoice(extra) {
      var voice = currentVoice();
      var season = currentSeason();
      var saved = {
        voice_name: voice ? voice.name : '',
        season_id: season ? season.id : ''
      };

      if (extra) {
        for (var key in extra) saved[key] = extra[key];
      }

      saveChoice(object.movie || {}, saved);
    }

    function renderFilter() {
      if (!details) return;

      var select = [
        {
          title: 'Сбросить',
          reset: true
        }
      ];

      function add(type, title, rows, selected) {
        if (!rows || !rows.length) return;

        var items = rows.map(function (row, index) {
          return {
            title: row.name || String(index + 1),
            selected: index === selected,
            index: index
          };
        });

        select.push({
          title: title,
          subtitle: items[selected] ? items[selected].title : '',
          items: items,
          stype: type
        });
      }

      add('voice', 'Озвучка', details.voice, choice.voice);
      if (details.is_series) add('season', 'Сезон', details.season, choice.season);

      filter.set('filter', select);

      var chosen = [];
      var voice = currentVoice();
      var season = currentSeason();

      if (voice) chosen.push('Озвучка: ' + voice.name);
      if (details.is_series && season) chosen.push('Сезон: ' + season.name);

      try { filter.chosen('filter', chosen); } catch (e) {}
    }

    function allEpisodeElements() {
      if (!details || !details.is_series) return [];

      return (details.episode || []).slice().sort(function (a, b) {
        var sa = parseInt(a.season_id, 10) || 0;
        var sb = parseInt(b.season_id, 10) || 0;
        if (sa !== sb) return sa - sb;
        return (parseInt(a.episode_id, 10) || 0) - (parseInt(b.episode_id, 10) || 0);
      });
    }

    function episodeTitle(media) {
      var season = media && media.season_id ? media.season_id : '';
      var episode = media && media.episode_id ? media.episode_id : '';
      var name = media && media.name ? media.name : ('Серия ' + episode);
      return season && episode
        ? 'S' + season + 'E' + episode + ' • ' + name
        : name;
    }

    function createPlayerCell(media, voice, resolved) {
      var view = timelineView(object.movie || {}, details.is_series ? media : null);

      var cell = {
        title: details.is_series ? episodeTitle(media) : movieTitle(object.movie || {}),
        timeline: view
      };

      if (resolved) {
        cell.url = pickQuality(resolved.quality, resolved.url);
        cell.quality = renameQualityMap(resolved.quality);
        cell.subtitles = resolved.subtitles || [];
      }

      return cell;
    }

    function buildPlaylist(selectedMedia, voice, selectedStream) {
      var playlist = [];
      var first = null;
      var rows = details.is_series ? allEpisodeElements() : [voice];

      rows.forEach(function (media) {
        var same = details.is_series
          ? String(media.season_id) === String(selectedMedia.season_id) &&
            String(media.episode_id) === String(selectedMedia.episode_id)
          : true;

        var cell = createPlayerCell(media, voice, same ? selectedStream : null);

        if (!same && details.is_series) {
          cell.url = function (call) {
            fetchStream(details, media)
              .then(function (stream) {
                cell.url = pickQuality(stream.quality, stream.url);
                cell.quality = renameQualityMap(stream.quality);
                cell.subtitles = stream.subtitles || [];
                call();
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

    function launch(media, voice) {
      if (!voice) {
        notice('HDREZKA: озвучка не найдена');
        return;
      }

      persistChoice(details.is_series ? {
        season_id: media.season_id,
        episode_id: media.episode_id
      } : null);

      try {
        if (object.movie && object.movie.id && Lampa.Favorite && Lampa.Favorite.add) {
          Lampa.Favorite.add('history', object.movie, 100);
        }
      } catch (e) {}

      notice('HDREZKA: получаем Premium-поток…');

      fetchStream(details, media)
        .then(function (stream) {
          beginPlayerScope();

          var built = buildPlaylist(media, voice, stream);
          var first = built.first;
          var playlist = built.playlist;

          if (!first || !first.url) throw new Error('Поток не найден');

          if (playlist.length > 1) first.playlist = playlist;

          Lampa.Player.play(first);
          Lampa.Player.playlist(playlist);
        })
        .catch(function (error) {
          notice('HDREZKA: ' + error.message);
        });
    }

    function renderItems() {
      self.reset();

      if (!details) {
        self.empty('HDREZKA: нет данных');
        return;
      }

      var voice = currentVoice();
      var season = currentSeason();
      var items = [];

      if (details.is_series) {
        if (!season) {
          self.empty('HDREZKA: сезоны не найдены');
          return;
        }

        items = (details.episode || []).filter(function (episode) {
          return String(episode.season_id) === String(season.id);
        });
      } else {
        items = [voice];
      }

      if (!items.length) {
        self.empty(details.is_series ? 'HDREZKA: серии не найдены' : 'HDREZKA: видео не найдено');
        return;
      }

      var continueTarget = null;
      var threshold = watchedThreshold();

      items.forEach(function (media) {
        var view = timelineView(object.movie || {}, details.is_series ? media : null);
        var percent = parseFloat(view.percent || 0) || 0;
        var time = parseFloat(view.time || 0) || 0;
        var duration = parseFloat(view.duration || 0) || 0;

        var title = details.is_series ? episodeTitle(media) : 'Смотреть фильм';
        var info = voice && voice.name ? ' / ' + voice.name : '';

        if (percent > 0 && percent < threshold) {
          info += ' • ' + Math.round(percent) + '%';
          try {
            if (time > 0) info += ' • ' + Lampa.Utils.secondsToTime(time, true);
          } catch (e) {}

          if (!continueTarget) title = '▶ ' + title;
        } else if (percent >= threshold) {
          info += ' • ✓ просмотрено';
        }

        var element = {
          title: title,
          quality: setting(STORAGE.quality, 'max') === 'max'
            ? 'MAX'
            : setting(STORAGE.quality, '1080') + 'p',
          info: info
        };

        var item = Lampa.Template.get('hdrezka_denys_item', element);
        media.timeline = view;

        try {
          item.append(Lampa.Timeline.render(view));
          if (Lampa.Timeline.details) {
            item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));
          }
        } catch (e) {}

        if (percent >= threshold) {
          try {
            item.append(
              '<div class="torrent-item__viewed">' +
              Lampa.Template.get('icon_star', {}, true) +
              '</div>'
            );
          } catch (e) {}
        }

        item.on('hover:focus', function (e) {
          last = e.target;
          scroll.update($(e.target), true);
        });

        item.on('hover:enter', function () {
          launch(details.is_series ? media : voice, voice);
        });

        item.on('hover:long', function () {
          var enabled = null;
          try { enabled = Lampa.Controller.enabled().name; } catch (e) {}

          Lampa.Select.show({
            title: 'HDREZKA • Действие',
            items: [
              { title: 'Сбросить таймкод', action: 'reset' },
              { title: 'Запустить во встроенном Lampa', action: 'lampa' },
              { title: 'Диагностика маршрута', action: 'diag' }
            ],
            onSelect: function (action) {
              try { Lampa.Select.hide(); } catch (e) {}

              if (action.action === 'reset') {
                view.percent = 0;
                view.time = 0;
                view.duration = 0;
                try { Lampa.Timeline.update(view); } catch (e) {}
                renderItems();
              } else if (action.action === 'lampa') {
                try { Lampa.Player.runas('lampa'); } catch (e) {}
                launch(details.is_series ? media : voice, voice);
              } else if (action.action === 'diag') {
                showDiagnostics();
              }

              if (enabled && action.action !== 'diag') {
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
        });

        if (!continueTarget && percent > 0 && percent < threshold) {
          continueTarget = item[0];
        }

        scroll.append(item);
      });

      self.activity.loader(false);

      if (continueTarget && boolValue(STORAGE.focusContinue, true)) {
        last = continueTarget;
        self.start(false);
        setTimeout(function () {
          try { scroll.update($(continueTarget), true); } catch (e) {}
        }, 80);
      } else {
        self.start(true);
      }
    }

    function finishDetails() {
      choice = { voice: 0, season: 0 };
      restoreChoice();

      var voice = currentVoice();

      if (details.is_series && voice) {
        self.activity.loader(true);
        fetchEpisodes(details, voice)
          .then(function () {
            restoreChoice();
            renderFilter();
            renderItems();
          })
          .catch(function (error) {
            self.empty(error.message);
          });
      } else {
        renderFilter();
        renderItems();
      }
    }

    function selectCandidate(rows) {
      if (!rows || !rows.length) {
        self.empty('HDREZKA: по этому названию ничего не найдено');
        return;
      }

      var best = rows[0];
      var second = rows[1];

      if (
        rows.length === 1 ||
        (
          best.score >= 96 &&
          (!second || best.score - second.score >= 8)
        )
      ) {
        selectedLink = best.link;
        self.activity.loader(true);

        fetchPage(best.link)
          .then(function (parsed) {
            details = parsed;
            finishDetails();
          })
          .catch(function (error) {
            self.empty(error.message);
          });
        return;
      }

      var select = rows.slice(0, 12).map(function (row) {
        return {
          title: row.title + (row.year ? ' (' + row.year + ')' : ''),
          subtitle: row.orig_title || ('Совпадение: ' + row.score),
          row: row
        };
      });

      self.activity.loader(false);

      Lampa.Select.show({
        title: 'Выберите фильм HDRezka',
        items: select,
        onSelect: function (item) {
          selectedLink = item.row.link;
          self.activity.loader(true);

          fetchPage(item.row.link)
            .then(function (parsed) {
              details = parsed;
              finishDetails();
            })
            .catch(function (error) {
              self.empty(error.message);
            });
        }
      });
    }

    function startSearch(manual) {
      self.activity.loader(true);
      self.reset();

      resolveMovie(object.movie || {}, manual || object.search || '')
        .then(selectCandidate)
        .catch(function (error) {
          self.empty(error.message);
        });
    }

    this.create = function () {
      currentActivity = this.activity;

      filter.onSearch = function (value) {
        startSearch(value);
      };

      filter.onBack = function () {
        self.start();
      };

      filter.onSelect = function (type, a, b) {
        if (type !== 'filter') return;

        if (a.reset) {
          choice.voice = 0;
          choice.season = 0;
          persistChoice();
          if (details && details.is_series) {
            self.activity.loader(true);
            fetchEpisodes(details, currentVoice())
              .then(function () {
                renderFilter();
                renderItems();
              })
              .catch(function (error) {
                self.empty(error.message);
              });
          } else {
            renderFilter();
            renderItems();
          }
          return;
        }

        if (a.stype === 'voice') {
          choice.voice = b.index;
          choice.season = 0;
          persistChoice();

          if (details && details.is_series) {
            self.activity.loader(true);
            fetchEpisodes(details, currentVoice())
              .then(function () {
                restoreChoice();
                renderFilter();
                renderItems();
              })
              .catch(function (error) {
                self.empty(error.message);
              });
          } else {
            renderFilter();
            renderItems();
          }
          return;
        }

        if (a.stype === 'season') {
          choice.season = b.index;
          persistChoice();
          renderFilter();
          renderItems();
        }
      };

      files.appendHead(brand);
      files.appendHead(filter.render());
      files.appendFiles(scroll.render());

      startSearch('');
      return this.render();
    };

    this.reset = function () {
      scroll.render().find('.empty').remove();
      scroll.clear();
      scroll.reset();
    };

    this.empty = function (message) {
      var empty = Lampa.Template.get('list_empty');
      if (message) empty.find('.empty__descr').text(message);
      scroll.append(empty);
      self.activity.loader(false);
      self.start(true);
    };

    this.start = function (firstSelect) {
      if (!Lampa.Activity.active() || Lampa.Activity.active().activity !== self.activity) return;

      if (firstSelect) {
        last = scroll.render().find('.selector').eq(0)[0];
      }

      try {
        Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
      } catch (e) {}

      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up');
          else Lampa.Controller.toggle('head');
        },
        down: function () {
          Navigator.move('down');
        },
        right: function () {
          if (Navigator.canmove('right')) Navigator.move('right');
          else filter.show('Фильтр', 'filter');
        },
        left: function () {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        back: self.back
      });

      Lampa.Controller.toggle('content');
    };

    this.render = function () {
      return files.render();
    };

    this.back = function () {
      Lampa.Activity.backward();
    };

    this.pause = function () {};
    this.stop = function () {};

    this.destroy = function () {
      try { files.destroy(); } catch (e) {}
      try { scroll.destroy(); } catch (e) {}
      try { if (currentNetwork) currentNetwork.clear(); } catch (e) {}
    };
  }

  function addTemplates() {
    try {
      Lampa.Template.add(
        'hdrezka_denys_item',
        '<div class="online selector">' +
          '<div class="online__body">' +
            '<div class="online__title">{title}</div>' +
            '<div class="online__quality">{quality}{info}</div>' +
          '</div>' +
        '</div>'
      );
    } catch (e) {}
  }

  function addStyle() {
    if ($('#hdrezka-denys-style').length) return;

    var css =
      '<style id="hdrezka-denys-style">' +
        '.hdrezka-denys-brand{' +
          'display:flex;align-items:center;gap:.7em;padding:.65em 1em;margin:0 0 .65em 0;' +
          'border:1px solid rgba(255,255,255,.16);border-radius:.65em;background:rgba(0,0,0,.14);' +
        '}' +
        '.hdrezka-denys-brand__logo{font-size:1.05em;font-weight:700;letter-spacing:.04em;}' +
        '.hdrezka-denys-brand__edition{opacity:.72;font-size:.86em;}' +
        '.hdrezka-denys-brand__status{margin-left:auto;opacity:.78;font-size:.82em;white-space:nowrap;}' +
        '.view--hdrezka-premium span:after{content:" • DENYS";opacity:.58;font-size:.72em;}' +
        '.view--hdrezka-account span{font-size:.82em;font-weight:700;}' +
        '.hdrezka-diag{line-height:1.7;font-size:.95em;}' +
      '</style>';

    $('head').append(css);
  }

  function addSettings() {
    if (!Lampa.SettingsApi) return;

    try {
      Lampa.SettingsApi.addComponent({
        component: SETTINGS,
        name: 'HDREZKA Premium • by DENYS',
        icon:
          '<svg width="24" height="24" viewBox="0 0 24 24">' +
          '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
          '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/>' +
          '</svg>'
      });
    } catch (e) {}

    function param(name, type, values, def, title, description, onChange) {
      var data = {
        component: SETTINGS,
        param: {
          name: name,
          type: type,
          default: def
        },
        field: {
          name: title,
          description: description || ''
        }
      };

      if (typeof values !== 'undefined') data.param.values = values;
      if (onChange) data.onChange = onChange;

      try { Lampa.SettingsApi.addParam(data); } catch (e) {}
    }

    param(
      'hdrezka_denys_account',
      'button',
      undefined,
      '',
      '🔐 Подключить / проверить HDRezka',
      'Вход, импорт сессии Online Mod, проверка и выход.',
      openAccountMenu
    );

    param(
      STORAGE.login,
      'input',
      '',
      '',
      'Логин / E-mail HDRezka',
      'Нужен только для входа. Можно импортировать готовую сессию Online Mod.'
    );

    param(
      STORAGE.password,
      'input',
      '',
      '',
      'Пароль HDRezka',
      'После успешного входа пароль автоматически очищается.'
    );

    param(
      STORAGE.cookie,
      'input',
      '',
      '',
      'Cookie HDRezka • расширенно',
      'Можно вставить вручную. Если поле заполнено, плагин использует эту cookie.'
    );

    param(
      STORAGE.proxyMode,
      'select',
      {
        'auto': 'Авто — TV через proxy, ПК напрямую',
        'always': 'Всегда через proxy',
        'never': 'Никогда не использовать proxy'
      },
      'auto',
      'Сетевой режим',
      'VIDAA/MSX: режим Авто использует совместимый CORS-proxy по той же схеме, что Online Mod.'
    );

    param(
      STORAGE.mirror,
      'input',
      '',
      '',
      'Зеркало HDRezka',
      'Пусто = авто. Прямой режим: kvk.zone. Proxy-режим: rezka.ag.'
    );

    param(
      STORAGE.customProxy,
      'input',
      '',
      '',
      'Свой CORS-proxy • расширенно',
      'Пусто = proxy-узлы, используемые текущим Online Mod.'
    );

    param(
      STORAGE.syncOnlineMod,
      'select',
      { '1': 'Да', '0': 'Нет' },
      '1',
      'Синхронизировать с Online Mod',
      'Импортирует/обновляет HDRezka cookie Online Mod на этом устройстве.'
    );

    param(
      'hdrezka_denys_import_online',
      'button',
      undefined,
      '',
      '⚡ Импортировать сессию Online Mod',
      'Если HDRezka уже авторизована в Online Mod.',
      function () { importOnlineModSession(false); }
    );

    param(
      STORAGE.quality,
      'select',
      {
        'max': 'Максимальное',
        '2160': 'До 2160p',
        '1080': 'До 1080p',
        '720': 'До 720p',
        '480': 'До 480p'
      },
      'max',
      'Качество по умолчанию',
      'В плеер всё равно передаётся полный список качеств.'
    );

    param(
      STORAGE.format,
      'select',
      {
        'hls': 'HLS — рекомендуется для TV',
        'mp4': 'MP4',
        'auto': 'Авто'
      },
      'hls',
      'Формат потока',
      'Для VIDAA обычно стабильнее HLS.'
    );

    param(
      STORAGE.streamMode,
      'select',
      {
        'off': 'Без подмены CDN',
        'fix': 'Fallback CDN',
        'ukr': 'Украинский stream-proxy'
      },
      'off',
      'Проксирование видеопотока',
      'Нужно только если сам поток не запускается.'
    );

    param(
      STORAGE.streamProxy,
      'select',
      {
        'prx.ukrtelcdn.net': 'prx.ukrtelcdn.net',
        'prx-cogent.ukrtelcdn.net': 'prx-cogent.ukrtelcdn.net',
        'prx2-cogent.ukrtelcdn.net': 'prx2-cogent.ukrtelcdn.net',
        'prx3-cogent.ukrtelcdn.net': 'prx3-cogent.ukrtelcdn.net',
        'prx-ams.ukrtelcdn.net': 'prx-ams.ukrtelcdn.net',
        'prx2-ams.ukrtelcdn.net': 'prx2-ams.ukrtelcdn.net'
      },
      'prx.ukrtelcdn.net',
      'Stream-proxy HDRezka',
      'Используется только при режиме «Украинский stream-proxy».'
    );

    param(
      STORAGE.playerMode,
      'select',
      {
        'lampa': 'Встроенный Lampa — рекомендуется',
        'system': 'Как в общей настройке Lampa'
      },
      'lampa',
      'Плеер HDREZKA',
      'Встроенный Lampa нужен для Timeline, продолжения и NEXT/PREV.'
    );

    param(
      STORAGE.resumeMode,
      'select',
      {
        'continue': 'Автоматически продолжать',
        'ask': 'Спрашивать',
        'again': 'Всегда сначала'
      },
      'continue',
      'Продолжение просмотра',
      'Используется родной Lampa Timeline, без самодельного таймера.'
    );

    param(
      STORAGE.autoNext,
      'select',
      { '1': 'Да', '0': 'Нет' },
      '1',
      'Авто следующая серия',
      'Родной playlist Lampa.'
    );

    param(
      STORAGE.rememberVoice,
      'select',
      { '1': 'Да', '0': 'Нет' },
      '1',
      'Запоминать озвучку',
      'Отдельно для каждого фильма/сериала.'
    );

    param(
      STORAGE.rememberSeason,
      'select',
      { '1': 'Да', '0': 'Нет' },
      '1',
      'Запоминать сезон',
      'Возвращает к последнему выбранному сезону.'
    );

    param(
      STORAGE.focusContinue,
      'select',
      { '1': 'Да', '0': 'Нет' },
      '1',
      'Фокус на недосмотренной серии',
      'Использует реальный процент Lampa Timeline.'
    );

    param(
      STORAGE.watchedAt,
      'select',
      { '85': '85%', '90': '90%', '95': '95%', '98': '98%' },
      '95',
      'Считать просмотренным после',
      'После этого процента показывается отметка просмотренного.'
    );

    param(
      'hdrezka_denys_check_account',
      'button',
      undefined,
      '',
      '✅ Проверить аккаунт',
      'Проверяет текущую cookie/session.',
      function () {
        notice('HDREZKA: проверяем аккаунт…');
        checkAccount()
          .then(function () { notice('✅ Сессия активна'); })
          .catch(function (error) { notice('❌ ' + error.message); });
      }
    );

    param(
      'hdrezka_denys_diag',
      'button',
      undefined,
      '',
      '🧪 Диагностика',
      'Платформа, host, proxy, cookie, маршрут.',
      showDiagnostics
    );

    param(
      STORAGE.debug,
      'select',
      { '0': 'Нет', '1': 'Да' },
      '0',
      'Debug в консоль',
      'Для диагностики запросов.'
    );

    param(
      'hdrezka_denys_author',
      'select',
      { 'denys': 'DENYS EDITION • v' + VERSION },
      'denys',
      'Автор',
      'HDREZKA Premium for Lampa • by DENYS'
    );
  }

  function loadRezka(movie) {
    if (!movie) {
      notice('HDREZKA: карточка фильма не найдена');
      return;
    }

    if (!accountConnected()) {
      if (importOnlineModSession(true)) {
        notice('HDREZKA: использована сессия Online Mod');
      } else {
        notice('HDREZKA: сначала подключите аккаунт');
        openAccountMenu();
        return;
      }
    }

    Lampa.Activity.push({
      url: '',
      title: 'HDREZKA Premium • by DENYS',
      component: COMPONENT,
      movie: movie,
      page: 1
    });
  }

  function addMainButton() {
    Lampa.Listener.follow('full', function (e) {
      if (!e || e.type !== 'complite' || !e.object || !e.object.activity) return;

      var root = e.object.activity.render();
      root.find('.view--hdrezka-premium, .view--hdrezka-account').remove();

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
        'data-subtitle="' + (accountConnected() ? 'HDRezka Premium подключена' : 'Подключить аккаунт HDRezka') + '">' +
          '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="64" cy="43" r="21" stroke="currentColor" stroke-width="10"/>' +
            '<path d="M28 105c5-23 18-35 36-35s31 12 36 35" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>' +
          '</svg>' +
          '<span>' + (accountConnected() ? 'REZKA ✓' : 'ВОЙТИ') + '</span>' +
        '</div>'
      );

      play.on('hover:enter', function () {
        loadRezka(movie);
      });

      account.on('hover:enter', function () {
        openAccountMenu();
      });

      function insertAfter(target) {
        if (!target || !target.length) return false;
        target.after(play);
        play.after(account);
        updateAccountButtons();
        return true;
      }

      if (insertAfter(root.find('.view--torrent'))) return;
      if (insertAfter(root.find('.view--online_mod'))) return;

      var buttons = root.find('.full-start__buttons');
      if (!buttons.length) buttons = root.find('.full-start-new__buttons');

      if (buttons.length) {
        buttons.append(play);
        buttons.append(account);
        updateAccountButtons();
      }
    });
  }

  function registerManifest() {
    try {
      if (Lampa.Manifest) {
        Lampa.Manifest.plugins = Lampa.Manifest.plugins || {};
        Lampa.Manifest.plugins.hdrezka_denys = {
          name: 'HDREZKA Premium • by DENYS',
          version: VERSION,
          description: 'Premium HDRezka • Online Mod compatible proxy • native Timeline/Playlist'
        };
      }
    } catch (e) {}
  }

  function init() {
    try {
      importOnlineModSession(true);
      addStyle();
      addTemplates();
      addSettings();
      addPlayerListeners();

      Lampa.Component.add(COMPONENT, component);
      addMainButton();
      registerManifest();
      updateAccountButtons();

      console.log('HDREZKA Premium • by DENYS v' + VERSION + ' loaded');
    } catch (e) {
      console.error('HDREZKA DENYS init error', e);
      notice('HDREZKA: ошибка запуска плагина');
    }
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
