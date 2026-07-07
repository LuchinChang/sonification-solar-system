// src/keyboard-shortcuts.ts
//
// Persistent, collapsible keyboard shortcuts menu — the single source of truth
// for the app's shortcut *documentation*. The keydown *dispatch* still lives in
// controls.ts (it's behaviour, not docs); this module only describes it, so the
// two no longer drift the way the old hand-synced #keyboard-shortcuts-popover did.
//
// Form factor (see plan): a left-edge vertical panel mirroring the right-edge
// telemetry panel. Default expanded on every load; collapses to a 40px peek-tab
// via the tab click, the ? button, or the ? key (wired in controls.ts).
//
// The "Node Editor" section is dimmed while the editor is closed and brightened
// when it opens — driven by setEditorActive(), called from node-editor/panel.ts.

interface KeyboardShortcut {
  /** One <kbd> per entry, e.g. ['⌘', 'S']. */
  keys: string[];
  label: string;
}

interface KeyboardShortcutSection {
  title: string;
  bindings: KeyboardShortcut[];
  /** When true, the section renders dimmed until setEditorActive(true). */
  dimWhenEditorClosed?: boolean;
  /** Optional hint shown under a dimmable section. */
  caption?: string;
}

// Mirrors the verified inventory of every shortcut. Edit HERE to change the docs.
export const KEYBOARD_SHORTCUTS: KeyboardShortcutSection[] = [
  {
    title: 'Global',
    bindings: [
      { keys: ['Space'], label: 'Play / Pause' },
      { keys: ['M'], label: 'Mute / Unmute' },
      { keys: ['D'], label: 'Toggle dock' },
      { keys: ['N'], label: 'Spawn sweeper' },
      { keys: ['P'], label: 'Pattern selector' },
      { keys: ['E'], label: 'Node editor' },
      { keys: ['I'], label: 'Telemetry panel' },
      { keys: ['⌫'], label: 'Delete shape' },
      { keys: ['⌘', 'S'], label: 'Save config' },
      { keys: ['⌘', '↵'], label: 'Evaluate code' },
      { keys: ['?'], label: 'This menu' },
    ],
  },
  {
    title: 'Mouse',
    bindings: [
      { keys: ['⌘', 'scroll'], label: 'Sample rate' },
      { keys: ['scroll'], label: 'Rotate sweeper' },
      { keys: ['⇧', 'click'], label: 'Select shape' },
      { keys: ['drag'], label: 'Move shape' },
    ],
  },
  {
    title: 'Node Editor',
    dimWhenEditorClosed: true,
    caption: 'unlocks when the node editor is open',
    bindings: [
      { keys: ['⌫'], label: 'Delete node / cable' },
      { keys: ['Esc'], label: 'Close editor' },
    ],
  },
  {
    title: 'Knobs & Sidebar',
    bindings: [
      { keys: ['↑', '↓'], label: 'Adjust focused knob' },
      { keys: ['↵'], label: 'Collapse sidebar' },
    ],
  },
];

/** Public handle returned by initKeyboardShortcutsPanel(). */
export interface KeyboardShortcutsPanel {
  /** Expand ⇄ collapse the panel. */
  toggle(): void;
  /** Brighten (true) or dim (false) the Node Editor section. */
  setEditorActive(active: boolean): void;
}

// Module singletons so node-editor/panel.ts can drive dimming via the exported
// setEditorActive() without threading a handle through the call graph.
let editorSectionEl: HTMLElement | null = null;

/**
 * Build the panel DOM from KEYBOARD_SHORTCUTS, mount it to <body>, and return controls.
 * Idempotent-ish: intended to be called once during setup.
 */
export function initKeyboardShortcutsPanel(): KeyboardShortcutsPanel {
  const panel = document.createElement('aside');
  panel.id = 'keyboard-shortcuts-panel';
  panel.className = 'keyboard-shortcuts-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Keyboard shortcuts');

  // Content pane (rendered first so the tab ends up on the canvas-facing edge).
  const inner = document.createElement('div');
  inner.className = 'keyboard-shortcuts-inner';

  const header = document.createElement('header');
  header.className = 'keyboard-shortcuts-header';
  const title = document.createElement('span');
  title.className = 'keyboard-shortcuts-title';
  title.textContent = 'Keyboard Shortcuts';
  header.append(title);
  inner.appendChild(header);

  for (const section of KEYBOARD_SHORTCUTS) {
    const sec = document.createElement('section');
    sec.className = 'keyboard-shortcuts-section';
    if (section.dimWhenEditorClosed === true) {
      sec.classList.add('dimmable');
      editorSectionEl = sec;
    }

    const h = document.createElement('h3');
    h.className = 'keyboard-shortcuts-section-title';
    h.textContent = section.title;
    sec.appendChild(h);

    const dl = document.createElement('dl');
    dl.className = 'keyboard-shortcuts-list';
    for (const binding of section.bindings) {
      const dt = document.createElement('dt');
      for (const key of binding.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        dt.appendChild(kbd);
      }
      const dd = document.createElement('dd');
      dd.textContent = binding.label;
      dl.append(dt, dd);
    }
    sec.appendChild(dl);

    if (section.caption !== undefined) {
      const cap = document.createElement('p');
      cap.className = 'keyboard-shortcuts-caption';
      cap.textContent = section.caption;
      sec.appendChild(cap);
    }
    inner.appendChild(sec);
  }

  // Peek-tab — always visible on the canvas-facing (right) edge of the panel.
  const tab = document.createElement('button');
  tab.id = 'keyboard-shortcuts-tab';
  tab.className = 'keyboard-shortcuts-tab';
  tab.type = 'button';
  tab.title = 'Toggle keyboard shortcuts  [ ? ]';
  tab.setAttribute('aria-expanded', 'true');
  const glyph = document.createElement('span');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = '?';
  tab.appendChild(glyph);

  panel.append(inner, tab);
  document.body.appendChild(panel);

  const toggle = (): void => {
    const collapsed = panel.classList.toggle('collapsed');
    tab.setAttribute('aria-expanded', String(!collapsed));
  };
  tab.addEventListener('click', toggle);

  return { toggle, setEditorActive };
}

/**
 * Brighten/dim the Node Editor section. Safe to call before init (no-op) and
 * imported directly by node-editor/panel.ts's open/close handlers.
 */
export function setEditorActive(active: boolean): void {
  if (editorSectionEl === null) return;
  editorSectionEl.classList.toggle('section-active', active);
}
