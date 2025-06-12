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

document.addEventListener('DOMContentLoaded', initNavigation);
