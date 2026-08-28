// Clock, search, quote, calendar, world clocks, countdown, speed dial, battery.
import { el, $, pad2, clamp, hostOf, toast, debounce,
         openIncognito, incognitoIcon, webSearch } from '../util.js';
import { iconElement } from '../icons.js';
import { QUOTES, HOLIDAYS } from '../config.js';
import { S, set } from '../state.js';
import { t } from '../i18n.js';

/** A widget's header row. The title is translated here rather than at each of
 *  the dozen call sites — head() runs at render time, so this is the one place
 *  that is both late enough to have a catalogue and early enough to catch every
 *  widget. */
export function head(title, ...actions) {
  title = t(title);
  return el('header', {}, el('span', { text: title }), el('span', { class: 'grow' }), ...actions);
}
const tick = (fn, ms) => { fn(); const id = setInterval(fn, ms); return () => clearInterval(id); };

/** Like `tick`, but each wake-up lands on a wall-clock boundary instead of
 *  free-running from whenever the widget happened to mount. A free-running
 *  interval drifts, so the displayed second visibly skips or repeats; this
 *  also re-aligns itself after the browser throttles a hidden tab. */
function tickAligned(fn, periodMs) {
  let id = 0, stopped = false;
  const run = () => {
    if (stopped) return;
    fn();
    id = setTimeout(run, periodMs - (Date.now() % periodMs));
  };
  run();
  return () => { stopped = true; clearTimeout(id); };
}

