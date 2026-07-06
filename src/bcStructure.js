/* bcStructure.js — reshapes the sidebar layout into a Business Central–style
   top-navigation structure at load, without touching the underlying nav wiring.
   Every .nav-item keeps its data-view and click behaviour; we only move the DOM.
   Toggle with APP_CONFIG.bcStructure (default on for this build). */
(function () {
  function build() {
    if (window.APP_CONFIG && window.APP_CONFIG.bcStructure === false) return;
    const header = document.querySelector('.app-header');
    const sidebar = document.querySelector('.app-sidebar');
    if (!header || !sidebar) return;
    document.body.classList.add('bc-struct');

    // --- Row 1: navy app bar = existing header contents, restyled via .bc-appbar ---
    header.classList.add('bc-appbar-host');
    const appbar = document.createElement('div');
    appbar.className = 'bc-appbar';
    // move brand, breadcrumb, right cluster into the appbar row
    ['.brand', '.breadcrumb', '.right'].forEach(sel => {
      const el = header.querySelector(':scope > ' + sel);
      if (el) appbar.appendChild(el);
    });

    // --- Row 2: horizontal menu bar built from sidebar sections ---
    const menubar = document.createElement('div');
    menubar.className = 'bc-menubar';

    // Each .nav-section becomes a .bc-nav-group (button + dropdown menu).
    sidebar.querySelectorAll(':scope > .nav-section').forEach(section => {
      const title = section.querySelector(':scope > .nav-section-title');
      if (!title) return;
      const group = document.createElement('div');
      group.className = 'bc-nav-group';
      const btn = document.createElement('button');
      btn.className = 'bc-nav-btn';
      btn.textContent = title.textContent.trim();
      const menu = document.createElement('div');
      menu.className = 'bc-nav-menu';
      // move all nav items/labels (everything except the title) into the menu
      [...section.children].forEach(child => {
        if (child === title) return;
        menu.appendChild(child);
      });
      group.appendChild(btn);
      group.appendChild(menu);
      menubar.appendChild(group);
      // clicking a menu item should close the dropdown (blur) — items already navigate
      menu.querySelectorAll('.nav-item[data-view]').forEach(it => {
        it.addEventListener('click', () => { menu.style.display = 'none'; setTimeout(() => menu.style.display = '', 200); });
      });
    });

    // Move the entity switcher to the right of the menu bar
    const entitySwitcher = sidebar.querySelector(':scope > .entity-switcher');
    if (entitySwitcher) menubar.appendChild(entitySwitcher);

    // Assemble: header now holds [appbar, menubar]; drop the old sidebar
    header.innerHTML = '';
    header.appendChild(appbar);
    header.appendChild(menubar);
    sidebar.classList.add('app-sidebar-original'); // hidden via CSS

    // Reflect active view in the top-level buttons (highlight the group holding active item)
    const markActive = () => {
      menubar.querySelectorAll('.bc-nav-group').forEach(g => {
        const btn = g.querySelector('.bc-nav-btn');
        const hasActive = !!g.querySelector('.nav-item.active');
        if (btn) btn.classList.toggle('has-active', hasActive);
      });
    };
    markActive();
    // Ensure the department line is correct after the brand block moved into the app bar.
    if (typeof window.updateBrandDepartment === 'function') window.updateBrandDepartment();
    // Now that the BC groups exist, apply role-based visibility so empty groups are hidden.
    if (typeof window.__applyNavVisibility === 'function') window.__applyNavVisibility();
    // re-mark whenever navigation changes the active class
    const obs = new MutationObserver(markActive);
    menubar.querySelectorAll('.nav-item[data-view]').forEach(it =>
      obs.observe(it, { attributes: true, attributeFilter: ['class'] }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(build, 0));
  } else {
    setTimeout(build, 0);
  }
})();
