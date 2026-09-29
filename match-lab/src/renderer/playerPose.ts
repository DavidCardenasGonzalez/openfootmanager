export type Joint = readonly [number, number];
export type Limb = readonly [Joint, Joint, Joint];
/** Native-pixel joints. A full stride is 640 ms; seeking never depends on past frames. */
export function playerPose(
  time: number,
  running: boolean,
  side: number,
  kick: number,
  raised: boolean,
  direction: { x: number; y: number } = { x: side, y: 0 },
) {
  const phase = running ? Math.sin(((time % 640) / 640) * Math.PI * 2) : 0;
  const legs: Limb[] = [];
  const angle = ((time % 640) / 640) * Math.PI * 2;
  const arms: Limb[] = [];
  for (const sign of [-1, 1]) {
    const stride = phase * sign;
    const strike = sign === side ? kick : 0;
    // Feet stay on their own side of the hips. Forward/back travel is
    // projected along the heading; the recovery foot lifts rather than crossing.
    const lift = running ? Math.max(0, Math.cos(angle) * sign) * 4 : 0;
    const travelX = direction.x * stride;
    const travelY = direction.y * stride;
    legs.push([
      [sign * 4, -21],
      [sign * 4 + travelX * 1.5 + side * strike * 0.6, -12 + travelY - lift * 0.4],
      [sign * 4 + travelX * 2.5 + side * strike * 2, -2 + travelY * 2 - lift - Math.abs(strike)],
    ]);
    arms.push([
      [sign * 7, -35],
      [sign * 8 - travelX * 1.5, raised ? -43 : -28],
      [
        raised ? sign * 11 : sign * 7 - travelX * 2.5,
        raised ? -49 : running ? -31 - stride * 1.5 : -25,
      ],
    ]);
  }
  return { legs, arms };
}
