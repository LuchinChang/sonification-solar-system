// src/__tests__/theme.test.ts
//
// Tests for theme management.

import { describe, it, expect } from 'vitest';
import { getCanvasColors } from '../theme';
import { CANVAS_THEMES } from '../state';

describe('getCanvasColors', () => {
  it('returns dark theme palette', () => {
    const colors = getCanvasColors('dark');
    expect(colors).toBe(CANVAS_THEMES.dark);
    expect(colors.bg).toBe('#120F0E');
  });

  it('returns light theme palette', () => {
    const colors = getCanvasColors('light');
    expect(colors).toBe(CANVAS_THEMES.light);
    expect(colors.bg).toBe('#F0EDE6');
  });

  it('dark sun core is orange', () => {
    expect(getCanvasColors('dark').sunCore).toBe('#FFA030');
  });

  it('light sun core is darker orange', () => {
    expect(getCanvasColors('light').sunCore).toBe('#F08010');
  });
});
