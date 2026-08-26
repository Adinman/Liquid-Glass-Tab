// Notes, to-do list, and a pomodoro focus timer.
import { el, store, debounce, pad2, toast } from '../util.js';
import { head } from './core.js';
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
      const open = items.filter(t => !t.done).length;
      count.textContent = items.length ? `${open} open` : '';
      for (const t of items) {
        list.append(el('div', { class: 'task' + (t.done ? ' done' : '') },
          el('div', { class: 'box', text: t.done ? '✓' : '', onclick: () => { t.done = !t.done; persist(); draw(); } }),
          el('div', { class: 'txt', text: t.text }),
          el('button', { class: 'del icon-btn', text: '✕', title: t('Delete'),
            onclick: () => { items = items.filter(x => x !== t); persist(); draw(); } })));
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
    const LEN = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
    let mode = 'focus', left = LEN.focus, running = false, done = 0, timer = null;

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
    const modes = el('div', { class: 'chips', style: { justifyContent: 'center', marginBottom: '8px' } },
      ...[['focus', 'Focus 25'], ['short', 'Break 5'], ['long', 'Long 15']].map(([m, label]) =>
        el('button', { class: 'pill', dataset: { m }, text: label, onclick: () => switchTo(m) })));
    const stat = el('div', { class: 'faint', style: { fontSize: '11px', marginTop: '8px' } });

    panel.append(head('Focus timer'), mLabel, ring, modes,
      el('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } }, startBtn, resetBtn), stat);

    function draw() {
      time.textContent = `${Math.floor(left / 60)}:${pad2(left % 60)}`;
      fg.style.strokeDashoffset = C * (1 - left / LEN[mode]);
      mLabel.textContent = t({ focus: 'Focus', short: 'Short break', long: 'Long break' }[mode]);
      startBtn.textContent = running ? 'Pause' : 'Start';
      stat.textContent = done ? `${done} session${done > 1 ? 's' : ''} completed today` : '';
      [...modes.children].forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    }

    function switchTo(m) { mode = m; left = LEN[m]; stop(); draw(); }
    function stop() { running = false; clearInterval(timer); timer = null; draw(); }

    function start() {
      running = true;
      timer = setInterval(() => {
        left--;
        if (left <= 0) {
          if (mode === 'focus') { done++; store.set('pomoDone', { d: new Date().toDateString(), n: done }); }
          stop();
          toast(mode === 'focus' ? 'Focus session done — take a break.' : 'Break over.');
          try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=').play(); } catch {}
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
    draw();
    return () => clearInterval(timer);
  },
};
