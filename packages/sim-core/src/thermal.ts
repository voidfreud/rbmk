import {
  CP_LIQUID,
  FLOW_RATED,
  FUEL_HEAT_CAP,
  FUEL_UA,
  GRAPHITE_HEAT_CAP,
  GRAPHITE_POWER_FRACTION,
  GRAPHITE_UA,
  H_F,
  H_FG,
  H_INLET,
  N_AXIAL,
  RHO_F,
  RHO_G,
  SLIP,
  T_INLET,
  T_SAT,
  TAU_VOID,
} from "./constants";
import type { NodeState } from "./types";

/**
 * Thermal hydraulics, whole core lumped into one average channel stack.
 * Node index 0 is the TOP of the core; coolant enters at the BOTTOM
 * (index N_AXIAL-1) and boils on the way up.
 */

/** Homogeneous void fraction with a fixed slip ratio from steam quality. */
export function voidFromQuality(quality: number): number {
  if (quality <= 0) return 0;
  const x = Math.min(quality, 1);
  return 1 / (1 + ((1 - x) / x) * (RHO_G / RHO_F) * SLIP);
}

/**
 * March the coolant up the channel: per-node enthalpy from the thermal power
 * deposited below and in the node, giving coolant temperature, equilibrium
 * quality, and target void. Then relax actual void and integrate fuel and
 * graphite temperatures (semi-implicit).
 *
 * nodePowers: thermal power deposited per node [W] (length N_AXIAL, index 0 = top).
 */
export function stepThermal(
  nodes: NodeState[],
  nodePowers: number[],
  flowFraction: number,
  dt: number,
): void {
  const flow = Math.max(0.05, flowFraction) * FLOW_RATED;

  let h = H_INLET;
  for (let k = N_AXIAL - 1; k >= 0; k--) {
    const node = nodes[k]!;
    const power = nodePowers[k]!;
    // Node-exit enthalpy; use mid-node value for local properties.
    const hMid = h + (0.5 * power) / flow;
    h += power / flow;

    let coolantTemp: number;
    let quality = 0;
    if (hMid < H_F) {
      coolantTemp = T_INLET + (hMid - H_INLET) / CP_LIQUID;
      coolantTemp = Math.min(coolantTemp, T_SAT);
    } else {
      coolantTemp = T_SAT;
      quality = Math.min(1, (hMid - H_F) / H_FG);
    }
    node.coolantTemp = coolantTemp;
    node.quality = quality;

    const targetVoid = voidFromQuality(quality);
    // Implicit relaxation: stable for any dt (equilibriumThermal uses 60 s).
    const r = dt / TAU_VOID;
    node.voidFrac = (node.voidFrac + r * targetVoid) / (1 + r);

    // Fuel: heated by (most of) node power, cooled to coolant.
    const fuelPower = power * (1 - GRAPHITE_POWER_FRACTION);
    node.fuelTemp =
      (node.fuelTemp +
        (dt / FUEL_HEAT_CAP) * (fuelPower + FUEL_UA * coolantTemp)) /
      (1 + (dt * FUEL_UA) / FUEL_HEAT_CAP);

    // Graphite: small direct heating, very slow cooling to channel.
    const graphitePower = power * GRAPHITE_POWER_FRACTION;
    node.graphiteTemp =
      (node.graphiteTemp +
        (dt / GRAPHITE_HEAT_CAP) * (graphitePower + GRAPHITE_UA * coolantTemp)) /
      (1 + (dt * GRAPHITE_UA) / GRAPHITE_HEAT_CAP);
  }
}

/** Steady-state thermal fields for a given power distribution and flow. */
export function equilibriumThermal(
  nodes: NodeState[],
  nodePowers: number[],
  flowFraction: number,
): void {
  // Iterate the relaxation to convergence with a big timestep.
  for (let i = 0; i < 400; i++) {
    stepThermal(nodes, nodePowers, flowFraction, 60);
  }
}
