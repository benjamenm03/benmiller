function initNavigation() {
    var header = document.querySelector('.header');

    function handleScroll() {
        if (window.innerWidth <= 600) {
            header.classList.remove('shrink');
            return;
        }
        if (window.pageYOffset > 50) {
            header.classList.add('shrink');
        } else {
            header.classList.remove('shrink');
        }
    }

    handleScroll();
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);

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
