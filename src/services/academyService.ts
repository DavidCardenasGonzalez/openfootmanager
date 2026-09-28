import { invoke } from "@tauri-apps/api/core";
import type { GameStateData } from "../store/gameStore";

export interface AcademyCandidateView {
  id: string;
  full_name: string;
  date_of_birth: string;
  nationality: string;
  position: string;
  ovr: number;
  potential_low: number;
  potential_high: number;
  signing_fee: number;
  annual_wage: number;
}

export interface AcademyView {
  level: number;
  cycle: number;
  expires_on: string;
  signing_limit: number;
  signings_remaining: number;
  roster_size: number;
  roster_limit: number;
  next_candidates: number;
  next_signings: number;
  upgrade_cost: number;
  upgrade_available: boolean;
  candidates: AcademyCandidateView[];
}

export async function getAcademy(): Promise<AcademyView> {
  return invoke<AcademyView>("get_academy");
}
export async function signAcademyCandidate(candidateId: string): Promise<GameStateData> {
  return invoke<GameStateData>("sign_academy_candidate", { candidateId });
}
export async function rejectAcademyCandidate(candidateId: string): Promise<GameStateData> {
  return invoke<GameStateData>("reject_academy_candidate", { candidateId });
}
export async function upgradeYouthAcademy(): Promise<GameStateData> {
  return invoke<GameStateData>("upgrade_facility", { facility: "Youth" });
}
