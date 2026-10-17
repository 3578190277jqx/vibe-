import * as THREE from './vendor/three.module.js';

/* Geometry only: the caller supplies and registers all animated materials. */
export function createProductShowcase({ body, trim, detail }) {
  const group = new THREE.Group();
  group.name = 'product-showcase';
  const items = [];
  const specs = [
    { name: 'portable-speaker', x: -3.25, yaw: -0.22, speed: 0.16 },
    { name: 'fragrance-bottle', x: 0, yaw: 0.12, speed: -0.13 },
    { name: 'desk-lamp', x: 3.25, yaw: 0.18, speed: 0.19 }
  ];
  for (const [i, spec] of specs.entries()) {
    const product = new THREE.Group();
    product.name = spec.name;
    product.position.set(spec.x, 0.7, i === 1 ? -0.4 : 0);
    product.rotation.y = spec.yaw;
    product.userData = { baseY: product.position.y, baseYaw: spec.yaw, speed: spec.speed, phase: i * 2.1 };
    group.add(product);
    items.push(product);
  }
  const add = (parent, geometry, material, x = 0, y = 0, z = 0, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    parent.add(mesh);
    return mesh;
  };

  const [speaker, bottle, lamp] = items;
  add(speaker, new THREE.CylinderGeometry(0.88, 0.88, 2.55, 32), body);
  add(speaker, new THREE.CylinderGeometry(0.9, 0.9, 0.16, 32), trim, 0, 1.3);
  add(speaker, new THREE.CylinderGeometry(0.9, 0.9, 0.16, 32), trim, 0, -1.3);
  const grille = new THREE.TorusGeometry(0.895, 0.025, 6, 40);
  for (let i = 0; i < 9; i++) add(speaker, grille, trim, 0, -1.05 + i * 0.26, 0, Math.PI / 2);
  add(speaker, new THREE.TorusGeometry(0.58, 0.065, 8, 28, Math.PI), trim, 0, 1.35);
  add(speaker, new THREE.BoxGeometry(0.18, 0.05, 0.05), detail, 0, 0, 0.9);

  add(bottle, new THREE.CylinderGeometry(0.87, 0.87, 2.1, 8), body, 0, -0.25);
  add(bottle, new THREE.CylinderGeometry(0.34, 0.87, 0.4, 8), body, 0, 1);
  add(bottle, new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16), trim, 0, 1.3);
  add(bottle, new THREE.BoxGeometry(0.85, 0.48, 0.85), trim, 0, 1.65);
  add(bottle, new THREE.BoxGeometry(1.02, 0.65, 0.06), trim, 0, -0.22, 0.82);
  for (let i = 0; i < 3; i++) add(bottle, new THREE.BoxGeometry(0.58 - i * 0.12, 0.035, 0.025), detail, 0, -0.07 - i * 0.14, 0.87);

  add(lamp, new THREE.CylinderGeometry(1.05, 1.15, 0.22, 32), trim, 0, -1.4);
  add(lamp, new THREE.CylinderGeometry(0.09, 0.09, 2.55, 12), body, 0, -0.05);
  add(lamp, new THREE.CylinderGeometry(0.4, 1.15, 0.95, 32), body, 0, 1.4);
  add(lamp, new THREE.CircleGeometry(1.05, 32), detail, 0, 0.92, 0, Math.PI / 2);
  add(lamp, new THREE.TorusGeometry(1.14, 0.04, 8, 40), trim, 0, 0.92, 0, Math.PI / 2);
  add(lamp, new THREE.SphereGeometry(0.24, 16, 12), detail, 0, 0.81);

  const plinth = new THREE.CylinderGeometry(1.25, 1.38, 0.16, 32);
  for (const product of items) add(product, plinth, body, 0, -1.62);
  return { group, items };
}

export function animateProducts(items, time) {
  for (const product of items) {
    const { baseY, baseYaw, speed, phase } = product.userData;
    product.rotation.y = baseYaw + time * speed;
    product.rotation.z = Math.sin(time * 0.3 + phase) * 0.035;
    product.position.y = baseY + Math.sin(time * 0.7 + phase) * 0.16;
  }
}
