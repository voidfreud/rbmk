import { N_AXIAL, N_DELAYED_GROUPS } from "./constants";

/** One axial node of the core. All arrays in CoreState are length N_AXIAL. */
export interface NodeState {
  /** Relative neutron flux, 1.0 = node at core-average full-power flux. */
  flux: number;
  /** Delayed neutron precursor concentrations, one per group (scaled units). */
  precursors: number[];
  /** I-135 number density [atoms/cm^3]. */
  iodine: number;
  /** Xe-135 number density [atoms/cm^3]. */
  xenon: number;
  /** Fuel temperature [degC]. */
  fuelTemp: number;
  /** Graphite temperature [degC]. */
  graphiteTemp: number;
  /** Coolant temperature [degC]. */
  coolantTemp: number;
  /** Steam quality (mass fraction), 0 below boiling boundary. */
  quality: number;
  /** Void fraction 0..1 (relaxed toward equilibrium). */
  voidFrac: number;
}

export type RodGroup = "manual" | "auto" | "shortened" | "emergency";

export interface RodState {
  id: number;
  group: RodGroup;
  /** Insertion 0 (fully withdrawn) .. 1 (fully inserted). */
  insertion: number;
  /** Target insertion the drive is moving toward. */
  target: number;
  /** Lattice position [pitch units from core center]; cosmetic in the 1D
   * axial model (all rods act core-wide), used by the UI cartogram. */
  x: number;
  y: number;
}

export interface DecayHeatState {
  /** Decay-heat group powers [W]. */
  groups: number[];
}

export interface CoreState {
  /** Simulation time [s]. */
  time: number;
  nodes: NodeState[];
  rods: RodState[];
  decayHeat: DecayHeatState;
  /** Uniform base reactivity found by criticality calibration. */
  rhoBase: number;
  /** Extra operator-controlled reactivity (boron, fresh fuel etc.), usually 0. */
  rhoExtra: number;
  /** Pump flow as a fraction of rated (0..1.2). */
  flowFraction: number;
  /** True after AZ-5 latched. */
  scrammed: boolean;
}

/** Per-node reactivity breakdown from the last step, for instruments/UI. */
export interface ReactivityBreakdown {
  rods: number[];
  voidFeedback: number[];
  doppler: number[];
  graphite: number[];
  xenon: number[];
  /** Global flux-squared-weighted net reactivity (dollars need /BETA_EFF). */
  netGlobal: number;
}

export interface SimEvent {
  t: number;
  level: "info" | "warn" | "alarm";
  code: string;
  msg: string;
  data?: Record<string, unknown>;
}

export function zeroNode(): NodeState {
  return {
    flux: 0,
    precursors: new Array(N_DELAYED_GROUPS).fill(0),
    iodine: 0,
    xenon: 0,
    fuelTemp: 270,
    graphiteTemp: 270,
    coolantTemp: 270,
    quality: 0,
    voidFrac: 0,
  };
}

export function assertNodeCount(nodes: NodeState[]): void {
  if (nodes.length !== N_AXIAL) {
    throw new Error(`expected ${N_AXIAL} axial nodes, got ${nodes.length}`);
  }
}