/* ============================ CLOCK ============================ */
export const clock = {
  id: 'clock', title: 'Clock', className: 'w-clock', chrome: false,
  render(panel) {
    const time = el('div', { class: 'time tabular' });
    const date = el('div', { class: 'date' });
    const greet = el('div', { class: 'greet' });
    panel.append(time, date, greet);

    // Nothing here is rewritten unless it changed. The whole widget used to be
    // rebuilt four times a second — including toLocaleDateString, which costs
    // ~0.04 ms and produces the same string all day.
    let lastTime = '', lastDay = '', lastGreet = '';

    const draw = () => {
      const now = new Date();
      let h = now.getHours();
      const ampm = h < 12 ? 'AM' : 'PM';
      if (!S.clock24) { h = h % 12 || 12; }
      const hhmm = `${S.clock24 ? pad2(h) : h}:${pad2(now.getMinutes())}`;
      const secs = S.showSeconds ? pad2(now.getSeconds()) : '';

      const timeKey = `${hhmm}|${secs}|${S.clock24 ? '' : ampm}`;
      if (timeKey !== lastTime) {
        lastTime = timeKey;
        time.innerHTML = '';
        time.append(
          hhmm,
          S.showSeconds ? el('span', { class: 'sec', text: secs }) : '',
          S.clock24 ? '' : el('span', { class: 'ampm', text: ampm }),
        );
      }

      const day = now.toDateString();
      if (day !== lastDay) {
        lastDay = day;
        date.textContent = now.toLocaleDateString(undefined,
          { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      }

      const hr = now.getHours();
      const part = t(hr < 5 ? 'Good night' : hr < 12 ? 'Good morning'
                 : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Good night');
      const line = S.userName ? `${part}, ${S.userName}.` : part + '.';
      if (line !== lastGreet) {
        lastGreet = line;
        greet.textContent = line;
        greet.hidden = false;
      }
    };
    // 5000 still lands exactly on the minute (60000 divides by 5000), so the
    // minute-only display changes on the boundary rather than up to 5s late.
    return tickAligned(draw, S.showSeconds ? 1000 : 5000);
  },
};

/* ============================ SEARCH ============================ */
export const search = {
  id: 'search', title: 'Search', className: 'w-search', chrome: false,
  render(panel) {
    // The engine cannot be named here, because this extension is not the one
    // choosing it — see webSearch in util.js. Chrome's own omnibox says the same
    // thing for the same reason.
    const input = el('input', { type: 'text', spellcheck: 'false', autocomplete: 'off',
      placeholder: t('Search or enter an address') });

    // Opens an empty private window. It used to latch, and an armed search sent
    // the query to a private window — but sending a query anywhere means naming
    // an engine, and naming one is the thing CGT is no longer allowed to do.
    // What survives is the part that never needed an engine: one click to a
    // private window, the same as the I shortcut and the palette command.
    const priv = el('button', {
      class: 'pill incog', type: 'button',
      title: t('Open a private window'),
      'aria-label': t('Open a private window'),
    }, incognitoIcon());
    priv.addEventListener('click', () => openIncognito());

    const form = el('form', {}, el('span', { text: '⌕', style: { opacity: .5, fontSize: '18px' } }),
      input, priv);
    const sugg = el('div', { class: 'sugg glass', hidden: true });
    panel.append(form, sugg);

    let items = [], sel = -1;

    /** An address, or null if this is a search. Only the address half resolves
     *  to a URL here; the search half is Chrome's to route, not ours. */
    const asUrl = q => {
      const looksLikeUrl = /^(https?:\/\/|localhost[:/]|(\S+\.)+[a-z]{2,}(\/|$))/i.test(q) && !q.includes(' ');
      if (!looksLikeUrl) return null;
      // Test for the scheme, not a "http" prefix: `httpfoo.com` starts with
      // "http" but has no scheme, and passing it through unchanged made this a
      // relative navigation off the extension's own origin.
      return /^https?:\/\//i.test(q) ? q : 'https://' + q;
    };

    const go = q => {
      q = q.trim();
      if (!q) return;
      const url = asUrl(q);
      if (url) { location.href = url; return; }
      webSearch(q);
    };

    const renderSugg = () => {
      sugg.innerHTML = '';
      if (!items.length) { sugg.hidden = true; return; }
      items.forEach((s, i) => sugg.append(el('div', {
        class: 's-item' + (i === sel ? ' sel' : ''), text: s,
        onmousedown: e => { e.preventDefault(); go(s); },
      })));
      sugg.hidden = false;
    };

    const fetchSugg = debounce(async q => {
      if (!S.suggestions || q.length < 2) { items = []; renderSugg(); return; }
      try {
        const r = await fetch('https://duckduckgo.com/ac/?type=list&q=' + encodeURIComponent(q));
        const j = await r.json();
        items = (j[1] || []).slice(0, 6);
      } catch { items = []; }
      sel = -1;
      renderSugg();
    }, 160);

    input.addEventListener('input', () => fetchSugg(input.value));
    input.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 120));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        sel = clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), -1, items.length - 1);
        renderSugg();
      } else if (e.key === 'Escape') { items = []; renderSugg(); input.blur(); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      go(sel >= 0 ? items[sel] : input.value);
    });

    panel._focus = () => input.focus();
    return () => {};
  },
};

/* ============================ QUOTE ============================ */
export const quote = {
  id: 'quote', title: 'Quote', className: 'w-quote',
  render(panel) {
    const day = Math.floor(Date.now() / 864e5);
    let i = day % QUOTES.length;
    const q = el('div', { class: 'q' }), a = el('div', { class: 'a' });
    const draw = () => { q.textContent = '“' + QUOTES[i][0] + '”'; a.textContent = '— ' + QUOTES[i][1]; };
    draw();
    panel.append(head('Quote', el('button', {
      class: 'icon-btn', title: t('Another'), text: '⟳',
      onclick: () => { i = (i + 1) % QUOTES.length; draw(); },
    })), q, a);
    return () => {};
  },
};

