// src/theme.ts
//
// Dark/light theme management — CSS variable updates and canvas color lookup.

import type { AppTheme, CanvasThemeColors } from './state';
import { CANVAS_THEMES } from './state';

export function setTheme(
  theme: AppTheme,
  btn: HTMLButtonElement,
): void {
  document.documentElement.dataset['theme'] = theme === 'light' ? 'light' : '';
  btn.textContent = theme === 'light' ? '◑' : '☀';
  btn.setAttribute(
    'aria-label',
    theme === 'light' ? 'Switch to Martian Dusk' : 'Switch to Daylight',
  );
  btn.title = theme === 'light' ? 'Martian Dusk theme' : 'Daylight theme';
}

export function getCanvasColors(theme: AppTheme): CanvasThemeColors {
  return CANVAS_THEMES[theme];
}
