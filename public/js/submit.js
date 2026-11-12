(async function () {
  'use strict';
  const { el, api, t } = SB;

  const form = document.getElementById('submit-form');
  const fields = form.elements;
  const formError = document.getElementById('form-error');
  const button = document.getElementById('submit-button');
  const title = document.getElementById('title');
  const description = document.getElementById('description');
  const similarBox = document.getElementById('similar');
  const photoInput = document.getElementById('photo');
  const preview = document.getElementById('photo-preview');
  const anonymous = document.getElementById('anonymous');
  let photoData = null;

  let meta;
  try {
    meta = await SB.meta();
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
    return;
  }

  // The home page links straight to a type (?type=issue), so the form opens on the right choice.
  const params = new URLSearchParams(location.search);
  const startType = meta.typeById[params.get('type')] ? params.get('type') : meta.types[0].id;
  document.getElementById('type-options').replaceChildren(...meta.types.map((type) =>
    el('label', { class: 'segment' },
      el('input', { type: 'radio', name: 'type', value: type.id, checked: type.id === startType }),
      el('span', null, el('strong', null, type.label), el('small', null, t(`submit.kind.${type.id}`))))));
  SB.fillSelect(fields.category, meta.categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.label}` })), t('submit.categoryPh'));
  SB.fillSelect(fields.district, meta.districts.map((d) => ({ value: d.id, label: d.label })), t('submit.districtPh'));
  const preset = params.get('category');
  if (preset && meta.categoryById[preset]) fields.category.value = preset;

  // The page heading follows the chosen type: Report a problem / Suggest an idea / Give feedback.
  const showTitle = () => {
    const heading = t(`home.act.${fields.type.value}.t`);
    document.getElementById('submit-title').textContent = heading;
    document.title = `${heading} · ${meta.siteName}`;
  };
  form.addEventListener('change', (event) => {
    if (event.target.name === 'type') showTitle();
  });
  showTitle();

  const countChars = () => {
    document.getElementById('description-count').textContent = description.value.length;
  };
  description.addEventListener('input', countChars);

  anonymous.addEventListener('change', () => {
    document.getElementById('name-field').hidden = anonymous.checked;
  });

  // ---------- Similar suggestions while typing the title ----------

  title.addEventListener('input', SB.debounce(async () => {
    const query = title.value.trim();
    if (query.length < 8) {
      similarBox.hidden = true;
      return;
    }
    try {
      const { items } = await api(`/api/similar?q=${encodeURIComponent(query)}`);
      if (query !== title.value.trim()) return; // the user kept typing; a newer request is on its way
      similarBox.hidden = !items.length;
      similarBox.replaceChildren(
        el('p', { class: 'similar-title' }, t('submit.similar')),
        el('ul', null, items.map((item) => el('li', null,
          el('a', { href: SB.link(item.code), target: '_blank', rel: 'noopener' }, item.title),
          el('span', { class: 'similar-meta' }, ` ${SB.tn('count.supporter', item.votes)}`),
          ' ', SB.statusBadge(item.status, meta)))));
    } catch {
      similarBox.hidden = true; // the hint is optional; never block the form over it
    }
  }, 350));

  // ---------- Voice input: speak the details instead of typing ----------

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    const voiceButton = document.getElementById('voice-button');
    const voiceLabel = document.getElementById('voice-label');
    const voiceStatus = document.getElementById('voice-status');
    let recognition = null;
    voiceButton.hidden = false;

    function stopListening(message) {
      if (recognition) recognition.onend = null;
      if (recognition) recognition.stop();
      recognition = null;
      voiceButton.setAttribute('aria-pressed', 'false');
      voiceLabel.textContent = t('submit.voice');
      voiceStatus.textContent = message || '';
      voiceStatus.hidden = !message;
    }

    voiceButton.addEventListener('click', async () => {
      if (recognition) return stopListening();
      if (!window.isSecureContext) return stopListening(t('submit.voiceError'));

      // Explicitly request microphone access first so the browser shows the permission prompt
      // before SpeechRecognition starts its timeout timer.
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const track of stream.getTracks()) track.stop();
        } catch {
          return stopListening(t('submit.voiceError'));
        }
      }

      recognition = new Recognition();
      recognition.lang = SB.locale; // en-IN, kn-IN or hi-IN, following the chosen language
      recognition.continuous = true;
      recognition.interimResults = true;
      const before = description.value.trim();

      recognition.onresult = (event) => {
        let spoken = '';
        for (const result of event.results) spoken += result[0].transcript;
        description.value = [before, spoken.trim()].filter(Boolean).join(' ').slice(0, 2000);
        countChars();
      };
      recognition.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') stopListening(t('submit.voiceError'));
      };
      recognition.onend = () => stopListening();

      try {
        recognition.start();
        voiceButton.setAttribute('aria-pressed', 'true');
        voiceLabel.textContent = t('submit.voiceStop');
        voiceStatus.textContent = t('submit.voiceListening');
        voiceStatus.hidden = false;
      } catch {
        stopListening(t('submit.voiceError'));
      }
    });
  }

  // ---------- Exact location: GPS or tap, then drag the pin ----------

  const gpsButton = document.getElementById('gps-button');
  const pinRemove = document.getElementById('pin-remove');
  const pinStatus = document.getElementById('pin-status');
  const gpsStatus = document.getElementById('gps-status');
  const gpsMessage = (text) => {
    gpsStatus.textContent = text || '';
    gpsStatus.hidden = !text;
  };
  const map = SB.maps.create('pick-map', meta, { wheel: false });
  let marker = null;
  let accuracyCircle = null;
  let stopLocating = () => {};
  let autoAddress = '';
  let autoTown = '';
  let autoDistrict = '';

  // Choosing a district moves the map there, so the pin can be placed without scrolling across the state.
  fields.district.addEventListener('change', () => {
    const district = meta.districtById[fields.district.value];
    if (district && !marker) map.setView(district.center, 12);
  });

  // Matches an OpenStreetMap district name ("Mysore District", "Bangalore Urban") to one of ours.
  const simplify = (name) => String(name || '').toLowerCase().replace(/district|taluk/g, '').replace(/[^\p{L}\p{M}]/gu, '');
  function districtFrom(address) {
    const found = [address.state_district, address.county, address.city, address.town].filter(Boolean).map(simplify);
    return meta.districts.find((district) => district.names.some((name) => found.includes(simplify(name))));
  }

  // A field the resident typed in is never overwritten; one we filled earlier is kept up to date.
  const mayFill = (field, auto) => !field.value.trim() || field.value === auto;

  // Turns the pin into an address, town and district (OpenStreetMap) to save the resident typing.
  const lookupAddress = SB.debounce(async (lat, lng) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}&accept-language=${SB.lang}`;
      const place = await (await fetch(url)).json();
      if (!marker || !place.display_name) return;
      if (mayFill(fields.location, autoAddress)) {
        // The full OpenStreetMap address runs to district, state and country: the first parts are enough.
        autoAddress = place.display_name.split(', ').slice(0, 4).join(', ').slice(0, 200);
        fields.location.value = autoAddress;
      }
      const address = place.address || {};
      const town = address.city || address.town || address.village || address.suburb || '';
      if (town && mayFill(fields.town, autoTown)) {
        autoTown = town.slice(0, 80);
        fields.town.value = autoTown;
      }
      const district = districtFrom(address);
      if (district && mayFill(fields.district, autoDistrict)) {
        autoDistrict = district.id;
        fields.district.value = district.id;
      }
    } catch { /* no address is fine: the pin itself is the exact location */ }
  }, 700);

  function showPin(accuracy) {
    const { lat, lng } = marker.getLatLng();
    pinStatus.textContent = t('submit.pinAt', { lat: lat.toFixed(6), lng: lng.toFixed(6) });
    gpsMessage(accuracy ? t('submit.gpsAccuracy', { n: Math.round(accuracy) }) : '');
    pinStatus.classList.add('pin-set');
    pinRemove.hidden = false;
    lookupAddress(lat, lng);
  }

  function clearAccuracy() {
    if (accuracyCircle) accuracyCircle.remove();
    accuracyCircle = null;
  }

  function placePin(latlng, { accuracy, zoom } = {}) {
    if (!marker) {
      marker = L.marker(latlng, { draggable: true, icon: SB.maps.pinIcon('new') }).addTo(map);
      marker.on('dragstart', () => {
        stopLocating(); // the person knows better than the GPS
        clearAccuracy();
      });
      marker.on('dragend', () => showPin());
    } else {
      marker.setLatLng(latlng);
    }
    clearAccuracy();
    if (accuracy) {
      accuracyCircle = L.circle(latlng, { radius: accuracy, interactive: false, className: 'accuracy-circle' }).addTo(map);
    }
    if (zoom) map.setView(latlng, Math.max(map.getZoom(), zoom));
    showPin(accuracy);
  }

  map.on('click', (event) => {
    stopLocating();
    placePin(event.latlng);
  });

  pinRemove.addEventListener('click', () => {
    stopLocating();
    clearAccuracy();
    if (marker) marker.remove();
    marker = null;
    pinRemove.hidden = true;
    gpsMessage('');
    pinStatus.textContent = t('submit.pinNone');
    pinStatus.classList.remove('pin-set');
    if (fields.location.value === autoAddress) fields.location.value = '';
  });

  gpsButton.addEventListener('click', () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      gpsMessage(t('submit.gpsInsecure'));
      return;
    }
    stopLocating();
    gpsButton.disabled = true;
    gpsMessage(t('submit.gpsWorking'));

    // Keep listening for a few seconds: phones start with a rough fix and then sharpen it.
    let best = null;
    const finish = () => {
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      gpsButton.disabled = false;
      stopLocating = () => {};
    };
    const watchId = navigator.geolocation.watchPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (!best || accuracy < best) {
        best = accuracy;
        placePin([latitude, longitude], { accuracy, zoom: 18 });
      }
      if (best <= 10) finish();
    }, (error) => {
      finish();
      if (best === null) gpsMessage(t(error.code === 1 ? 'submit.gpsDenied' : 'submit.gpsUnavailable'));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    const timer = setTimeout(finish, 12000);
    stopLocating = finish;
  });

  // ---------- Photo ----------

  function setPhotoError(message) {
    const node = form.querySelector('[data-error="photo"]');
    node.textContent = message || '';
    node.hidden = !message;
  }

  function clearPhoto() {
    photoData = null;
    photoInput.value = '';
    preview.hidden = true;
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    setPhotoError('');
    if (!file) return clearPhoto();
    try {
      photoData = await SB.shrinkImage(file);
      preview.querySelector('img').src = photoData;
      preview.hidden = false;
    } catch (error) {
      clearPhoto();
      setPhotoError(error.message);
    }
  });
  document.getElementById('photo-remove').addEventListener('click', clearPhoto);

  // ---------- Submit ----------

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    stopLocating();
    formError.hidden = true;
    button.disabled = true;
    button.textContent = t('submit.sending');
    const pin = marker ? marker.getLatLng() : null;
    try {
      const { code } = await api('/api/suggestions', {
        method: 'POST',
        body: {
          type: fields.type.value,
          title: title.value,
          description: description.value,
          category: fields.category.value,
          district: fields.district.value,
          town: fields.town.value,
          ward: fields.ward.value,
          location: fields.location.value,
          lat: pin ? pin.lat : undefined,
          lng: pin ? pin.lng : undefined,
          anonymous: anonymous.checked,
          name: fields.name.value,
          contact: fields.contact.value,
          website: fields.website.value,
          photo: photoData || undefined,
        },
      });
      SB.rememberCode(code);
      document.getElementById('success-code').textContent = code;
      document.getElementById('success-link').href = SB.link(code);
      document.getElementById('form-view').hidden = true;
      const success = document.getElementById('success-view');
      success.hidden = false;
      success.focus();
      window.scrollTo({ top: 0 });
    } catch (error) {
      SB.showFieldErrors(form, error.fields);
      formError.textContent = error.message;
      formError.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = t('submit.send');
    }
  });

  document.getElementById('copy-code').addEventListener('click', async (event) => {
    const target = event.currentTarget;
    const copied = await SB.copy(document.getElementById('success-code').textContent);
    target.textContent = t(copied ? 'common.copied' : 'common.copyFailed');
  });
})();
