// Keyboard shortcuts, as data rather than as a chain of `else if`s.
//
// Deliberately imports nothing. state.js needs ACTIONS to sanitize a stored
// map, and app.js and settings.js both need to resolve bindings — if this file
// reached back into state.js for S, that would be a cycle, and module-load
// order in this project has bitten before. So every function here takes the
// stored map as an argument and the callers pass S.keys.

/** The rebindable actions, in the order they appear in settings.
 *
 *  `label` is plain English on purpose: this table is built once at module
 *  load, before any catalogue exists, so wrapping it in t() here would freeze
 *  whatever the fallback was at that moment. Call sites translate it. */
export const ACTIONS = [
  { id: 'palette',   def: 'mod+k', label: 'Command palette' },
  { id: 'search',    def: '/',     label: 'Jump to the search box' },
  { id: 'settings',  def: ',',     label: 'Open settings' },
  { id: 'edit',      def: 'e',     label: 'Edit mode (move widgets)' },
  { id: 'wallpaper', def: 'w',     label: 'Next wallpaper' },
  { id: 'dock',      def: 'b',     label: 'Hide or show the dock' },
  { id: 'incognito', def: 'i',     label: 'Open a private window' },
  { id: 'help',      def: '?',     label: 'List these shortcuts' },
  // Shipped unbound. Both are real actions with no shortcut today, and an
  // empty default is a deliberate value rather than an oversight: inventing a
  // key for something nobody asked for takes it away from everyone, while ''
  // costs nothing and leaves the choice here. resolve() returns '' for these,
  // and '' never matches a keypress, so they simply do not fire until bound.
  { id: 'space',     def: '',      label: 'Next homescreen' },
  { id: 'perf',      def: '',      label: 'Low performance mode' },
];

export const DEFAULT_KEYS = Object.fromEntries(ACTIONS.map(a => [a.id, a.def]));

const BY_ID = new Map(ACTIONS.map(a => [a.id, a]));

/* Keys that already mean something everywhere, and would strand the interface
   if they were taken. Only the bare press is refused — Ctrl and Alt versions
   are free, because nothing here listens for those. */
const RESERVED = {
  Escape:     'Escape closes whatever is open.',
  Tab:        'Tab moves focus, which is how this page is used without a mouse.',
  Enter:      'Enter activates whatever is focused.',
  ' ':        'Space activates the focused dock icon.',
  ArrowUp:    'The arrow keys move along the dock.',
  ArrowDown:  'The arrow keys move along the dock.',
  ArrowLeft:  'The arrow keys move along the dock.',
  ArrowRight: 'The arrow keys move along the dock.',
};

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph',
                               'CapsLock', 'Dead', 'Unidentified']);

