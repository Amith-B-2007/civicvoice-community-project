// Map helpers shared by the submit form, the suggestion page, the map page and the admin panel.
// Maps are drawn with Leaflet (in /vendor) on OpenStreetMap tiles.
(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';

  // A teardrop pin whose colour comes from CSS (.pin-<status>), so it follows the status colours.
  function pinIcon(status) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 30 40');
    svg.setAttribute('width', '30');
    svg.setAttribute('height', '40');
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS(SVG, 'path');
    body.setAttribute('class', 'pin-body');
    body.setAttribute('d', 'M15 1C7.3 1 1 7.2 1 14.9c0 9.6 12.3 22.8 13.2 23.7a1.1 1.1 0 0 0 1.6 0C16.7 37.7 29 24.5 29 14.9 29 7.2 22.7 1 15 1z');
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('class', 'pin-dot');
    dot.setAttribute('cx', '15');
    dot.setAttribute('cy', '15');
    dot.setAttribute('r', '5.5');
    svg.append(body, dot);
    return L.divIcon({
      className: `map-pin pin-${status || 'new'}`,
      html: svg,
      iconSize: [30, 40],
      iconAnchor: [15, 39],
      popupAnchor: [0, -36],
    });
  }

  SB.maps = {
    pinIcon,

    // options: center [lat, lng], zoom, wheel (false keeps page scrolling smooth on embedded maps)
    create(container, meta, options = {}) {
      const map = L.map(container, { scrollWheelZoom: options.wheel !== false })
        .setView(options.center || meta.map.center, options.zoom || meta.map.zoom);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(map);
      map.attributionControl.setPrefix(false);
      return map;
    },

    coords: (lat, lng) => `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`,
    placeLink: (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    directionsLink: (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  };
})();
