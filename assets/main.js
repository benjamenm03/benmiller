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
                var expanded = menu.classList.toggle('show');
                this.setAttribute('aria-expanded', expanded);
            }
        });
    });

    document.addEventListener('click', function(e) {
        document.querySelectorAll('.dropdown-content.show').forEach(function(menu) {
            if (!menu.parentElement.contains(e.target)) {
                menu.classList.remove('show');
                var btn = menu.previousElementSibling;
                if (btn) {
                    btn.setAttribute('aria-expanded', 'false');
                }
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initNavigation);

// Auto-refresh ThingSpeak MATLAB Visualization iframes every 5 minutes
(function autoRefreshNetworkPlots() {
  const ids = ["moisturePlot", "tempPlot"];
  function bust(url) {
    const base = url.split("?")[0];
    return base + "?t=" + Date.now(); // cache-buster so ThingSpeak re-renders
  }
  function refreshVisible() {
    ids.forEach(id => {
      const f = document.getElementById(id);
      if (!f) return;
      // Only refresh if visible on the page (cheap visibility check)
      if (f.offsetParent !== null) {
        const base = f.dataset.base || f.src;
        f.dataset.base = base;
        f.src = bust(base);
      }
    });
  }
  // Initial bust once the page loads
  window.addEventListener("load", refreshVisible);
  // Refresh every 5 minutes
  setInterval(refreshVisible, 5 * 60 * 1000);
})();