const IS_MAC = /mac|iphone|ipad|ipod/i.test(
  navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');

/** A KeyboardEvent as a binding string, or '' if it is not one on its own.
 *
 *  Ctrl and Meta collapse to a single `mod`. That is not a simplification for
 *  its own sake — the shortcut this replaces already accepted either, so one
 *  stored binding has to keep working on both platforms, and a Mac user
 *  rebinding to Cmd+J must not produce something a Windows user cannot press.
 *
 *  Shift is recorded except on a bare printable key, where the character the
 *  keyboard produced already encodes it: `?` IS Shift+/ on most layouts, and
 *  storing that as "shift+?" would describe the same press twice. With Ctrl or
 *  Alt held it goes back to being a real distinction, because the character
 *  arrives shifted either way. */
export function bindingFrom(e) {
  if (MODIFIER_KEYS.has(e.key)) return '';
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  const printable = [...e.key].length === 1;
  // Shift is dropped only for a bare printable key, where the character the
  // keyboard produced already encodes it. Once Ctrl or Alt is held it is a
  // real distinction again — Ctrl+Shift+Y and Ctrl+Y are two shortcuts, and
  // collapsing them would bind the one the user did not press.
  if (e.shiftKey && (!printable || parts.length)) parts.push('shift');
  parts.push(printable ? e.key.toLowerCase() : e.key);
  return parts.join('+');
}

/** Whether a binding carries a modifier, which decides whether it is allowed
 *  to fire while the caret is in a text field. A bare letter must not: typing
 *  "web" in the search box would otherwise cycle the wallpaper and open a
 *  private window on the way past. */
export function hasModifier(binding) {
  return /(^|\+)(mod|alt)(\+|$)/.test(binding);
}

/** Why this binding cannot be used, or null if it can. */
export function bindingProblem(binding) {
  if (!binding) return 'That key cannot be used on its own.';
  const key = binding.split('+').pop();
  // The shift carve-out exists for printable keys, where the character already
  // encodes it. It has no business applying to the reserved list: the dock's
  // arrow handling does not look at Shift, so Shift+ArrowUp would have been
  // accepted here and then quietly lost to dock navigation.
  if (!hasModifier(binding) && RESERVED[key]) return RESERVED[key];
  return null;
}

/** What is actually bound to an action: the stored value if there is one, the
 *  default otherwise. An empty string is a real value meaning "unbound", which
 *  is why this checks for undefined rather than for falsiness. */
export function resolve(stored, id) {
  const v = stored?.[id];
  return typeof v === 'string' ? v : (BY_ID.get(id)?.def ?? '');
}

/** The action a keypress should run, or null. `typing` is true when the caret
 *  is in a field, which only modifier bindings survive. */
export function actionFor(stored, e, typing) {
  const pressed = bindingFrom(e);
  if (!pressed) return null;
  for (const a of ACTIONS) {
    if (resolve(stored, a.id) !== pressed) continue;
    if (typing && !hasModifier(pressed)) return null;
    return a.id;
  }
  return null;
}

/** The id of whatever else already holds this binding, or null. */
export function conflictWith(stored, binding, exceptId) {
  if (!binding) return null;
  for (const a of ACTIONS) {
    if (a.id !== exceptId && resolve(stored, a.id) === binding) return a.id;
  }
  return null;
}

/** The bookmark a keypress should open, or null. Same typing rule as actions:
 *  a shortcut with no modifier stays out of the way while text is being typed. */
export function bookmarkFor(list, e, typing) {
  const pressed = bindingFrom(e);
  if (!pressed) return null;
  for (const b of list || []) {
    if (b.key !== pressed) continue;
    if (typing && !hasModifier(pressed)) return null;
    return b;
  }
  return null;
}

/** Whatever already holds this binding, across BOTH sets, as something
 *  sayable. Actions and bookmarks share one keyboard, so a conflict check that
 *  only looked at one of them would let a bookmark quietly shadow Ctrl+K. */
export function findConflict(stored, bookmarks, binding, except = {}) {
  if (!binding) return null;
  for (const a of ACTIONS) {
    if (a.id !== except.actionId && resolve(stored, a.id) === binding) {
      return { kind: 'action', label: a.label };
    }
  }
  const list = bookmarks || [];
  for (let i = 0; i < list.length; i++) {
    if (i !== except.bookmarkIndex && list[i].key === binding) {
      return { kind: 'bookmark', label: list[i].title || list[i].url };
    }
  }
  return null;
}

const NAMES = {
  ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Backspace: '⌫', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn',
};

/** A binding as something to show a person. Mac gets the glyphs and no
 *  separators, which is the convention there; everywhere else gets words. */
export function keyLabel(binding) {
  if (!binding) return '—';
  const parts = binding.split('+').map((p, i, all) => {
    // The key itself is the last part; anything before it is a modifier.
    if (i < all.length - 1) {
      if (p === 'mod') return IS_MAC ? '⌘' : 'Ctrl';
      if (p === 'alt') return IS_MAC ? '⌥' : 'Alt';
      if (p === 'shift') return IS_MAC ? '⇧' : 'Shift';
      return p;
    }
    if (NAMES[p]) return NAMES[p];
    return [...p].length === 1 ? p.toUpperCase() : p;
  });
  return parts.join(IS_MAC ? '' : '+');
}

/** Whether a stored value is shaped like a binding at all. Used by sanitize:
 *  settings are exported and shared, and this string is compared against live
 *  keypresses, so a junk value should be dropped rather than kept as something
 *  that can never match. */
export function isBindingShape(v) {
  return typeof v === 'string' && v.length <= 40
    && (v === '' || /^(mod\+)?(alt\+)?(shift\+)?[^+\s]+$/.test(v));
}
