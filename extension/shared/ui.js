// Small shared UI pieces: the logo mark and header icons.
(() => {
  const CC = (globalThis.CC = globalThis.CC || {});

  // Three chord "lanes" crossed by a playhead.
  const logo = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="#f5a524"/>
    <rect x="4.5" y="6" width="9" height="3" rx="1.5" fill="#1d1400"/>
    <rect x="9" y="10.5" width="10.5" height="3" rx="1.5" fill="#1d1400" opacity=".75"/>
    <rect x="4.5" y="15" width="6" height="3" rx="1.5" fill="#1d1400" opacity=".5"/>
    <rect x="11.4" y="3.5" width="1.6" height="17" rx=".8" fill="#fff"/>
  </svg>`;

  const ICONS = {
    gear: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  CC.ui = { logo, icon };
})();
