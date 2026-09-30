/*
  A3GK site behaviour: scroll reveals and a light hero parallax.
  Both respect prefers-reduced-motion and are no-ops in the theme editor.
*/
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const designMode = window.Shopify && window.Shopify.designMode;

  function initReveals(root = document) {
    const items = root.querySelectorAll('.a3-reveal:not(.is-in)');
    if (!items.length) return;

    if (reduceMotion || designMode || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
    );

    items.forEach((el) => io.observe(el));
  }

  function initParallax() {
    if (reduceMotion || designMode) return;
    const layers = document.querySelectorAll('[data-a3-parallax]');
    if (!layers.length) return;

    let ticking = false;
    const update = () => {
      layers.forEach((layer) => {
        const rect = layer.parentElement.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const strength = parseFloat(layer.dataset.a3Parallax) || 0.15;
        layer.style.transform = `translate3d(0, ${(-rect.top * strength).toFixed(1)}px, 0) scale(1.08)`;
      });
      ticking = false;
    };

    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      { passive: true }
    );
    update();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initReveals();
    initParallax();
  });

  // Theme editor: re-run when sections are added or re-rendered.
  document.addEventListener('shopify:section:load', (event) => initReveals(event.target));
})();
