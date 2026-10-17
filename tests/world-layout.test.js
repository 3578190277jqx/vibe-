import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { ANCHORS, AT, CHAPTER_LABELS, CHAPTER_KEYS, WINDOWS, chapterProgress, chapterFade, activeChapter } from '../world-layout.js';
import { createProductShowcase, animateProducts } from '../world-products.js';

test('seven chapter centers reach their camera anchors and Products precedes Portal', () => {
  assert.deepEqual(CHAPTER_KEYS, ['genesis', 'shards', 'flow', 'orbit', 'swarm', 'products', 'portal']);
  assert.deepEqual(CHAPTER_LABELS, ['Genesis', 'Shards', 'Flow', 'Orbit', 'Swarm', 'Products', 'Portal']);
  assert.equal(ANCHORS.length, 7);
  const curve = new THREE.CatmullRomCurve3(ANCHORS.map(a => new THREE.Vector3(...a.cam)), false, 'centripetal', 0.5);
  for (let i = 0; i < 7; i++) {
    assert.equal(chapterProgress(i), i / 6);
    assert.ok(curve.getPoint(chapterProgress(i)).distanceTo(new THREE.Vector3(...ANCHORS[i].cam)) < 1e-9);
  }
  assert.deepEqual(ANCHORS[5].tgt, AT.products);
  assert.deepEqual(ANCHORS[6].tgt, AT.portal);
  for (const i of [5, 6]) {
    const spacing = new THREE.Vector3(...ANCHORS[i].cam).distanceTo(new THREE.Vector3(...ANCHORS[i - 1].cam));
    const distance = new THREE.Vector3(...ANCHORS[i].cam).distanceTo(new THREE.Vector3(...ANCHORS[i].tgt));
    assert.ok(spacing >= 21 && spacing <= 24);
    assert.ok(distance >= 12 && distance <= 21);
  }
});

test('every text window has width 0.25 around i/6, including both endpoints', () => {
  assert.equal(WINDOWS.length, 7);
  for (let i = 0; i < 7; i++) {
    const [a, b] = WINDOWS[i];
    assert.ok(Math.abs(b - a - 0.25) < 1e-12);
    assert.ok(Math.abs((a + b) / 2 - i / 6) < 1e-12);
    if (i) assert.ok(Math.abs(WINDOWS[i - 1][1] - a - 1 / 12) < 1e-12);
  }
  assert.deepEqual(WINDOWS[0], [-0.125, 0.125]);
  assert.deepEqual(WINDOWS[6], [0.875, 1.125]);
  assert.throws(() => chapterProgress(7), RangeError);
  assert.throws(() => chapterProgress(-1), RangeError);
});

test('three assembled products use supplied materials and remain separate rotating objects', () => {
  const materials = { body: new THREE.MeshBasicMaterial(), trim: new THREE.MeshBasicMaterial(), detail: new THREE.MeshBasicMaterial() };
  const { group, items } = createProductShowcase(materials);
  assert.equal(group.children.length, 3);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(p => p.name), ['portable-speaker', 'fragrance-bottle', 'desk-lamp']);
  for (const item of items) {
    assert.ok(item.children.length >= 4);
    let meshCount = 0;
    item.traverse(node => {
      if (!node.isMesh) return;
      meshCount++;
      assert.ok(Object.values(materials).includes(node.material));
      assert.ok(node.geometry.getAttribute('position').count > 0);
    });
    assert.ok(meshCount >= 4);
    const size = new THREE.Box3().setFromObject(item).getSize(new THREE.Vector3());
    assert.ok(size.y > 2 && size.y < 6);
  }
  animateProducts(items, 1);
  const initial = items.map(p => p.rotation.y);
  animateProducts(items, 2);
  assert.ok(items.every((p, i) => p.rotation.y !== initial[i]));
  const scale = items.map(p => p.scale.toArray());
  animateProducts(items, 10);
  assert.deepEqual(items.map(p => p.scale.toArray()), scale);
});

test('seven-chapter transition midpoints keep overlapping text dim and select one indicator', () => {
  const outgoing = chapterFade(5 / 6);
  const incoming = chapterFade(1 / 6);
  assert.ok(Math.abs(outgoing.rise * outgoing.fall - 7 / 27) < 1e-12);
  assert.ok(Math.abs(incoming.rise * incoming.fall - 7 / 27) < 1e-12);
  assert.deepEqual(chapterFade(0.5), { rise: 1, fall: 1 });
  assert.equal(chapterFade(0).rise, 0);
  assert.equal(chapterFade(1).fall, 0);
  assert.equal(activeChapter(0.75), 5);
  assert.equal(activeChapter(0), 0);
  assert.equal(activeChapter(1), 6);
  for (let i = 0; i < 7; i++) assert.equal(activeChapter(i / 6), i);
});
