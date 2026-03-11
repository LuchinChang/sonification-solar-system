// src/geometry.ts

export type Point = { x: number; y: number };

export function getLineCircleIntersections(
    p1: Point, 
    p2: Point, 
    cx: number, 
    cy: number, 
    r: number
): Point[] {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const fx = p1.x - cx;
    const fy = p1.y - cy;
    
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = (fx * fx + fy * fy) - r * r;
    
    let discriminant = b * b - 4 * a * c;
    const intersections: Point[] = [];
    
    if (discriminant >= 0) {
        discriminant = Math.sqrt(discriminant);
        const t1 = (-b - discriminant) / (2 * a);
        const t2 = (-b + discriminant) / (2 * a);
        
        // Ensure the intersection lies strictly on the line segment
        if (t1 >= 0 && t1 <= 1) intersections.push({ x: p1.x + t1 * dx, y: p1.y + t1 * dy });
        if (t2 >= 0 && t2 <= 1) intersections.push({ x: p1.x + t2 * dx, y: p1.y + t2 * dy });
    }
    
    return intersections;
}

/**
 * Returns the distance t ≥ 0 from `origin` along the ray at `angle`
 * where it hits segment [p1, p2] (with parametric s ∈ [0,1]),
 * or null if there is no valid intersection.
 *
 * Solves: origin + t*(cosθ, sinθ) = p1 + s*(p2−p1)
 */
export function getRaySegmentDist(
  origin: Point,
  angle:  number,
  p1:     Point,
  p2:     Point,
): number | null {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const ex = p2.x - p1.x,    ey = p2.y - p1.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null;           // parallel
  const fx = p1.x - origin.x, fy = p1.y - origin.y;
  const t  = (fx * ey - fy * ex) / denom;             // distance along ray
  const s  = (fx * dy - fy * dx) / denom;             // param along segment
  if (t < 0 || s < -1e-9 || s > 1 + 1e-9) return null;
  return t;
}