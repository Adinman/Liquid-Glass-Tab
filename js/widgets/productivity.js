// Notes, to-do list, and a pomodoro focus timer.
import { el, store, debounce, pad2, toast } from '../util.js';
import { head } from './core.js';
import { S, onChange } from '../state.js';
import { t } from '../i18n.js';

/* ============================ NOTES ============================ */
export const notes = {
  id: 'notes', title: 'Notes', className: 'w-notes',
  render(panel) {
    const ta = el('textarea', { placeholder: t('Scratch space… saved as you type.'), spellcheck: 'true' });
    const saved = el('span', { class: 'faint', style: { fontSize: '10px' } });
    panel.append(head('Notes', saved), ta);

    // The stored value arrives a tick or two after mount. Typing in that window
    // used to be wiped out by the load landing on top of it.
    let touched = false;
    ta.addEventListener('input', () => { touched = true; }, { once: true });
    store.get('notes', '').then(v => { if (!touched) ta.value = v; });
    const save = debounce(async () => {
      await store.set('notes', ta.value);
      saved.textContent = 'saved';
      setTimeout(() => { saved.textContent = ''; }, 1200);
    }, 500);
    ta.addEventListener('input', save);
    return () => {};
  },
};

/* ============================ TASKS ============================ */
export const tasks = {
  id: 'tasks', title: 'Tasks', className: 'w-tasks',
  render(panel) {
    const input = el('input', { class: 'task-add', placeholder: t('Add a task, press Enter') });
    const list = el('div');
    const count = el('span', { class: 'faint', style: { fontSize: '10px' } });
    panel.append(head('To-do', count), input, list);

    let items = [];
    const persist = () => store.set('tasks', items);

    function draw() {
      list.innerHTML = '';
      const open = items.filter(x => !x.done).length;
      count.textContent = items.length ? `${open} open` : '';
      // `task`, not `t`: the delete button's title is t('Delete'), and a loop
      // variable of that name turned it into a call on the task object — so
      // the list threw on its first row and the widget rendered empty.
      for (const task of items) {
        list.append(el('div', { class: 'task' + (task.done ? ' done' : '') },
          el('div', { class: 'box', text: task.done ? '✓' : '', onclick: () => { task.done = !task.done; persist(); draw(); } }),
          el('div', { class: 'txt', text: task.text }),
          el('button', { class: 'del icon-btn', text: '✕', title: t('Delete'),
            onclick: () => { items = items.filter(x => x !== task); persist(); draw(); } })));
      }
    }

    // Anything added before the stored list arrives is kept: assigning the
    // loaded array straight over `items` used to drop it on the floor.
    store.get('tasks', []).then(v => {
      const pending = items;                  // added before the load landed
      items = [...pending, ...(Array.isArray(v) ? v : [])];
      if (pending.length) persist();          // only write if we merged something
      draw();
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      items.unshift({ text: input.value.trim(), done: false, at: Date.now() });
      input.value = '';
      persist(); draw();
    });
    return () => {};
  },
};

