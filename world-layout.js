/* Shared scene layout. Parameter-space sampling keeps cameras and copy aligned. */
export const ANCHORS = [
  { cam: [0, 1.2, 20], tgt: [0, 0, 0] },
  { cam: [14, 2.2, 4], tgt: [12.5, 4.5, -9] },
  { cam: [23, -1.2, -15], tgt: [23, -1.2, -30] },
  { cam: [35, 5, -33], tgt: [35, 5, -46] },
  { cam: [45, 1, -52], tgt: [45, 3, -62] },
  { cam: [56, 0.6, -73], tgt: [58, 0, -88] },
  { cam: [67, 0.2, -94], tgt: [81, -0.4, -109] }
];

export const AT = {
  core: [0, 0, 0],
  shards: [12.5, 4.5, -9],
  knot: [23, -1.2, -30],
  orbit: [35, 5, -46],
  swarm: [45, 3, -62],
  products: [58, 0, -88],
  portal: [81, -0.4, -109]
};

export const CHAPTER_LABELS = ['Genesis', 'Shards', 'Flow', 'Orbit', 'Swarm', 'Products', 'Portal'];
export const CHAPTER_KEYS = ['genesis', 'shards', 'flow', 'orbit', 'swarm', 'products', 'portal'];

export function chapterProgress(index, count = ANCHORS.length) {
  if (!Number.isInteger(count) || count < 2 || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError('Chapter index must be within the camera path');
  }
  return index / (count - 1);
}

// Always width 0.25, centered at i / (N - 1). Adjacent windows intentionally overlap.
export const WINDOWS = ANCHORS.map((_, i) => {
  const center = chapterProgress(i);
  return [center - 0.125, center + 0.125];
});

export function chapterFade(t) {
  const smooth = value => {
    const x = Math.max(0, Math.min(1, value));
    return x * x * (3 - 2 * x);
  };
  return { rise: smooth(t * 2), fall: smooth((1 - t) * 2) };
}

export function activeChapter(progress) {
  return Math.max(0, Math.min(ANCHORS.length - 1, Math.round(progress * (ANCHORS.length - 1))));
}

export function chapterFocusWeight(progress, index, count) {
  const distance = Math.abs(progress * (count - 1) - index);
  const t = Math.max(0, Math.min(1, (distance - 0.35) / 0.6));
  return 1 - t * t * (3 - 2 * t);
}

export function createChapterFocus(groups) {
  const entries = groups.map(group => {
    const materials = new Map();
    group.traverse(node => {
      for (const material of [node.material].flat().filter(Boolean)) {
        if (!materials.has(material)) materials.set(material, {
          opacity: material.uniforms?.uOpacity?.value ?? material.opacity,
          depthWrite: material.depthWrite
        });
      }
    });
    return { group, materials };
  });
  return {
    update(progress) {
      entries.forEach(({ group, materials }, index) => {
        const weight = chapterFocusWeight(progress, index, entries.length);
        group.visible = weight > 0.001;
        for (const [material, original] of materials) {
          if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = original.opacity * weight;
          else material.opacity = original.opacity * weight;
          material.depthWrite = original.depthWrite && weight >= 0.999;
        }
      });
    }
  };
}
