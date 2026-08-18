// Homescreens ("spaces").
//
// Each space is just a different bookmark folder feeding the dock, so you get
// as many docks' worth of bookmarks as you like. Widgets are deliberately NOT
// per-space — the same widgets stay in the same positions across all of them,
// so switching only swaps the bookmarks under your cursor.
//
// State lives in chrome.storage.local, so the active space follows you into
// every new tab and stays put across restarts.

import { $, el, toast, clamp } from './util.js';
import { PRESETS } from './config.js';
import { S, set } from './state.js';
import { attachSheen } from './theme.js';

// New folders are created under "Other bookmarks" so they don't clutter the
// bookmarks bar, which is usually what the first space already points at.
const PARENT_FOLDER = '2';
const bar = () => $('#spaces');
const pop = () => $('#spaces-popover');

export function spaceList() {
  return Array.isArray(S.spaces) && S.spaces.length ? S.spaces : [];
}

export function activeSpace() {
  const list = spaceList();
  return list.find(s => s.id === S.activeSpace) || list[0] || null;
}

/** Which bookmark folder the dock should be showing right now. */
export function activeFolder() {
  return activeSpace()?.folderId || S.dockFolder || '1';
}

const changed = () => window.dispatchEvent(new Event('lgt:space-changed'));

export async function initSpaces() {
  // Seed the first space from whatever folder the dock already used, so an
  // existing setup keeps working and simply gains a name.
  if (!spaceList().length) {
    await set({
      spaces: [{ id: 'home', name: 'Home', folderId: S.dockFolder || '1' }],
      activeSpace: 'home',
    }, { silent: true });
  }
  renderSpaces();

  // Uses composedPath(), which is recorded when the event is dispatched, rather
  // than closest() on e.target. Switching tabs re-renders the sheet, which
  // detaches the very element that was clicked — and closest() on a detached
  // node returns null, so the handler concluded the click was outside and shut
  // the popover before you could see the new tab.
  document.addEventListener('click', e => {
    const path = e.composedPath?.() || [];
    const inside = path.some(n => n?.id === 'spaces-popover' || n?.id === 'spaces');
    if (!inside) closeSpacePopover();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSpacePopover(); });
}

export function closeSpacePopover() { pop().hidden = true; }

export function renderSpaces() {
  const wrap = bar();
  if (!wrap) return;
  wrap.innerHTML = '';
  const list = spaceList();
  const active = activeSpace();

  for (const sp of list) {
    const isActive = active && sp.id === active.id;
    const chip = el('button', {
      class: 'space-chip' + (isActive ? ' on' : ''),
      title: isActive ? `${sp.name} — click again to rename` : `Switch to ${sp.name}`,
      text: sp.name,
      onclick: e => {
        e.stopPropagation();
        if (isActive) openManage(sp, chip);      // clicking the active one manages it
        else switchTo(sp.id);
      },
      oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); openManage(sp, chip); },
    });
    wrap.append(chip);
  }

  const add = el('button', {
    class: 'space-chip add', title: 'New homescreen', text: '+',
    onclick: e => { e.stopPropagation(); openCreate(add); },
  });
  wrap.append(add);
  attachSheen(wrap);
}

export async function switchTo(id) {
  if (!spaceList().some(s => s.id === id)) return;
  await set({ activeSpace: id });
  renderSpaces();
  changed();
}

/* ---------------- popover ---------------- */
function positionPopover(anchor) {
  const p = pop();
  p.hidden = false;
  const a = anchor.getBoundingClientRect();
  p.style.left = clamp(a.left, 12, Math.max(12, innerWidth - p.offsetWidth - 12)) + 'px';
  p.style.top = (a.bottom + 10) + 'px';
  attachSheen(p);
}

function sheet(title, ...rows) {
  const p = pop();
  p.innerHTML = '';
  p.append(el('div', { class: 'dp-title', text: title }), ...rows);
  return p;
}

/** Shared creation path for both kinds. */
async function create({ label, links = [] }) {
  const folder = await chrome.bookmarks.create({
    parentId: PARENT_FOLDER, title: `Homescreen — ${label}`,
  });
  for (const [title, url] of links) {
    try { await chrome.bookmarks.create({ parentId: folder.id, title, url }); } catch {}
  }
  const space = { id: 's' + Date.now(), name: label, folderId: folder.id };
  const spaces = [...spaceList(), space];
  await set({ spaces, activeSpace: space.id });
  closeSpacePopover();
  renderSpaces();
  changed();
  return space;
}

