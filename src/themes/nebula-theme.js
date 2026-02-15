// nebula-theme.js — Nebula theme: luminous gas clouds with additive blending

export const nebulaTheme = {
  id: 'nebula',
  name: 'Nebula',

  colors: {
    palette: [
      [0.9, 0.2, 0.4],  // Ruby
      [0.2, 0.4, 0.9],  // Sapphire
      [0.1, 0.8, 0.5],  // Emerald
      [0.8, 0.3, 0.9],  // Amethyst
      [0.9, 0.7, 0.1],  // Topaz
      [0.1, 0.7, 0.9],  // Aquamarine
    ],
    mixMode: 'additive',
  },

  rendering: {
    fragmentShader: 'src/shaders/nebula-fragment.wgsl',
    backgroundShader: 'src/shaders/nebula-background.wgsl',
    blendState: {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    },
    particleScale: 1.0,
    glowFalloff: 2.5,
  },

  background: {
    clearColor: [0.01, 0.005, 0.02, 1.0],
    starDensity: 0.003,
    starBrightness: 0.8,
    nebulaGlow: 0.15,
  },

  cycle: {
    fadeOutDuration: 3.0,
    fadeInDuration: 2.0,
    transitionStyle: 'sequential',
  },
};
