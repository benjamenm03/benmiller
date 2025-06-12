function initNavigation() {
    var header = document.querySelector('.header');

    // Create a sentinel element to observe scroll position
    var sentinel = document.createElement('div');
    sentinel.id = 'nav-sentinel';
    document.body.insertBefore(sentinel, header);

    var observer = new IntersectionObserver(function(entries) {
        if (window.innerWidth <= 600) {
            header.classList.remove('shrink');
            return;
        }
        if (entries[0].isIntersecting) {
            header.classList.remove('shrink');
        } else {
            header.classList.add('shrink');
        }
    }, { rootMargin: '-50px 0px 0px 0px', threshold: 0 });
    observer.observe(sentinel);

    window.addEventListener('resize', function() {
        if (window.innerWidth <= 600) {
            header.classList.remove('shrink');
        }
    });

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
