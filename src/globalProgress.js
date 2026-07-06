/* ============================================================
   GLOBAL PROGRESS BAR
   ============================================================
   A fixed, view-independent progress indicator for long operations
   (ERP import, demo data purge). It lives outside any rendered view, so it
   stays visible when the user switches tabs while the operation keeps running.

   API:
     window.PXProgress.start(label, { onStop })  -> show, reset to 0%
     window.PXProgress.update(done, total, detail)
     window.PXProgress.finish(message)           -> mark done, auto-hide
     window.PXProgress.hide()
   The underlying async operation is independent of any view; this only mirrors it. */
(function () {
  const el = () => document.getElementById('global-progress');
  const $ = id => document.getElementById(id);

  function start(label, opts = {}) {
    const box = el(); if (!box) return;
    box.classList.remove('done');
    box.style.display = 'block';
    $('gp-label').textContent = label || 'Working…';
    $('gp-count').textContent = '';
    $('gp-fill').style.width = '0%';
    const stop = $('gp-stop');
    if (opts.onStop) {
      stop.style.display = 'inline-block';
      stop.textContent = 'Stop';
      stop.onclick = () => { stop.textContent = 'Stopping…'; stop.disabled = true; try { opts.onStop(); } catch (e) {} };
      stop.disabled = false;
    } else {
      stop.style.display = 'none';
    }
  }

  function update(done, total, detail) {
    const box = el(); if (!box || box.style.display === 'none') return;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    $('gp-fill').style.width = pct + '%';
    $('gp-count').textContent = total ? `${done} / ${total}` + (detail ? ` · ${detail}` : '') : (detail || '');
  }

  function finish(message) {
    const box = el(); if (!box) return;
    box.classList.add('done');
    $('gp-fill').style.width = '100%';
    $('gp-stop').style.display = 'none';
    if (message) { $('gp-label').textContent = message; $('gp-count').textContent = ''; }
    setTimeout(() => { const b = el(); if (b) b.style.display = 'none'; }, 4000);
  }

  function hide() { const box = el(); if (box) box.style.display = 'none'; }

  window.PXProgress = { start, update, finish, hide };
})();
