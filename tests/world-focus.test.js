import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { chapterFocusWeight, createChapterFocus } from '../world-layout.js';

test('scene focus isolates every chapter at its own camera anchor and overlaps smoothly between anchors', () => {
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) assert.equal(chapterFocusWeight(i / 6, j, 7), i === j ? 1 : 0);
  }
  const midpoint = 1 / 12;
  const first = chapterFocusWeight(midpoint, 0, 7);
  assert.ok(first > 0 && first < 1);
  assert.equal(first, chapterFocusWeight(midpoint, 1, 7));
  assert.equal(chapterFocusWeight(midpoint, 2, 7), 0);
  assert.ok(chapterFocusWeight(0.01, 0, 7) > chapterFocusWeight(0.1, 0, 7));
});

test('scene focus fades unique shader and glow materials without compounding shared meshes or changing geometry', () => {
  const first = new THREE.Group(), second = new THREE.Group();
  const shader = new THREE.ShaderMaterial({ uniforms: { uOpacity: { value: 0.52 } } });
  const geometry = new THREE.BoxGeometry();
  first.add(new THREE.Mesh(geometry, shader), new THREE.Mesh(geometry, shader));
  const glow = new THREE.SpriteMaterial({ opacity: 0.2, depthWrite: false });
  first.add(new THREE.Sprite(glow));
  second.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const focus = createChapterFocus([first, second]);
  const position = first.position.toArray(), scale = first.scale.toArray();
  focus.update(0.5);
  const weight = chapterFocusWeight(0.5, 0, 2);
  assert.equal(shader.uniforms.uOpacity.value, 0.52 * weight);
  assert.equal(glow.opacity, 0.2 * weight);
  assert.equal(shader.depthWrite, false);
  focus.update(0.5);
  assert.equal(shader.uniforms.uOpacity.value, 0.52 * weight);
  focus.update(0);
  assert.equal(shader.uniforms.uOpacity.value, 0.52);
  assert.equal(shader.depthWrite, true);
  assert.equal(first.visible, true);
  assert.equal(second.visible, false);
  focus.update(1);
  assert.equal(first.visible, false);
  assert.equal(second.visible, true);
  assert.deepEqual(first.position.toArray(), position);
  assert.deepEqual(first.scale.toArray(), scale);
});
