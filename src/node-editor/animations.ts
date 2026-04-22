// src/node-editor/animations.ts
//
// Unit 12 — Gamified cable animations.
//
// Three tiny, dependency-free helpers that celebrate a completed
// cable connection in the node editor:
//
//   • snapPop(el)          — CSS scale bounce on a target port.
//   • particleTrail(path)  — 8 amber blips racing along an SVG path.
//   • hueFade(edge)        — stroke colour pulse copper → amber → copper.
//
// All three respect `prefers-reduced-motion: reduce` and stay entirely
// on the DOM / CSS / rAF side — no Strudel, no audio-loop interference.
//
// Helpers return a `() => void` cancel handle so callers can abort in-
// flight animations (useful on rapid graph churn or panel close).

// ── Shared helpers ───────────────────────────────────────────────────────────

export type CancelHandle = () => void;

const NOOP: CancelHandle = () => {};

/** True when the user has requested reduced motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Schedule a callback after `ms` milliseconds; returns a cancel fn. */
function after(ms: number, fn: () => void): CancelHandle {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

// ── snap-pop ─────────────────────────────────────────────────────────────────

export interface SnapPopOpts {
  /** Total animation duration (ms). Default 300. */
  duration?: number;
  /** Class name applied for the CSS keyframe. Default `ne-snap-pop`. */
  className?: string;
}

/**
 * Toggle a short scale oscillation on `el`. Idempotent across rapid calls —
 * removes and re-adds the class so the animation restarts cleanly.
 * Returns a cancel handle that strips the class early.
 *
 * Reduced motion: snaps to the final state (class removed) after 50ms.
 */
export function snapPop(el: Element, opts: SnapPopOpts = {}): CancelHandle {
  const className = opts.className ?? 'ne-snap-pop';

  if (prefersReducedMotion()) {
    // "50ms final-state snap" — toggle once so listeners see the class
    // transition, then strip it.
    el.classList.add(className);
    return after(50, () => el.classList.remove(className));
  }

  const duration = opts.duration ?? 300;
  // Re-trigger the CSS animation: remove, force a style read, re-add.
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);

  return after(duration, () => el.classList.remove(className));
}

// ── particle trail ───────────────────────────────────────────────────────────

export interface ParticleTrailOpts {
  /** Number of particles spawned evenly along the path. Default 8. */
  count?: number;
  /** Interval between spawns (ms). Default 50. */
  spawnStepMs?: number;
  /** Per-particle fade duration (ms). Default 300. */
  fadeMs?: number;
  /** Container element to append particles to. Defaults to path.ownerSVGElement's parent. */
  container?: Element;
}

/**
 * Spawn a set of small amber dots that race along `svgPath` and fade out.
 * Each particle is a 4px div positioned absolutely over the panel root.
 * Returns a cancel handle that aborts pending spawns and removes live dots.
 *
 * Reduced motion: no-op.
 */
