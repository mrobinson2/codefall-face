import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MorphTarget } from '@babylonjs/core/Morph/morphTarget';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager';

export type SpeechPose = { positions: number[]; normals: number[] };

export function animateMouth(mesh: Mesh, round: SpeechPose, spread: SpeechPose, closed?: SpeechPose) {
  const manager = new MorphTargetManager(mesh.getScene(), mesh.name);
  const createTarget = (name: string, pose: SpeechPose) => {
    const target = new MorphTarget(name, 0, mesh.getScene());
    target.setPositions(Float32Array.from(pose.positions));
    target.setNormals(Float32Array.from(pose.normals));
    manager.addTarget(target);
    return target;
  };
  // Keep one shader variant when syllables cross zero influence.
  manager.optimizeInfluencers = false;
  manager.areUpdatesFrozen = true;
  const rounded = createTarget('Rounded speech', round);
  const widened = createTarget('Spread speech', spread);
  const resting = closed ? createTarget('Closed jaw during speech', closed) : undefined;
  manager.areUpdatesFrozen = false;
  mesh.morphTargetManager = manager;

  return (open: number, wide: number, gap: number) => {
    rounded.influence = open;
    widened.influence = wide;
    if (resting) resting.influence = gap;
  };
}
