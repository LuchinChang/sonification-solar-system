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