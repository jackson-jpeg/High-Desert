/**
 * The inline boot script for the root layout: text scale before first paint,
 * the #app-loading boot screen, and its dismissal.
 *
 * It is a string, not a function, because it runs before React — inlined as a
 * <script> in src/app/layout.tsx. It lives in its own module so the dismissal
 * can be tested by executing exactly this string (boot-script.test.ts).
 */
export const BOOT_SCRIPT = `
  (function() {
    // Storage can throw (blocked, quota). Every access goes through these:
    // an exception here would abort this whole function before the dismissal
    // below is installed, leaving the boot screen over the app for good.
    function readStore(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function writeStore(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    // Text scale: sync read before first paint
    var scale = readStore('hd-text-scale');
    if (scale) {
      document.documentElement.style.setProperty('--hd-text-scale', scale);
    }

    // Anyone who has asked for less motion gets no boot theatre.
    var reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var isFirstVisit = !readStore('hd-booted') && !reduceMotion;
    var bootContainer = document.getElementById('boot-container');
    var quickSplash = document.getElementById('quick-splash');

    if (isFirstVisit && bootContainer) {
      bootContainer.style.display = 'flex';
      var lines = bootContainer.querySelectorAll('[data-boot]');
      var delay = 0;
      for (var i = 0; i < lines.length; i++) {
        (function(el, d) {
          setTimeout(function() { el.classList.add('visible'); }, d);
        })(lines[i], delay);
        delay += (i === lines.length - 1) ? 400 : 220;
      }
    } else if (quickSplash) {
      quickSplash.style.display = 'block';
    }
    writeStore('hd-booted', '1');

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      var el = document.getElementById('app-loading');
      if (!el) return;
      // Stop intercepting input the moment the fade starts. It is
      // only display:none 400ms later, and until then a tap on what
      // is already visibly the page landed on this overlay and
      // was lost.
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
      setTimeout(function() { if (el) el.style.display = 'none'; }, 400);
    }

    // Any deliberate input skips the boot sequence. It is a 2.8s
    // hard floor otherwise, and nobody should have to sit through
    // it twice.
    ['pointerdown', 'keydown', 'touchstart'].forEach(function(evt) {
      window.addEventListener(evt, dismiss, { once: true, passive: true });
    });

    // Hide loading screen once React hydrates
    var observer = new MutationObserver(function() {
      if (!document.querySelector('[data-hydrated]')) return;
      observer.disconnect();
      var minDelay = isFirstVisit ? 2800 : 0;
      var remaining = Math.max(0, minDelay - performance.now());
      setTimeout(dismiss, remaining);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(dismiss, 6000);
  })();
`;
