import {expect, test} from "bun:test";
import {
  MotionController,
  mixHexColors,
  terminalIsInteractive
} from "../../src/tui/motion.js";

test("motion is automatic from both terminal directions", () => {
  expect(terminalIsInteractive(true, true)).toBe(true);
  expect(terminalIsInteractive(true, false)).toBe(false);
  expect(terminalIsInteractive(false, true)).toBe(false);
  expect(terminalIsInteractive(undefined, undefined)).toBe(false);
});

test("state feedback colors settle exactly onto the destination token", () => {
  expect(mixHexColors("#79dc9a", "#9ab5b8", 0)).toBe("#79dc9a");
  expect(mixHexColors("#79dc9a", "#9ab5b8", 1)).toBe("#9ab5b8");
  expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
});

test("motion uses a controllable monotonic clock and becomes idle", () => {
  let now = 100;
  let value = 0;
  const motion = new MotionController({
    animated: true,
    requestFrame: () => {},
    now: () => now,
    autoSchedule: false
  });
  motion.animate("selection", 100, progress => {
    value = progress;
  });
  expect(value).toBe(0);
  expect(motion.idle).toBe(false);
  now = 150;
  motion.tick();
  expect(value).toBeGreaterThan(0.5);
  now = 200;
  motion.tick();
  expect(value).toBe(1);
  expect(motion.idle).toBe(true);
});

test("non-interactive motion snaps directly to its final state", () => {
  let value = 0;
  const motion = new MotionController({
    animated: false,
    requestFrame: () => {},
    autoSchedule: false
  });
  motion.animate("message", 180, progress => {
    value = progress;
  });
  expect(value).toBe(1);
  expect(motion.idle).toBe(true);
});

test("a repeating transition cycles until it is cancelled", () => {
  let now = 0;
  let completedCycles = 0;
  const motion = new MotionController({
    animated: true,
    requestFrame: () => {},
    now: () => now,
    autoSchedule: false
  });
  motion.repeat("connection", 100, progress => {
    if (progress === 1) completedCycles += 1;
  });

  now = 100;
  motion.tick();
  expect(completedCycles).toBe(1);
  expect(motion.idle).toBe(false);

  motion.cancel("connection");
  expect(motion.idle).toBe(true);
  now = 200;
  motion.tick();
  expect(completedCycles).toBe(1);
});

test("a repeating transition stays idle outside an interactive terminal", () => {
  let value = -1;
  const motion = new MotionController({
    animated: false,
    requestFrame: () => {},
    autoSchedule: false
  });
  motion.repeat("connection", 100, progress => {
    value = progress;
  });
  expect(value).toBe(0);
  expect(motion.idle).toBe(true);
});

test("disposing an animated repeat prevents all future updates", () => {
  let now = 0;
  let updates = 0;
  const motion = new MotionController({
    animated: true,
    requestFrame: () => {},
    now: () => now,
    autoSchedule: false
  });
  motion.repeat("connection", 100, () => {
    updates += 1;
  });
  expect(motion.idle).toBe(false);

  motion.dispose();
  const updatesAtDispose = updates;
  now = 200;
  motion.tick();

  expect(motion.idle).toBe(true);
  expect(updates).toBe(updatesAtDispose);
});
