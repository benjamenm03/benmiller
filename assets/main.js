function initNavigation() {
    var header = document.querySelector('.header');
    window.addEventListener('scroll', function() {
        if (window.innerWidth > 600) {
            if (window.scrollY > 50) {
                header.classList.add('shrink');
            } else {
                header.classList.remove('shrink');
            }
        } else {
            header.classList.remove('shrink');
        }
    });

    window.addEventListener('resize', function() {
        if (window.innerWidth <= 600) {
            header.classList.remove('shrink');
        } else if (window.scrollY > 50) {
            header.classList.add('shrink');
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
