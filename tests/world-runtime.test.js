import assert from 'node:assert/strict';
import test from 'node:test';
import { Clock } from '../vendor/three.module.js';
import { FrameBudget, discardClockDelta } from '../world-runtime.js';

test('frame guard measures seconds as milliseconds and waits for all 90 frames', () => {
  const guard = new FrameBudget();
  for (let i = 0; i < 89; i++) assert.equal(guard.observe(0.03), false);
  assert.equal(guard.throttled, false);
  assert.equal(guard.observe(0.03), true);
  assert.equal(guard.throttled, true);
  assert.equal(guard.observe(0.2), false, 'only one downgrade');
});

test('healthy windows and exactly 27ms do not downgrade while severe frames retain their actual duration', () => {
  const guard = new FrameBudget();
  for (let i = 0; i < 90; i++) assert.equal(guard.observe(0.027), false);
  assert.equal(guard.throttled, false);
  for (let i = 0; i < 90; i++) assert.equal(guard.observe(1 / 60), false);
  for (let i = 0; i < 89; i++) assert.equal(guard.observe(0.026), false);
  assert.equal(guard.observe(0.2), true, 'raw long frame is not capped to simulation delta');
});

test('visibility reset starts a fresh measurement window and does not undo an existing downgrade', () => {
  const guard = new FrameBudget();
  for (let i = 0; i < 89; i++) guard.observe(0.04);
  guard.resetWindow();
  for (let i = 0; i < 90; i++) assert.equal(guard.observe(0.01), false);
  for (const bad of [NaN, Infinity, -1]) assert.equal(guard.observe(bad), false);
  for (let i = 0; i < 90; i++) guard.observe(0.04);
  guard.resetWindow();
  assert.equal(guard.throttled, true);
});

test('discarding a background delta preserves Three clock animation phase', () => {
  const clock = new Clock();
  clock.start();
  clock.elapsedTime = 12.5;
  clock.oldTime -= 120000;
  discardClockDelta(clock);
  assert.equal(clock.elapsedTime, 12.5);
  assert.ok(clock.getDelta() < 0.1);
  assert.ok(clock.elapsedTime < 12.6);
});
