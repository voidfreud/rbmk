import {
  CP_LIQUID,
  CP_STEAM,
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

/**
 * Fraction of node thermal power deposited directly in the coolant
 * (fast neutrons / gammas). Remainder goes through fuel and graphite
 * heat capacities and reaches the coolant via UA. ESTIMATED ~4%.
 */
const DIRECT_COOLANT_FRACTION = 0.04;

/** Homogeneous void fraction with a fixed slip ratio from steam quality. */
export function voidFromQuality(quality: number): number {
  if (quality <= 0) return 0;
  const x = Math.min(quality, 1);
  return 1 / (1 + ((1 - x) / x) * (RHO_G / RHO_F) * SLIP);
}

/**
 * March the coolant up the channel from heat that actually crosses into
 * the fluid, not raw fission power:
 *
 *   q = FUEL_UA*(Tf − Tc) + GRAPHITE_UA*(Tg − Tc) + f_direct * power
 *
 * Temperatures are the previous-step values already on the node (stable at
 * dt ≤ 0.1 s given fuel/graphite time constants). At equilibrium the UA
 * flows equal the non-direct power shares, so q → power and the enthalpy
 * march matches the old power-driven result. Fuel and graphite still
 * integrate their share of `power` against the updated coolant temp.
 *
 * nodePowers: thermal power deposited per node [W] (length N_AXIAL, index 0 = top).
 */
export function stepThermal(
  nodes: NodeState[],
  nodePowers: number[],
  flowFraction: number,
  dt: number,
): void {
  // Floor at 5% rated: zero flow would divide-by-zero the enthalpy march.
  // Full pump coastdown / LOCA waits on packages/sim-plant.
  const flow = Math.max(0.05, flowFraction) * FLOW_RATED;

  let h = H_INLET;
  for (let k = N_AXIAL - 1; k >= 0; k--) {
    const node = nodes[k]!;
    const power = nodePowers[k]!;
    // Heat to coolant from cladding/graphite UA (prev-step temps) + direct.
    const q =
      FUEL_UA * (node.fuelTemp - node.coolantTemp) +
      GRAPHITE_UA * (node.graphiteTemp - node.coolantTemp) +
      DIRECT_COOLANT_FRACTION * power;
    // Node-exit enthalpy; use mid-node value for local properties.
    const hMid = h + (0.5 * q) / flow;
    h += q / flow;

    let coolantTemp: number;
    let quality = 0;
    if (hMid < H_F) {
      coolantTemp = T_INLET + (hMid - H_INLET) / CP_LIQUID;
      coolantTemp = Math.min(coolantTemp, T_SAT);
    } else if (hMid < H_F + H_FG) {
      coolantTemp = T_SAT;
      quality = (hMid - H_F) / H_FG;
    } else {
      // Superheat / post-dryout: fully dry steam, temperature above T_SAT.
      quality = 1;
      coolantTemp = T_SAT + (hMid - H_F - H_FG) / CP_STEAM;
    }
    node.coolantTemp = coolantTemp;
    node.quality = quality;

    const targetVoid = voidFromQuality(quality);
    // Implicit relaxation: stable for any dt (equilibriumThermal uses 60 s).
    const r = dt / TAU_VOID;
    node.voidFrac = (node.voidFrac + r * targetVoid) / (1 + r);

    // Fuel: heated by non-graphite, non-direct share; cooled to coolant.
    const fuelPower =
      power * (1 - GRAPHITE_POWER_FRACTION - DIRECT_COOLANT_FRACTION);
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