function openCreate(anchor) {
  let kind = 'blank';

  const render = () => {
    const err = el('div', { class: 'dp-err', hidden: true });
    const fail = m => { err.textContent = m; err.hidden = false; };

    const tabs = el('div', { class: 'chips', style: { marginBottom: '10px' } },
      ...[['blank', 'Blank'], ['preset', 'Preset']].map(([id, label]) =>
        el('button', {
          class: 'pill' + (kind === id ? ' on' : ''), text: label,
          onclick: () => { kind = id; render(); },
        })));

    const rows = [tabs, err];

    if (kind === 'blank') {
      const name = el('input', { class: 'dp-field', type: 'text', placeholder: 'Name, e.g. Work' });
      const go = async () => {
        const label = name.value.trim();
        if (!label) return fail('Give it a name');
        try { await create({ label }); toast(`“${label}” created`); }
        catch (e) { fail('Could not create the folder: ' + e.message); }
      };
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      rows.push(name,
        el('div', { class: 'dp-row' },
          el('button', { class: 'btn', text: 'Cancel', onclick: closeSpacePopover }),
          el('button', { class: 'btn primary', text: 'Create', onclick: go })));

    } else {
      const ids = Object.keys(PRESETS);
      const picker = el('select', { class: 'dp-field' }, ...ids.map(id =>
        el('option', { value: id }, `${PRESETS[id].icon}  ${PRESETS[id].name}`)));
      const name = el('input', { class: 'dp-field', type: 'text' });
      const preview = el('div', { class: 'preset-preview' });

      const refresh = () => {
        const p = PRESETS[picker.value];
        name.value = p.name;
        preview.textContent = `${p.links.length} bookmarks: ` + p.links.map(l => l[0]).join(' · ');
      };
      picker.addEventListener('change', refresh);
      refresh();

      const go = async () => {
        const p = PRESETS[picker.value];
        const label = name.value.trim() || p.name;
        try {
          await create({ label, links: p.links });
          toast(`“${label}” created with ${p.links.length} bookmarks`);
        } catch (e) { fail('Could not create it: ' + e.message); }
      };
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });

      rows.push(
        el('label', { class: 'dp-label', text: 'Preset' }), picker,
        el('label', { class: 'dp-label', text: 'Name' }), name,
        preview,
        el('div', { class: 'dp-row' },
          el('button', { class: 'btn', text: 'Cancel', onclick: closeSpacePopover }),
          el('button', { class: 'btn primary', text: 'Create', onclick: go })));
    }

    sheet('New homescreen', ...rows);
    positionPopover(anchor);
    if (kind === 'blank') pop().querySelector('.dp-field')?.focus();
  };

  render();
}

function openManage(sp, anchor) {
  const err = el('div', { class: 'dp-err', hidden: true });
  const name = el('input', { class: 'dp-field', type: 'text', value: sp.name });
  const only = spaceList().length <= 1;

  const save = async () => {
    const label = name.value.trim();
    if (!label) { err.textContent = 'Give it a name'; err.hidden = false; return; }
    const spaces = spaceList().map(s => (s.id === sp.id ? { ...s, name: label } : s));
    await set({ spaces });
    // Keep the bookmark folder's own title in step, except for the bookmarks
    // bar itself which Chrome will not let us rename.
    if (sp.folderId !== '1' && sp.folderId !== '2') {
      try { await chrome.bookmarks.update(sp.folderId, { title: `Homescreen — ${label}` }); } catch {}
    }
    closeSpacePopover();
    renderSpaces();
    toast('Renamed');
  };

  const remove = async () => {
    if (only) return toast('You need at least one homescreen.');
    const spaces = spaceList().filter(s => s.id !== sp.id);
    const patch = { spaces };
    if (S.activeSpace === sp.id) patch.activeSpace = spaces[0].id;
    await set(patch);
    closeSpacePopover();
    renderSpaces();
    changed();
    toast('Removed — its bookmarks are still in Other bookmarks');
  };

  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  sheet('Homescreen', err, name,
    el('div', { class: 'hint', style: { margin: '2px 0 8px' } },
      'Deleting a homescreen never deletes its bookmarks.'),
    el('div', { class: 'dp-row' },
      only ? '' : el('button', { class: 'btn danger', text: 'Delete', onclick: remove }),
      el('button', { class: 'btn', text: 'Cancel', onclick: closeSpacePopover }),
      el('button', { class: 'btn primary', text: 'Save', onclick: save })));
  positionPopover(anchor);
  name.focus();
  name.select();
}
