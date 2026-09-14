const LOWER_LEVEL = [
  107, 109, 110, 111, 112, 113, 114, 116, 118, 120, 122, 123, 124, 125,
  126, 127, 128, 130, 131, 133, 135, 137, 138, 140, 141, 142, 143, 144,
  145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158,
  159, 160
];

const LEXUS_LEVEL = [
  210, 211, 212, 213, 214, 215, 216, 217, 218, 220, 222, 223, 224, 225,
  226, 227, 228, 229, 230, 231, 233, 235, 237, 238, 239, 240, 241, 242,
  243, 244, 245, 246, 248, 249, 250, 252, 257, 259
];

const VISTA_LEVEL = [
  311, 312, 313, 314, 315, 316, 317, 318, 320, 322, 323, 324, 325, 326,
  327, 328, 329, 330, 331, 333, 335, 337, 339, 340, 341, 342, 343, 344,
  345, 346, 347
];

const GRANDSTAND_LEVEL = [
  410, 411, 412, 413, 414, 415, 416, 417, 418, 420, 422, 423, 424, 425,
  426, 427, 428, 429, 430, 431, 433, 435, 437, 438, 439, 440, 442, 443,
  444
];

export type TruistMapPosition = {
  x: number;
  y: number;
  section: string;
  rowDepthEstimated: boolean;
};

function nearestIndex(values: number[], section: number) {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  values.forEach((value, index) => {
    const nextDistance = Math.abs(value - section);
    if (nextDistance < distance) {
      best = index;
      distance = nextDistance;
    }
  });
  return distance <= 1 ? best : -1;
}

function ellipsePosition(
  values: number[],
  section: number,
  center: { x: number; y: number },
  radius: { x: number; y: number },
  angleAnchors: Array<{ index: number; degrees: number }>
) {
  const index = values.indexOf(section);
  if (index < 0) return null;
  if (!angleAnchors.length) return null;
  const upperIndex = angleAnchors.findIndex((anchor) => anchor.index >= index);
  const upper =
    angleAnchors[Math.max(0, upperIndex)] ??
    angleAnchors[angleAnchors.length - 1]!;
  const lower = angleAnchors[Math.max(0, upperIndex - 1)] ?? upper;
  const progress =
    upper.index === lower.index ? 0 : (index - lower.index) / (upper.index - lower.index);
  const degrees = lower.degrees + (upper.degrees - lower.degrees) * progress;
  const angle = degrees * Math.PI / 180;
  return {
    x: center.x + Math.cos(angle) * radius.x,
    y: center.y + Math.sin(angle) * radius.y
  };
}

function premiumPosition(section: number) {
  if (section >= 1 && section <= 9) {
    const progress = (section - 1) / 8;
    return { x: 51.8 - progress * 4.2, y: 54.2 + Math.sin(progress * Math.PI) * 2 };
  }
  if (section >= 10 && section <= 22) {
    const progress = (section - 10) / 12;
    return {
      x: 59.4 - progress * 7.2,
      y: 34.8 + progress * 19.2
    };
  }
  if (section >= 23 && section <= 30) {
    const progress = (section - 23) / 7;
    return { x: 51.8 - progress * 4.1, y: 55.4 + Math.sin(progress * Math.PI) * 1.8 };
  }
  if (section >= 31 && section <= 42) {
    const progress = (section - 31) / 11;
    return {
      x: 47.6 - progress * 7.1,
      y: 54 - progress * 19.2
    };
  }
  return null;
}

export function truistMapPosition(
  sectionLabel: string,
  rowLabel?: string | null
): TruistMapPosition | null {
  const match = sectionLabel.match(/\d{1,3}/);
  if (!match) return null;
  const section = Number(match[0]);

  let point = premiumPosition(section);
  if (!point) {
    const level =
      section >= 100 && section < 200 ? LOWER_LEVEL :
      section >= 200 && section < 300 ? LEXUS_LEVEL :
      section >= 300 && section < 400 ? VISTA_LEVEL :
      section >= 400 && section < 500 ? GRANDSTAND_LEVEL :
      null;
    if (!level || nearestIndex(level, section) < 0) return null;

    point =
      level === LOWER_LEVEL
        ? ellipsePosition(
            level,
            section,
            { x: 50, y: 39.5 },
            { x: 15.2, y: 20.5 },
            [
              { index: 0, degrees: -35 },
              { index: 10, degrees: 65 },
              { index: 16, degrees: 100 },
              { index: 31, degrees: 230 },
              { index: 43, degrees: 325 }
            ]
          )
        : level === LEXUS_LEVEL
          ? ellipsePosition(
              level,
              section,
              { x: 50, y: 38.5 },
              { x: 21.3, y: 28.5 },
              [
                { index: 0, degrees: -35 },
                { index: 9, degrees: 58 },
                { index: 19, degrees: 110 },
                { index: 31, degrees: 225 },
                { index: 37, degrees: 325 }
              ]
            )
          : level === VISTA_LEVEL
            ? ellipsePosition(
                level,
                section,
                { x: 50, y: 35 },
                { x: 25.8, y: 36 },
                [
                  { index: 0, degrees: -22 },
                  { index: 12, degrees: 48 },
                  { index: 17, degrees: 108 },
                  { index: 30, degrees: 208 }
                ]
              )
            : ellipsePosition(
                level,
                section,
                { x: 50, y: 36.5 },
                { x: 29.7, y: 43 },
                [
                  { index: 0, degrees: -20 },
                  { index: 12, degrees: 72 },
                  { index: 14, degrees: 90 },
                  { index: 28, degrees: 200 }
                ]
              );
  }
  if (!point) return null;

  const row = Number(rowLabel?.match(/\d+/)?.[0] ?? "");
  const rowDepthEstimated = Number.isFinite(row) && row > 0;
  if (rowDepthEstimated) {
    const distance = Math.max(-0.65, Math.min(1.15, (row - 8) * 0.09));
    const dx = point.x - 50;
    const dy = point.y - 40;
    const length = Math.max(1, Math.hypot(dx, dy));
    point = {
      x: point.x + (dx / length) * distance,
      y: point.y + (dy / length) * distance
    };
  }

  return {
    x: Math.max(2, Math.min(98, point.x)),
    y: Math.max(2, Math.min(98, point.y)),
    section: String(section),
    rowDepthEstimated
  };
}
