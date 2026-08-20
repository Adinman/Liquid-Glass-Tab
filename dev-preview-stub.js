// DEV ONLY — minimal chrome.* stubs so the page runs in a plain browser tab.
// Safe to delete along with dev-preview.html.
(function () {
  // ?raf=timer drives animation off setTimeout. A backgrounded/non-compositing
  // tab never fires requestAnimationFrame, so canvas output can't otherwise be
  // inspected during automated checks.
  if (new URLSearchParams(location.search).get('raf') === 'timer') {
    window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  }

  const mem = JSON.parse(localStorage.getItem('__lgt_stub') || '{}');
  const flush = () => localStorage.setItem('__lgt_stub', JSON.stringify(mem));

  const BM = [
    { id: '1', title: 'Bookmarks bar', children: [
      { id: '11', parentId: '1', title: 'GitHub', url: 'https://github.com' },
      { id: '12', parentId: '1', title: 'Hacker News', url: 'https://news.ycombinator.com' },
      { id: '13', parentId: '1', title: 'YouTube', url: 'https://youtube.com' },
      { id: '14', parentId: '1', title: 'Wikipedia', url: 'https://wikipedia.org' },
      { id: '15', parentId: '1', title: 'Dev', children: [
        { id: '151', parentId: '15', title: 'MDN', url: 'https://developer.mozilla.org' },
        { id: '152', parentId: '15', title: 'Can I Use', url: 'https://caniuse.com' },
      ] },
      { id: '16', parentId: '1', title: 'Spotify', url: 'https://open.spotify.com' },
      { id: '17', parentId: '1', title: 'Figma', url: 'https://figma.com' },
    ] },
    { id: '2', title: 'Other bookmarks', children: [] },
  ];
  const find = (nodes, id) => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) { const r = find(n.children, id); if (r) return r; }
    }
    return null;
  };
  const noop = { addListener() {}, removeListener() {} };

  window.chrome = {
    runtime: {
      getURL: p => new URL(p.replace(/^\//, ''), location.href).toString(),
      id: 'preview',
      // Real extensions always have this; without it any caller throws and
      // takes its whole settings panel down with it.
      getManifest: () => ({ version: '0.0.0-preview', name: 'CGT: Customizable Glass Tab' }),
    },
    storage: {
      local: {
        get: async k => (k === null ? { ...mem }
          : typeof k === 'string' ? (k in mem ? { [k]: mem[k] } : {})
          : Object.fromEntries(k.filter(x => x in mem).map(x => [x, mem[x]]))),
        set: async o => { Object.assign(mem, o); flush(); },
        remove: async k => { for (const x of [].concat(k)) delete mem[x]; flush(); },
      },
      onChanged: noop,
    },
    bookmarks: {
      getTree: async () => [{ id: '0', children: BM }],
      getSubTree: async id => [find(BM, id) || BM[0]],
      search: async () => [],
      move: async () => {},
      create: async ({ parentId, title, url }) => {
        const parent = find(BM, parentId) || BM[0];
        const node = { id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), parentId, title, url };
        (parent.children ||= []).push(node);
        return node;
      },
      update: async (id, changes) => Object.assign(find(BM, id) || {}, changes),
      remove: async id => {
        const strip = nodes => {
          const i = nodes.findIndex(n => n.id === id);
          if (i >= 0) { nodes.splice(i, 1); return true; }
          return nodes.some(n => n.children && strip(n.children));
        };
        if (!strip(BM)) throw new Error("Can't find bookmark for id.");
      },
      onCreated: noop, onRemoved: noop, onChanged: noop, onMoved: noop,
    },
    topSites: { get: cb => {
      const r = [
        { title: 'GitHub', url: 'https://github.com' },
        { title: 'Reddit', url: 'https://reddit.com' },
        { title: 'Gmail', url: 'https://mail.google.com' },
        { title: 'Twitch', url: 'https://twitch.tv' },
      ];
      return cb ? cb(r) : Promise.resolve(r);
    } },
    history: { search: async () => [] },
    tabs: {
      query: async () => ([
        { id: 1, windowId: 1, title: 'Anthropic', url: 'https://www.anthropic.com/' },
        { id: 2, windowId: 1, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' },
        { id: 3, windowId: 1, title: 'New Tab', url: 'chrome://newtab/' },
        { id: 4, windowId: 1, title: 'Anthropic', url: 'https://www.anthropic.com/' },
      ]),
      create() {}, update() {},
    },
    // Private windows can't really be opened outside the extension, so record
    // the calls instead — `window.__lgtWindows` is what the dev checks look at.
    windows: {
      update() {},
      create: async opts => {
        (window.__lgtWindows ||= []).push(opts);
        return { id: Math.floor(Math.random() * 1e6), incognito: !!opts?.incognito };
      },
    },
    permissions: { request: async () => true },
    identity: { getRedirectURL: p => `https://preview.chromiumapp.org/${p}` },
    alarms: { create() {}, onAlarm: noop },
  };

  // The favicon service doesn't exist outside the extension. Set
  // ?favicons=broken in the URL to simulate the requests failing, which is how
  // it behaves when the _favicon web_accessible_resources entry is missing.
  const broken = new URLSearchParams(location.search).get('favicons') === 'broken';
  // Must be a real http(s) URL, not a data: URL — faviconURL() appends query
  // params to whatever this returns, which would corrupt a data URL.
  const dot = location.origin + (broken ? '/_favicon-does-not-exist.png' : '/icons/icon48.png');
  const origGetURL = window.chrome.runtime.getURL;
  window.chrome.runtime.getURL = p => (p.includes('_favicon') ? dot : origGetURL(p));
})();
