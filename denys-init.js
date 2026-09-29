(function () {
  'use strict';

  if (window.hdrezka_denys_bootstrap_v802) return;
  window.hdrezka_denys_bootstrap_v802 = true;

  var tries = 0;

  function boot() {
    tries++;

    if (
      window.Lampa &&
      Lampa.Listener &&
      Lampa.Component &&
      Lampa.Storage
    ) {
      if (
        !document.getElementById(
          'hdrezka-denys-v802-script'
        )
      ) {
        var script =
          document.createElement(
            'script'
          );

        script.id =
          'hdrezka-denys-v802-script';

        script.type =
          'text/javascript';

        script.src =
          '/plugin.js?v=802';

        script.onerror =
          function () {
            try {
              Lampa.Noty.show(
                'HDREZKA DENYS: plugin.js не загрузился'
              );
            }
            catch (e) {}
          };

        document.body.appendChild(
          script
        );
      }

      return;
    }

    if (tries < 300) {
      setTimeout(
        boot,
        100
      );
    }
  }

  boot();
})();