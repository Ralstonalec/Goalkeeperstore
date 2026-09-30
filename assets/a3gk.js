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

  // Builder teaser: the kit render cycles through colourways.
  function initKitCycle(root = document) {
    const palettes = [
      ['#121310', '#3be37f', '#eeebe3'],
      ['#ff6a13', '#121310', '#eeebe3'],
      ['#2f55d4', '#d7ff3a', '#eeebe3'],
      ['#ff4fa3', '#14213d', '#eeebe3'],
      ['#d7ff3a', '#121310', '#121310'],
    ];
    root.querySelectorAll('[data-a3-kitcycle]').forEach((el) => {
      if (el.dataset.a3Cycling) return;
      el.dataset.a3Cycling = '1';
      const dots = el.querySelectorAll('.a3-kitcycle__swatches span');
      let i = 0;
      const apply = () => {
        const [k1, k2, k3] = palettes[i];
        el.style.setProperty('--k1', k1);
        el.style.setProperty('--k2', k2);
        el.style.setProperty('--k3', k3);
        dots.forEach((d, j) => d.classList.toggle('is-on', j === i));
      };
      apply();
      if (reduceMotion || designMode) return;
      setInterval(() => {
        if (document.hidden) return;
        i = (i + 1) % palettes.length;
        apply();
      }, 2600);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initReveals();
    initParallax();
    initKitCycle();
  });

  // Theme editor: re-run when sections are added or re-rendered.
  document.addEventListener('shopify:section:load', (event) => {
    initReveals(event.target);
    initKitCycle(event.target);
  });
})();
