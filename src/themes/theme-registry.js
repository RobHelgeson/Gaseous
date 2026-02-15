// theme-registry.js — Async JSON theme loading and switching

const THEME_IDS = ['nebula', 'inky'];

const themes = new Map();
let activeTheme = null;

/** Load all theme JSON files. Must be called during init before rendering. */
export async function loadThemes() {
  const results = await Promise.all(
    THEME_IDS.map(async (id) => {
      const resp = await fetch(`src/themes/${id}.json`);
      return resp.json();
    }),
  );
  for (const theme of results) {
    themes.set(theme.id, theme);
  }
  activeTheme = themes.get('nebula');
}

/** Get a theme by id */
export function getTheme(id) {
  return themes.get(id);
}

/** Get the currently active theme */
export function getActiveTheme() {
  return activeTheme;
}

/** Set the active theme by id. Returns the theme or null if not found. */
export function setActiveTheme(id) {
  const theme = themes.get(id);
  if (theme) {
    activeTheme = theme;
  }
  return theme;
}

/** List all registered theme ids */
export function listThemes() {
  return [...themes.keys()];
}