export function particleTrail(svgPath: SVGPathElement, opts: ParticleTrailOpts = {}): CancelHandle {
  if (prefersReducedMotion()) return NOOP;

  // Guard for SSR / non-SVG environments.
  if (typeof svgPath.getPointAtLength !== 'function') return NOOP;

  const count       = opts.count ?? 8;
  const spawnStepMs = opts.spawnStepMs ?? 50;
  const fadeMs      = opts.fadeMs ?? 300;

  // Pick a container that is positioned and won't clip: the panel root.
  const container = opts.container
    ?? svgPath.ownerSVGElement?.parentElement
    ?? svgPath.ownerDocument?.body
    ?? null;
  if (container === null) return NOOP;

  let totalLen = 0;
  try {
    totalLen = svgPath.getTotalLength();
  } catch {
    return NOOP;
  }
  if (!Number.isFinite(totalLen) || totalLen <= 0) return NOOP;

  // We need the container's origin so we can position in its local coords.
  const containerBox = (container as HTMLElement).getBoundingClientRect?.()
                    ?? { left: 0, top: 0 };
  const svgBox       = svgPath.ownerSVGElement?.getBoundingClientRect?.()
                    ?? { left: 0, top: 0 };
  const offsetX = svgBox.left - containerBox.left;
  const offsetY = svgBox.top  - containerBox.top;

  const spawnTimers: ReturnType<typeof setTimeout>[] = [];
  const liveNodes:   HTMLElement[] = [];
  let cancelled = false;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1); // 0..1 along the path
    const spawnDelay = i * spawnStepMs;
    const timer = setTimeout(() => {
      if (cancelled) return;
      let pt: { x: number; y: number };
      try {
        pt = svgPath.getPointAtLength(t * totalLen);
      } catch {
        return;
      }
      const dot = svgPath.ownerDocument!.createElement('div');
      dot.classList.add('ne-particle-dot');
      dot.style.position      = 'absolute';
      dot.style.left          = `${pt.x + offsetX - 2}px`;
      dot.style.top           = `${pt.y + offsetY - 2}px`;
      dot.style.width         = '4px';
      dot.style.height        = '4px';
      dot.style.borderRadius  = '50%';
      dot.style.background    = 'var(--accent-amber)';
      dot.style.opacity       = '1';
      dot.style.pointerEvents = 'none';
      dot.style.transition    = `opacity ${fadeMs}ms linear`;
      dot.style.boxShadow     = '0 0 6px var(--accent-amber)';
      container.appendChild(dot);
      liveNodes.push(dot);

      // Kick the fade next frame.
      requestAnimationFrame(() => { dot.style.opacity = '0'; });

      // Remove after fade completes.
      setTimeout(() => {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
        const idx = liveNodes.indexOf(dot);
        if (idx !== -1) liveNodes.splice(idx, 1);
      }, fadeMs + 16);
    }, spawnDelay);
    spawnTimers.push(timer);
  }

  return () => {
    cancelled = true;
    for (const t of spawnTimers) clearTimeout(t);
    for (const n of liveNodes) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    liveNodes.length = 0;
  };
}

// ── hue fade ─────────────────────────────────────────────────────────────────

export interface HueFadeOpts {
  /** Total animation duration (ms). Default 600. */
  duration?: number;
  /** Class name driving the CSS colour transition. Default `ne-hue-fade`. */
  className?: string;
}

/**
 * Briefly fade an SVG edge's stroke from copper → amber → copper.
 * Implemented as a CSS class toggle so the colour curve lives in styles.css.
 *
 * Reduced motion: no-op.
 */
export function hueFade(edgeEl: Element, opts: HueFadeOpts = {}): CancelHandle {
  if (prefersReducedMotion()) return NOOP;

  const className = opts.className ?? 'ne-hue-fade';
  const duration  = opts.duration ?? 600;

  // Re-trigger the CSS animation via a class drop-and-add. For SVG
  // elements `offsetWidth` is undefined, so we read `getBBox` if present.
  edgeEl.classList.remove(className);
  const svg = edgeEl as unknown as { getBBox?: () => unknown };
  try { svg.getBBox?.(); } catch { /* jsdom / detached elements */ }
  edgeEl.classList.add(className);

  return after(duration, () => edgeEl.classList.remove(className));
}

// ── Auto-wire to graphChanged events (defensive, for pre-Unit-11 state) ──────
//
// Spec says: if cables.ts doesn't exist yet, register on a `graphChanged`
// CustomEvent listener on `#node-editor-panel`. The handler expects
// `event.detail` of shape `{ kind: 'edge-complete', portEl?, pathEl?, edgeEl? }`
// and fires the three helpers on whichever elements are present.

interface GraphChangedDetail {
  kind?: string;
  portEl?: Element | null;
  pathEl?: SVGPathElement | null;
  edgeEl?: Element | null;
}

let autoWired = false;

export function installGraphChangedAutoWire(root?: Element | null): CancelHandle {
  if (autoWired) return NOOP;
  const host = root
    ?? (typeof document !== 'undefined'
          ? document.getElementById('node-editor-panel')
          : null);
  if (host === null) return NOOP;

  const handler = (ev: Event): void => {
    const detail = (ev as CustomEvent<GraphChangedDetail>).detail ?? {};
    if (detail.kind !== 'edge-complete') return;
    if (detail.portEl) snapPop(detail.portEl);
    if (detail.pathEl) particleTrail(detail.pathEl);
    if (detail.edgeEl) hueFade(detail.edgeEl);
  };

  host.addEventListener('graphChanged', handler);
  autoWired = true;

  return () => {
    host.removeEventListener('graphChanged', handler);
    autoWired = false;
  };
}

/** Test-only helper — lets suites reset the auto-wire latch. */
export function _resetAutoWireForTests(): void {
  autoWired = false;
}
