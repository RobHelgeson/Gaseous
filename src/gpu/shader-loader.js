// shader-loader.js — Loads WGSL shader files and prepends shared structs

let sharedStructs = null;

export async function loadSharedStructs() {
  const resp = await fetch('src/shaders/shared-structs.wgsl');
  sharedStructs = await resp.text();
}

export async function loadShader(path) {
  const resp = await fetch(path);
  const code = await resp.text();
  return code;
}

/** Load a shader that needs shared struct definitions prepended */
export async function loadComputeShader(path) {
  if (!sharedStructs) await loadSharedStructs();
  const code = await loadShader(path);
  return sharedStructs + '\n' + code;
}

/** Load a shader that needs shared struct definitions prepended */
export async function loadParticleShader(path) {
  if (!sharedStructs) await loadSharedStructs();
  const code = await loadShader(path);
  return sharedStructs + '\n' + code;
}
