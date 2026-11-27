const minutesText = minutes => minutes < 60 ? minutes + ' min' :
  Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0') + ' min';

export function runClockText(timing, now = Date.now() / 1000) {
  const {start, observed, end, finished, snapshot} = timing;
  if (![start, observed].every(Number.isFinite) || start <= 0 || observed < start ||
      start > now || observed > now + 60 || (end != null && (!Number.isFinite(end) || end <= start))) {
    return 'Laufzeit unbekannt';
  }
  const historical = snapshot || now - observed > 1200;
  const at = finished || historical ? observed : Math.max(now, observed);
  const elapsed = minutesText(Math.floor((at - start) / 60));
  if (finished) return 'Laufzeit ' + elapsed + ' · beendet';
  const label = historical ? 'Laufzeit beim letzten Stand ' : 'Laufzeit ';
  if (end == null) return label + elapsed + ' · Ende offen';
  const remaining = Math.ceil((end - now) / 60);
  return label + elapsed + (remaining > 0 ? ' · noch ' + minutesText(remaining) + ' geplant' :
    ' · geplantes Ende erreicht');
}

export function updateRunClock(element, timing) {
  element.timing = timing;
  element.textContent = runClockText(timing);
}

if (globalThis.customElements && !customElements.get('meridian-run-clock')) {
  customElements.define('meridian-run-clock', class extends HTMLElement {
    connectedCallback() {
      this.style.fontSize = '0.9em';
      this.style.fontVariantNumeric = 'tabular-nums';
      this.timer = setInterval(() => {
        if (this.timing && !this.ownerDocument.hidden) this.textContent = runClockText(this.timing);
      }, 15000);
    }
    disconnectedCallback() { clearInterval(this.timer); }
  });
}
