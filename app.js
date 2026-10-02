(async function () {
  const $ = (id) => document.getElementById(id);
  let events;
  try {
    events = await (await fetch("data/events.json")).json();
  } catch (err) {
    // Usually a typo in a hand-edited events.json (missing comma or bracket)
    $("start").disabled = true;
    $("start").insertAdjacentHTML("afterend", `<p class="intro-error">Couldn’t read data/events.json: ${err.message}</p>`);
    return;
  }
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Unwrap longitudes so each hop takes the short way round (e.g. across the Pacific)
  const pts = [];
  events.forEach((e, i) => {
    let lng = e.lng;
    if (i > 0) {
      const prev = pts[i - 1][1];
      while (lng - prev > 180) lng -= 360;
      while (prev - lng > 180) lng += 360;
    }
    pts.push([e.lat, lng]);
  });

  const map = L.map("map", { zoomControl: false, worldCopyJump: false, zoomSnap: 0.25, minZoom: 2 })
    .setView([38, 160], 2.5);
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  L.tileLayer(esri + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxZoom: 16,
    className: "base-tiles",
  }).addTo(map);
  L.tileLayer(esri + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);

  const dotIcon = (cls) => L.divIcon({ className: "", html: `<div class="place-dot ${cls}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });

  const markers = {}; // one marker per place+wrap
  const segments = []; // segments[i] connects event i-1 -> i
  let idx = -1;
  let busy = false;
  const SAME_PLACE_KM = 5; // closer than this counts as the same town: no line, just a pulse

  const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));
  const km = (a, b) => map.distance(a, b) / 1000;

  function fly(fn, duration) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      map.once("moveend", finish);
      setTimeout(finish, duration * 1000 + 500);
      fn();
    });
  }

  // Padding keeps both ends clear of the caption, timeline and modal edges
  const pad = () => ({ paddingTopLeft: [60, 90], paddingBottomRight: [60, 130] });

  function arc(a, b, n = 140) {
    const [lat1, lng1] = a, [lat2, lng2] = b;
    const mx = (lat1 + lat2) / 2, my = (lng1 + lng2) / 2;
    const dx = lat2 - lat1, dy = lng2 - lng1;
    const len = Math.hypot(dx, dy);
    // bend perpendicular to the hop, always towards the north
    let px = -dy / (len || 1), py = dx / (len || 1);
    if (px < 0) { px = -px; py = -py; }
    const bend = len * 0.18;
    const cx = mx + px * bend, cy = my + py * bend;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * lat1 + 2 * u * t * cx + t * t * lat2, u * u * lng1 + 2 * u * t * cy + t * t * lng2]);
    }
    return out;
  }

  function markerFor(i) {
    const key = pts[i].join(",");
    if (!markers[key]) {
      markers[key] = L.marker(pts[i], { icon: dotIcon("visited"), keyboard: false }).addTo(map);
    }
    return markers[key];
  }

  function setCurrentMarker(i) {
    Object.values(markers).forEach((m) => { m.setIcon(dotIcon("visited")); m.unbindTooltip(); });
    const m = markerFor(i);
    m.setIcon(dotIcon("pulse"));
    m.bindTooltip(events[i].place.split(",")[0], { permanent: true, direction: "top", offset: [0, -10], className: "place-label" }).openTooltip();
  }

  // Draw finished hops instantly (used when jumping around the timeline)
  function syncTrail(upTo) {
    for (let i = 1; i < segments.length; i++) {
      if (segments[i] && i > upTo) { map.removeLayer(segments[i]); segments[i] = null; }
    }
    for (let i = 1; i <= upTo; i++) {
      markerFor(i - 1);
      if (!segments[i] && km(pts[i - 1], pts[i]) > SAME_PLACE_KM) {
        segments[i] = L.polyline(arc(pts[i - 1], pts[i]), { color: "#c8553d", weight: 3, opacity: 0.85, dashArray: "1 7", lineCap: "round" }).addTo(map);
      }
    }
    if (upTo >= 0) markerFor(upTo);
  }

  async function animateHop(i) {
    const path = arc(pts[i - 1], pts[i]);
    const line = L.polyline([path[0]], { color: "#c8553d", weight: 3, opacity: 0.85, dashArray: "1 7", lineCap: "round" }).addTo(map);
    const duration = reduceMotion ? 1 : Math.min(3400, 1300 + km(pts[i - 1], pts[i]) * 0.25);
    await new Promise((resolve) => {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const n = Math.max(1, Math.round(eased * (path.length - 1)));
        line.setLatLngs(path.slice(0, n + 1));
        t < 1 ? requestAnimationFrame(step) : resolve();
      }
      requestAnimationFrame(step);
    });
    segments[i] = line;
  }

  async function go(i) {
    if (busy || i < 0 || i >= events.length) return;
    busy = true;
    closeModal();
    const forward = i === idx + 1;
    const e = events[i];
    $("caption-date").textContent = e.display;
    $("caption-place").textContent = e.place;
    $("caption").hidden = false;
    renderTimeline(i);

    syncTrail(forward ? i - 1 : i);
    if (i === 0) {
      await fly(() => map.flyTo(pts[0], 5, { duration: 2.2 }), 2.2);
    } else if (km(pts[i - 1], pts[i]) <= SAME_PLACE_KM) {
      // Same town: settle in at a regional zoom rather than zooming out
      const z = Math.max(5, Math.min(map.getZoom(), 7));
      await fly(() => map.flyTo(pts[i], z, { duration: 1.2 }), 1.2);
    } else {
      const bounds = L.latLngBounds([pts[i - 1], pts[i]]);
      await fly(() => map.flyToBounds(bounds, { ...pad(), maxZoom: 11, duration: 1.8 }), 1.8);
      if (forward) await animateHop(i);
    }
    markerFor(i);
    setCurrentMarker(i);
    idx = i;
    renderTimeline(i);
    await sleep(450);
    busy = false;
    openModal(i);
  }

  // ---------- Modal + carousel ----------
  const modal = $("modal");
  let photos = [], photoIdx = 0;

  function openModal(i) {
    const e = events[i];
    $("modal-date").textContent = e.display;
    $("modal-place").textContent = e.place;
    $("modal-label").textContent = e.label;
    $("back").disabled = i === 0;
    $("next").textContent = i === events.length - 1 ? "Start again ↺" : "Continue →";
    photos = e.images;
    const thumbs = $("thumbs");
    thumbs.innerHTML = "";
    if (photos.length > 1) {
      photos.forEach((src, k) => {
        const b = document.createElement("button");
        b.setAttribute("aria-label", `Photo ${k + 1}`);
        b.innerHTML = `<img src="${src}" alt="" loading="lazy">`;
        b.onclick = () => showPhoto(k);
        thumbs.appendChild(b);
      });
    }
    showPhoto(0);
    $("resume").hidden = true;
    if (!modal.open) modal.showModal();
    // warm the cache for the next stop's lead photo
    if (events[i + 1]) new Image().src = events[i + 1].images[0];
  }

  function closeModal() { if (modal.open) modal.close(); }

  function showPhoto(k) {
    photoIdx = (k + photos.length) % photos.length;
    const img = $("photo");
    img.classList.add("loading");
    img.onload = () => img.classList.remove("loading");
    img.src = photos[photoIdx];
    img.alt = events[idx]?.label || "";
    const multi = photos.length > 1;
    $("photo-prev").hidden = $("photo-next").hidden = !multi;
    $("photo-count").textContent = multi ? `${photoIdx + 1} / ${photos.length}` : "";
    [...$("thumbs").children].forEach((b, j) => b.classList.toggle("active", j === photoIdx));
    $("thumbs").children[photoIdx]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    [photoIdx + 1, photoIdx - 1].forEach((j) => { if (photos[j]) new Image().src = photos[j]; });
  }

  $("photo-prev").onclick = () => showPhoto(photoIdx - 1);
  $("photo-next").onclick = () => showPhoto(photoIdx + 1);
  $("modal-close").onclick = closeModal;
  $("next").onclick = () => (idx === events.length - 1 ? restart() : go(idx + 1));
  $("back").onclick = () => go(idx - 1);
  $("resume").onclick = () => (idx === events.length - 1 ? openModal(idx) : go(idx + 1));
  modal.addEventListener("close", () => { if (!busy && idx >= 0) $("resume").hidden = false; });
  modal.addEventListener("click", (ev) => { if (ev.target === modal) closeModal(); }); // backdrop click

  // swipe between photos
  let touchX = null;
  const frame = document.querySelector(".carousel-frame");
  frame.addEventListener("touchstart", (ev) => { touchX = ev.touches[0].clientX; }, { passive: true });
  frame.addEventListener("touchend", (ev) => {
    if (touchX === null) return;
    const dx = ev.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) showPhoto(photoIdx + (dx < 0 ? 1 : -1));
    touchX = null;
  });

  document.addEventListener("keydown", (ev) => {
    if (modal.open) {
      if (ev.key === "ArrowRight") showPhoto(photoIdx + 1);
      if (ev.key === "ArrowLeft") showPhoto(photoIdx - 1);
      if (ev.key === "Enter") { ev.preventDefault(); $("next").click(); }
    } else if (idx >= 0 && (ev.key === "ArrowRight" || ev.key === "Enter")) {
      go(idx + 1);
    }
  });

  // ---------- Timeline ----------
  function renderTimeline(current) {
    const nav = $("timeline");
    if (!nav.children.length) {
      events.forEach((e, i) => {
        const b = document.createElement("button");
        const year = e.date.slice(0, 4);
        const showYear = i === 0 || events[i - 1].date.slice(0, 4) !== year;
        b.innerHTML = `<span class="tick"></span><span>${showYear ? year : "&nbsp;"}</span>`;
        b.title = `${e.display} — ${e.label}`;
        b.onclick = () => go(i);
        nav.appendChild(b);
      });
    }
    [...nav.children].forEach((b, i) => {
      b.classList.toggle("done", i < current);
      b.classList.toggle("current", i === current);
    });
    nav.children[current]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  function restart() {
    closeModal();
    segments.forEach((s) => s && map.removeLayer(s));
    segments.length = 0;
    Object.values(markers).forEach((m) => map.removeLayer(m));
    for (const k in markers) delete markers[k];
    idx = -1;
    go(0);
  }

  renderTimeline(-1);
  $("start").onclick = () => {
    $("intro").classList.add("hide");
    setTimeout(() => go(0), 300);
  };
})();
