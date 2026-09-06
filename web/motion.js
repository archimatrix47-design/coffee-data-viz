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
  }

  window.revealIn = reveal;
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => reveal());
  else reveal();
})();
