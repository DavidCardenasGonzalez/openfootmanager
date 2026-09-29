import { expect, it } from "vitest";
import { playerPose } from "./playerPose";
it("articulates knees and opposing arms with a deterministic looping stride", () => {
  const a = playerPose(0, true, 1, 0, false);
  const b = playerPose(160, true, 1, 0, false);
  expect(a.legs).not.toEqual(b.legs);
  expect(a.arms).not.toEqual(b.arms);
  expect(playerPose(640, true, 1, 0, false)).toEqual(a);
  expect(playerPose(300, false, 1, 0, false)).toEqual(playerPose(0, false, 1, 0, false));
});
it("mirrors direction, extends the striking foot and raises hands for celebrations", () => {
  const idle = playerPose(0, false, 1, 0, false);
  const kick = playerPose(0, false, 1, 7, false);
  expect(kick.legs[1][2][0]).toBeGreaterThan(idle.legs[1][2][0]);
  const raised = playerPose(0, false, 1, 0, true);
  expect(raised.arms[0][2][1]).toBeLessThan(raised.arms[0][0][1]);
  const left = playerPose(160, true, -1, 0, false);
  const right = playerPose(160, true, 1, 0, false);
  expect(left.legs[0][2][0]).not.toBe(right.legs[0][2][0]);
});
it("keeps running feet in separate lanes and elbows close throughout the stride", () => {
  for (const side of [-1, 1]) {
    for (let time = 0; time < 640; time += 16) {
      const pose = playerPose(time, true, side, 0, false);
      expect(pose.legs[0][2][0]).toBeLessThan(-1);
      expect(pose.legs[1][2][0]).toBeGreaterThan(1);
      for (const [, elbow, hand] of pose.arms) {
        expect(Math.abs(elbow[0])).toBeLessThanOrEqual(10);
        expect(Math.abs(hand[0])).toBeLessThanOrEqual(10);
      }
      for (const [hip, knee, ankle] of pose.legs) {
        // The knee must follow the foot, rather than bending sideways against it.
        expect((knee[0] - hip[0]) * (ankle[0] - hip[0])).toBeGreaterThanOrEqual(0);
      }
    }
  }
});
