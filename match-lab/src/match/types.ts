/** Match-space units, independent of the renderer: x 0–100, y 0–68.
 * The ball may cross the goal line (x -3–103). Times are replay milliseconds. */
export type Team = "home" | "away";
export type Action = "idle" | "run" | "pass" | "shoot";
export interface Position {
  x: number;
  y: number;
}
export interface PlayerState extends Position {
  id: string;
  team: Team;
  shirtNumber: number;
  goalkeeper: boolean;
  direction: number; // radians; zero faces the right-hand goal
  action: Action;
}
export interface BallState extends Position {
  height: number;
  ownerId?: string;
  motion: "possession" | "pass" | "shot" | "goal" | "reset";
}
export interface MatchFrame {
  timeMs: number;
  matchTimeSeconds: number;
  players: readonly PlayerState[];
  ball: BallState;
  score: { home: number; away: number };
}
export type EventKind =
  | "kickoff"
  | "reposition"
  | "shortPass"
  | "longPass"
  | "dribble"
  | "pressure"
  | "attack"
  | "shot"
  | "goal"
  | "reset"
  | "interception"
  | "counterAttack"
  | "throughBall"
  | "save";
export interface MatchEvent {
  id: string;
  timeMs: number;
  kind: EventKind;
  team: Team;
  from?: number;
  to?: number;
}
/** Contract: nonempty, strictly time-ordered frames, sorted events and stable player IDs. */
export interface ReplayData {
  id: string;
  durationMs: number;
  frames: readonly MatchFrame[];
  events: readonly MatchEvent[];
}
/** Presentation sample, never written back to the recorded replay. */
export interface RenderSample {
  frame: MatchFrame;
  frameIndex: number;
  nextFrameIndex: number;
  alpha: number;
  event?: MatchEvent;
}
