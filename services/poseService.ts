
import { Pose, MatchResult } from "../types";

export function evaluatePoseOffline(landmarks: any[], targetPose: Pose): MatchResult {
  if (!landmarks || landmarks.length === 0) {
    return { matched: false, score: 0, feedback: "No body detected. Stand back!" };
  }

  // Helper to get landmark by index
  const getLM = (index: number) => landmarks[index];

  // Key landmarks
  const nose = getLM(0);
  const lShoulder = getLM(11);
  const rShoulder = getLM(12);
  const lElbow = getLM(13);
  const rElbow = getLM(14);
  const lWrist = getLM(15);
  const rWrist = getLM(16);
  const lHip = getLM(23);
  const rHip = getLM(24);

  let isMatch = false;
  let score = 0;
  let feedback = "Try harder!";

  // Note: MediaPipe Y-axis is 0 at top, 1 at bottom.
  // Wrist above shoulder means wrist.y < shoulder.y

  switch (targetPose.id) {
    case 't-pose':
      // Arms horizontal: wrists near shoulder height and far from center
      const lArmHoriz = Math.abs(lWrist.y - lShoulder.y) < 0.15;
      const rArmHoriz = Math.abs(rWrist.y - rShoulder.y) < 0.15;
      const spread = Math.abs(lWrist.x - rWrist.x) > 0.4;
      isMatch = lArmHoriz && rArmHoriz && spread;
      score = isMatch ? 95 : 20;
      feedback = isMatch ? "Perfect T-Shape!" : "Extend your arms fully to the sides.";
      break;

    case 'victory-v':
      // Both wrists significantly above shoulders and spread apart
      const lUp = lWrist.y < lShoulder.y - 0.2;
      const rUp = rWrist.y < rShoulder.y - 0.2;
      const vSpread = Math.abs(lWrist.x - rWrist.x) > 0.3;
      isMatch = lUp && rUp && vSpread;
      score = isMatch ? 90 : 15;
      feedback = isMatch ? "Victory attained!" : "Raise your hands high in a V!";
      break;

    case 'hands-on-hips':
      // Wrists near hips, elbows out
      const lHandHip = Math.sqrt(Math.pow(lWrist.x - lHip.x, 2) + Math.pow(lWrist.y - lHip.y, 2)) < 0.2;
      const rHandHip = Math.sqrt(Math.pow(rWrist.x - rHip.x, 2) + Math.pow(rWrist.y - rHip.y, 2)) < 0.2;
      const elbowsOut = lElbow.x < lShoulder.x - 0.05 && rElbow.x > rShoulder.x + 0.05;
      isMatch = lHandHip && rHandHip;
      score = isMatch ? 85 : 30;
      feedback = isMatch ? "Looking heroic!" : "Put your hands on your hips.";
      break;

    case 'hands-on-head':
      // Wrists near or above shoulders and close to head (nose)
      const lNearHead = Math.sqrt(Math.pow(lWrist.x - nose.x, 2) + Math.pow(lWrist.y - nose.y, 2)) < 0.25;
      const rNearHead = Math.sqrt(Math.pow(rWrist.x - nose.x, 2) + Math.pow(rWrist.y - nose.y, 2)) < 0.25;
      isMatch = lNearHead && rNearHead && lWrist.y < lShoulder.y;
      score = isMatch ? 88 : 10;
      feedback = isMatch ? "Mind status: Blown!" : "Hands on your head!";
      break;

    case 'right-arm-up':
      // Right wrist high, left wrist low
      const rHigh = rWrist.y < rShoulder.y - 0.3;
      const lLow = lWrist.y > lShoulder.y;
      isMatch = rHigh && lLow;
      score = isMatch ? 92 : 25;
      feedback = isMatch ? "Reaching the stars!" : "Raise only your right hand.";
      break;

    case 'arms-crossed':
      // Wrists cross the centerline or opposite shoulders
      // Since video is mirrored, we check if wrists cross each other's x
      const crossed = lWrist.x > rWrist.x; // In MP coords, left wrist is normally < right wrist
      isMatch = crossed && Math.abs(lWrist.y - lShoulder.y) < 0.3;
      score = isMatch ? 80 : 20;
      feedback = isMatch ? "Power pose active!" : "Cross your arms over your chest.";
      break;
  }

  return { matched: isMatch, score: isMatch ? score : 0, feedback };
}