/* ============================ POMODORO ============================ */
export const pomodoro = {
  id: 'pomodoro', title: 'Focus', className: 'w-pomo',
  render(panel) {
    // Read live rather than captured, so changing a length in settings reaches
    // a timer that is already on screen instead of waiting for a rebuild.
    const MINUTES = { focus: 'pomoFocus', short: 'pomoShort', long: 'pomoLong' };
    const mins = m => Math.max(1, Math.round(S[MINUTES[m]] ?? 25));
    const lenOf = m => mins(m) * 60;

    let mode = 'focus', left = lenOf('focus'), running = false, done = 0, timer = null;

    const mLabel = el('div', { class: 'pomo-mode', text: t('Focus') });
    const time = el('div', { class: 'lbl tabular' });
    const R = 62, C = 2 * Math.PI * R;
    const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 140 140'); svg.setAttribute('width', 140); svg.setAttribute('height', 140);
    for (const [c, cls] of [[bg, 'bg'], [fg, 'fg']]) {
      c.setAttribute('cx', 70); c.setAttribute('cy', 70); c.setAttribute('r', R);
      c.setAttribute('class', cls); svg.append(c);
    }
    fg.style.strokeDasharray = C;

    const ring = el('div', { class: 'pomo-ring' }, svg, time);
    const startBtn = el('button', { class: 'btn primary', text: t('Start') });
    const resetBtn = el('button', { class: 'btn', text: t('Reset') });
    // The numbers were part of the label text. They are part of the setting now,
    // so the labels are written in draw() rather than here.
    const CHIP = { focus: 'Focus', short: 'Break', long: 'Long' };
    const modes = el('div', { class: 'chips', style: { justifyContent: 'center', marginBottom: '8px' } },
      ...Object.keys(CHIP).map(m =>
        el('button', { class: 'pill', dataset: { m }, onclick: () => switchTo(m) })));
    const stat = el('div', { class: 'faint', style: { fontSize: '11px', marginTop: '8px' } });

    panel.append(head('Focus timer'), mLabel, ring, modes,
      el('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } }, startBtn, resetBtn), stat);

    function draw() {
      time.textContent = `${Math.floor(left / 60)}:${pad2(left % 60)}`;
      // Clamped: shortening the session you are already in leaves `left` above
      // the new total for a moment, and an unclamped ratio draws the ring past
      // full and then inside out.
      const frac = Math.min(1, Math.max(0, left / lenOf(mode)));
      fg.style.strokeDashoffset = C * (1 - frac);
      mLabel.textContent = t({ focus: 'Focus', short: 'Short break', long: 'Long break' }[mode]);
      // These were the only two labels in the widget going out untranslated,
      // even though every catalogue already carries both.
      startBtn.textContent = running ? t('Pause') : t('Start');
      stat.textContent = !done ? ''
        : done === 1 ? t('1 session completed today')
        : t('{n} sessions completed today', { n: done });
      for (const b of modes.children) {
        b.classList.toggle('on', b.dataset.m === mode);
        b.textContent = `${t(CHIP[b.dataset.m])} ${mins(b.dataset.m)}`;
      }
    }

    function switchTo(m) { mode = m; left = lenOf(m); stop(); draw(); }
    function stop() { running = false; clearInterval(timer); timer = null; draw(); }

    function start() {
      running = true;
      timer = setInterval(() => {
        left--;
        if (left <= 0) {
          if (mode === 'focus') { done++; store.set('pomoDone', { d: new Date().toDateString(), n: done }); }
          stop();
          toast(mode === 'focus' ? 'Focus session done — take a break.' : 'Break over.');
          // play() rejects rather than throws when autoplay is blocked, so the
          // try/catch around it never saw anything — it surfaced as an
          // unhandled rejection in the console instead.
          try {
            new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=')
              .play()?.catch(() => {});
          } catch {}
          switchTo(mode === 'focus' ? 'short' : 'focus');
          return;
        }
        draw();
      }, 1000);
      draw();
    }

    startBtn.onclick = () => (running ? stop() : start());
    resetBtn.onclick = () => switchTo(mode);

    store.get('pomoDone', null).then(v => {
      if (v && v.d === new Date().toDateString()) { done = v.n; draw(); }
    });

    // A length changed in settings should reach the dial without waiting for a
    // rebuild — and a rebuild would throw away a session already counting down.
    const offSettings = onChange(keys => {
      if (!keys.includes('*') && !keys.some(k => k in MINUTES || k.startsWith('pomo'))) return;
      // Mid-session the clock is not moved under you; the new length applies
      // from the next one. Idle, the dial should show what was just chosen.
      if (!running) left = lenOf(mode);
      draw();
    });

    draw();
    return () => { clearInterval(timer); offSettings(); };
  },
};
