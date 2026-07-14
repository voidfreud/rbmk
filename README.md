# rbmk

An RBMK-1000 reactor simulator with real physics, written from scratch in
TypeScript (Bun). The reactor core is a 1D axial nodal model: six delayed
neutron groups, iodine/xenon poisoning, boiling-channel void feedback,
Doppler and graphite temperature feedback, decay heat, and control rods
with the pre-1986 graphite displacer geometry - so the infamous positive
scram effect emerges from geometry rather than being scripted.

```sh
bun test              # physics validation suite
bun run scripts/demo.ts   # "a shift at the plant" demo scenario
```

The demo takes the plant from steady full power down to 50%, holds it there
against the xenon transient with a simple shift-operator heuristic, climbs
back out of the pit, and ends the shift with AZ-5.

Physics constants live in `packages/sim-core/src/constants.ts` with units
and source notes. The simulation core is a pure, dependency-free package;
UI and plant systems (hydraulics, turbine, grid) are future packages that
will subscribe to it.