/* ============================ CALENDAR ============================ */
export const calendar = {
  id: 'calendar', title: 'Calendar', className: 'w-cal',
  render(panel) {
    let cursor = new Date();
    const label = el('span', { class: 'grow', style: { textAlign: 'center' } });
    const grid = el('div', { class: 'cal-grid' });
    const prev = el('button', { class: 'icon-btn', text: '‹', onclick: () => { cursor.setMonth(cursor.getMonth() - 1); draw(); } });
    const next = el('button', { class: 'icon-btn', text: '›', onclick: () => { cursor.setMonth(cursor.getMonth() + 1); draw(); } });
    panel.append(el('header', {}, prev, label, next), grid);

    function draw() {
      label.textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      grid.innerHTML = '';
      for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('div', { class: 'hd', text: d }));
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const start = first.getDay();
      const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const prevDays = new Date(cursor.getFullYear(), cursor.getMonth(), 0).getDate();
      const today = new Date();
      const isThisMonth = today.getMonth() === cursor.getMonth() && today.getFullYear() === cursor.getFullYear();

      for (let i = 0; i < start; i++) grid.append(el('div', { class: 'dy out', text: prevDays - start + i + 1 }));
      for (let d = 1; d <= days; d++)
        grid.append(el('div', { class: 'dy' + (isThisMonth && d === today.getDate() ? ' today' : ''), text: d }));
      const filled = start + days, tail = (7 - filled % 7) % 7;
      for (let i = 1; i <= tail; i++) grid.append(el('div', { class: 'dy out', text: i }));
    }
    draw();
    return () => {};
  },
};

/* ============================ WORLD CLOCKS ============================ */
export const worldclock = {
  id: 'worldclock', title: 'World clocks', className: 'w-world',
  render(panel) {
    const list = el('div');
    panel.append(head('World clocks'), list);
    const draw = () => {
      list.innerHTML = '';
      for (const z of S.worldClocks) {
        let time = '—';
        try {
          time = new Date().toLocaleTimeString(undefined,
            { timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: !S.clock24 });
        } catch { time = 'bad tz'; }
        list.append(el('div', { class: 'wc-row' },
          el('span', { class: 'z', text: z.label }), el('span', { class: 'tabular', text: time })));
      }
    };
    return tick(draw, 10000);
  },
};

/* ============================ COUNTDOWN ============================ */

/** Whatever the widget is currently counting to, or null if not set up. */
export function countdownTarget(now = new Date()) {
  if (S.countdownMode === 'custom') {
    if (!S.countdownDate) return null;
    // Parse as local midnight; a bare 'YYYY-MM-DD' is treated as UTC otherwise,
    // which shifts the target by a day for anyone west of Greenwich.
    const [y, m, d] = S.countdownDate.split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0);
    if (isNaN(date)) return null;
    return { date, name: S.countdownLabel?.trim() || 'your event' };
  }
  const h = HOLIDAYS[S.countdownHoliday] || HOLIDAYS.christmas;
  return { date: h.next(now), name: h.name };
}

