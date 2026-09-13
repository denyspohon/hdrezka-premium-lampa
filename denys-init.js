(function () {
  'use strict';

  if (window.hdrezka_denys_bootstrap_v5) return;
  window.hdrezka_denys_bootstrap_v5 = true;

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
          'hdrezka-denys-v5-script'
        )
      ) {
        var script =
          document.createElement(
            'script'
          );

        script.id =
          'hdrezka-denys-v5-script';

        script.type =
          'text/javascript';

        script.src =
          '/plugin.js?v=50';

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