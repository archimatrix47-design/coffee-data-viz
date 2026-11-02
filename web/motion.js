/* Reveal-on-scroll, and nothing else.
 *
 * The kit's ambient.js is the fuller runtime, but it pulls Anime.js from a CDN and
 * this project is deliberately offline-capable, every other library here is bundled
 * locally. The only primitive these pages actually need is the fade-in-blur entrance
 * on the breakdown grid, which is ~20 lines of IntersectionObserver. Adding a CDN
 * dependency to get it would trade the offline guarantee for nothing.
 *
 * Constants match the kit's fade-in-blur preset: opacity 0→1, y 14→0, blur 8→0,
 * decelerate-only easing, 0.06s stagger, fired once at 15% visibility.
 */

(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function reveal(root = document) {
    const items = [...root.querySelectorAll('[data-reveal]:not(.is-in)')];
    if (!items.length) return;

    if (reduced.matches) {          // no observer at all, just show it
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      // Stagger within one batch only, so a long grid does not accumulate a
      // second of delay by the time it reaches the bottom row.
      let i = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        el.style.transitionDelay = `${Math.min(i++, 8) * 60}ms`;
        el.classList.add('is-in');
        obs.unobserve(el);
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });

    // Anything already on screen at load appears immediately, never animate
    // what the reader is already looking at.
    const fold = innerHeight;
    for (const el of items) {
      if (el.getBoundingClientRect().top < fold) el.classList.add('is-in');
      else io.observe(el);
    }

    // Content must not depend on an animation firing.
    //
    // Scroll fast enough and the observer does not keep up: scrolling a 36-card grid end to
    // end in one gesture left nine cards still at opacity 0, permanently, because they were
    // never reported as intersecting and the page had already moved past them. The entrance is
    // a nicety; the dial is the product. Anything still hidden after this gets shown outright,
    // and the sweep repeats while there is anything left to show.
    let sweeps = 0;
    const sweep = () => {
      const left = items.filter((el) => !el.classList.contains('is-in'));
      for (const el of left) {
        if (el.getBoundingClientRect().top < innerHeight * 1.5) {
          el.style.transitionDelay = '0ms';
          el.classList.add('is-in');
          io.unobserve(el);
        }
      }
      if (items.some((el) => !el.classList.contains('is-in')) && ++sweeps < 40) {
        setTimeout(sweep, 400);
      }
    };
    setTimeout(sweep, 600);
    // A reader who leaves and comes back should not find holes either.
    addEventListener('pageshow', () => setTimeout(sweep, 50));
  }

  window.revealIn = reveal;
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => reveal());
  else reveal();
})();
