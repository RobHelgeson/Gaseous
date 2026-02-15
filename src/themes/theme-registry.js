// theme-registry.js — Theme lookup and registration

import { nebulaTheme } from './nebula-theme.js';

const themes = new Map();
themes.set(nebulaTheme.id, nebulaTheme);

/** Get a theme by id */
export function getTheme(id) {
  return themes.get(id);
}

/** Register a new theme */
export function registerTheme(theme) {
  themes.set(theme.id, theme);
}

/** Get the currently active theme (MVP: always nebula) */
export function getActiveTheme() {
  return nebulaTheme;
}

/** List all registered theme ids */
export function listThemes() {
  return [...themes.keys()];
}