export const countdown = {
  id: 'countdown', title: 'Countdown', className: 'w-count',
  render(panel) {
    const num = el('div', { class: 'count-num tabular' });
    const lbl = el('div', { class: 'count-lbl' });
    const editor = el('div', { class: 'count-edit', hidden: true });
    const editBtn = el('button', {
      class: 'icon-btn', text: '✎', title: 'Change what this counts to',
      onclick: () => {
        editor.hidden = !editor.hidden;
        panel.classList.toggle('editing', !editor.hidden);
        if (!editor.hidden) {
          buildEditor();
          // Measure once it has content, and flip above if it would hang off
          // the bottom of the screen.
          editor.classList.remove('above');
          if (editor.getBoundingClientRect().bottom > innerHeight - 10) {
            editor.classList.add('above');
          }
        }
      },
    });
    panel.append(head('Countdown', editBtn), num, lbl, editor);

    function draw() {
      const target = countdownTarget();
      // Named `target`, not `t`: in the branch below t would have been null,
      // and t('Pick a date') called it — so the one path that exists to say
      // "no date yet" was the one path that threw.
      if (!target) { num.textContent = '—'; lbl.textContent = t('Pick a date'); return; }
      const diff = target.date - Date.now();
      if (diff <= 0) { num.textContent = '🎉'; lbl.textContent = `${target.name} — it’s here`; return; }
      const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60;
      num.textContent = d > 0 ? `${d}d ${h}h` : `${h}h ${pad2(m)}m`;
      lbl.textContent = `until ${target.name}`;
    }

    function buildEditor() {
      const mode = S.countdownMode === 'custom' ? 'custom' : 'holiday';
      editor.innerHTML = '';
      editor.append(el('div', { class: 'chips' },
        ...[['holiday', 'Holiday'], ['custom', 'Custom']].map(([id, label]) => el('button', {
          class: 'pill' + (mode === id ? ' on' : ''), text: label,
          onclick: async () => { await set({ countdownMode: id }); buildEditor(); draw(); },
        }))));

      if (mode === 'holiday') {
        const sel = el('select', { class: 'count-field' }, ...Object.entries(HOLIDAYS).map(([id, h]) =>
          el('option', { value: id, selected: S.countdownHoliday === id }, h.name)));
        sel.addEventListener('change', async () => {
          await set({ countdownHoliday: sel.value }); draw();
        });
        editor.append(sel);
      } else {
        const date = el('input', { class: 'count-field', type: 'date', value: S.countdownDate || '' });
        const name = el('input', { class: 'count-field', type: 'text',
          placeholder: 'What is it? e.g. my birthday', value: S.countdownLabel || '' });
        date.addEventListener('change', async () => { await set({ countdownDate: date.value }); draw(); });
        name.addEventListener('input', debounce(async () => {
          await set({ countdownLabel: name.value }); draw();
        }, 300));
        editor.append(date, name);
      }
    }

    return tick(draw, 30000);
  },
};

/* ============================ SPEED DIAL ============================ */
export const speeddial = {
  id: 'speeddial', title: 'Speed dial', className: 'w-speed',
  render(panel) {
    const grid = el('div', { class: 'speed-grid' });
    panel.append(head('Most visited'), grid);
    chrome.topSites.get(sites => {
      grid.innerHTML = '';
      for (const s of sites.slice(0, 8)) {
        grid.append(el('a', { class: 'speed-item', href: s.url, title: s.title },
          iconElement(s.url, 32, s.title, 'letter speed-letter'),
          el('span', { text: s.title || hostOf(s.url) })));
      }
    });
    return () => {};
  },
};

/* ============================ BATTERY ============================ */
export const battery = {
  id: 'battery', title: 'Battery', className: 'w-battery',
  render(panel) {
    const pct = el('div', { style: { fontSize: '26px', fontWeight: 250 } });
    const meta = el('div', { class: 'faint', style: { fontSize: '11.5px', marginTop: '4px' } });
    const bar = el('div', { class: 'bat-shell' }, el('i'));
    panel.append(head('Battery'), pct, bar, meta);

    let bat = null;
    const draw = () => {
      if (!bat) return;
      const p = Math.round(bat.level * 100);
      pct.textContent = p + '%';
      bar.firstChild.style.width = p + '%';
      const secs = bat.charging ? bat.chargingTime : bat.dischargingTime;
      const time = Number.isFinite(secs) && secs > 0
        ? ` · ${Math.floor(secs / 3600)}h ${pad2(Math.floor(secs / 60) % 60)}m ${bat.charging ? 'to full' : 'left'}` : '';
      meta.textContent = t(bat.charging ? 'Charging' : 'On battery') + time;
    };

    // BatteryManager is a persistent singleton, so these listeners outlive the
    // widget. Without removing them every rebuild leaves four more behind, each
    // holding a detached panel alive.
    const EVENTS = ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'];
    let detach = () => {};
    let dead = false;

    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        if (dead) return;                 // torn down before the promise settled
        bat = b;
        EVENTS.forEach(ev => b.addEventListener(ev, draw));
        detach = () => EVENTS.forEach(ev => b.removeEventListener(ev, draw));
        draw();
      }).catch(() => {});
    } else {
      pct.textContent = '—';
      meta.textContent = t('This device does not report battery status.');
    }
    return () => { dead = true; detach(); };
  },
};
