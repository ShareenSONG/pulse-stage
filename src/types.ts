export type Mode = "XY" | "Z0" | "Z1";
export type Input = "camera" | "keyboard";
export type Direction = "toward_camera" | "away_from_camera";
export type Kind = "catch" | "slash" | "double" | "sway" | "pulse" | "step";
export type Grade =
  | "Perfect"
  | "Great"
  | "Good"
  | "Miss"
  | "Wrong Direction"
  | "Protected";
export interface Point {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}
export interface Note {
  id: string;
  time: number;
  kind: Kind;
  hand?: "left" | "right";
  x: number;
  y: number;
  direction?: Direction;
  dx?: number;
  dy?: number;
}
export interface Chart {
  id: string;
  version: string;
  duration: number;
  bpm: number;
  mode: Mode;
  notes: Note[];
  ruleVersion?: string;
  title?: string;
}
export interface Action {
  id: string;
  time: number;
  kind: "hand" | "sway" | "depth";
  hand?: "left" | "right";
  x?: number;
  y?: number;
  prevTime?: number;
  prevX?: number;
  prevY?: number;
  dx?: number;
  dy?: number;
  speed?: number;
  direction?: Direction;
  directionConfidence?: number;
  confidence: number;
}
export interface Calibration {
  version: string;
  profile?: "upper-body" | "full-body";
  centerX: number;
  centerY: number;
  shoulder: number;
  torso: number;
  hip: number;
  ratio: number;
  reachX: number;
  reachY: number;
  z0: boolean;
  z1: boolean;
  threshold: number;
}
export interface MotionFrame {
  points: Point[];
  time: number;
  quality: number;
  depthQuality: number;
  scale: number;
  delta: number;
  status: string;
  reason: string;
  direction: Direction | "uncertain" | "stable";
  hands: { left: Point | null; right: Point | null };
  actions: Action[];
  confidence: number;
  processing: number;
}
export interface Judgement {
  note: Note;
  grade: Grade;
  error: number;
  action?: string;
  factor: number;
}
