// Small shared UI pieces: the logo mark and header icons.
(() => {
  const CL = (globalThis.CL = globalThis.CL || {});

  // Three chord "lanes" crossed by a playhead.
  const logo = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="#f5a524"/>
    <rect x="4.5" y="6" width="9" height="3" rx="1.5" fill="#1d1400"/>
    <rect x="9" y="10.5" width="10.5" height="3" rx="1.5" fill="#1d1400" opacity=".75"/>
    <rect x="4.5" y="15" width="6" height="3" rx="1.5" fill="#1d1400" opacity=".5"/>
    <rect x="11.4" y="3.5" width="1.6" height="17" rx=".8" fill="#fff"/>
  </svg>`;

  const ICONS = {
    min: '<path d="M5 12h14" />',
    close: '<path d="M6 6l12 12M18 6L6 18" />',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  CL.ui = { logo, icon };
})();
