function initNavigation() {
    var header = document.querySelector('.header');

    var lastKnownScrollY = 0;
    var ticking = false;

    function update() {
        ticking = false;
        if (window.innerWidth <= 600) {
            header.classList.remove('shrink');
            return;
        }
        if (lastKnownScrollY > 50) {
            header.classList.add('shrink');
        } else {
            header.classList.remove('shrink');
        }
    }

    function requestTick() {
        if (!ticking) {
            window.requestAnimationFrame(update);
            ticking = true;
        }
    }

    function onScroll() {
        lastKnownScrollY = window.pageYOffset;
        requestTick();
    }

    onScroll();
    window.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onScroll);

    document.querySelectorAll('.dropdown > button').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            var menu = this.nextElementSibling;
            if (menu) {
                menu.classList.toggle('show');
            }
        });
    });

    document.addEventListener('click', function(e) {
        document.querySelectorAll('.dropdown-content.show').forEach(function(menu) {
            if (!menu.parentElement.contains(e.target)) {
                menu.classList.remove('show');
            }
        });
    });
}

function initSoilMoistureDropdowns(configs) {
    configs.forEach(function(cfg) {
        var select = document.getElementById(cfg.selectId);
        var display = document.getElementById(cfg.displayId);
        if (!select || !display) return;

        function updateDisplay(v) {
            display.textContent = v;
        }

        var readUrl = 'https://api.thingspeak.com/channels/' + cfg.channelId + '/fields/5/last.json';
        if (cfg.readKey) {
            readUrl += '?api_key=' + cfg.readKey;
        }

        fetch(readUrl)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.field5) {
                    select.value = data.field5;
                    updateDisplay(data.field5);
                }
            })
            .catch(function() { /* ignore errors */ });

        select.addEventListener('change', function() {
            var value = this.value;
            var writeUrl = 'https://api.thingspeak.com/update?api_key=' + cfg.writeKey + '&field5=' + value;
            fetch(writeUrl, { method: 'POST' })
                .then(function() { updateDisplay(value); })
                .catch(function() { /* ignore errors */ });
        });
    });
}

document.addEventListener('DOMContentLoaded', function() {
    initNavigation();
    if (window.soilNodeConfigs) {
        initSoilMoistureDropdowns(window.soilNodeConfigs);
    }
});
