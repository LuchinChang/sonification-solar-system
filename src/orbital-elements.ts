// src/orbital-elements.ts
//
// NASA JPL Keplerian orbital elements for planets.
// Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html
// Table 1 — valid 1800 AD – 2050 AD, J2000.0 epoch.

export interface KeplerianElements {
  a: number;      aDot: number;      // semi-major axis (AU, AU/century)
  e: number;      eDot: number;      // eccentricity (rad, rad/century)
  I: number;      IDot: number;      // inclination (deg, deg/century)
  L: number;      LDot: number;      // mean longitude (deg, deg/century)
  wbar: number;   wbarDot: number;   // longitude of perihelion (deg, deg/century)
  Omega: number;  OmegaDot: number;  // longitude of ascending node (deg, deg/century)
}

/**
 * JPL Table 1 elements at J2000.0 with rates per Julian century.
 * "EM Bary" = Earth-Moon barycenter (used as Earth for our purposes).
 */
export const ELEMENTS: Record<string, KeplerianElements> = {
  Mercury: {
    a: 0.38709927,   aDot:  0.00000037,
    e: 0.20563593,   eDot:  0.00001906,
    I: 7.00497902,   IDot: -0.00594749,
    L: 252.25032350,  LDot: 149472.67411175,
    wbar: 77.45779628,  wbarDot:  0.16047689,
    Omega: 48.33076593, OmegaDot: -0.12534081,
  },
  Venus: {
    a: 0.72333566,   aDot:  0.00000390,
    e: 0.00677672,   eDot: -0.00004107,
    I: 3.39467605,   IDot: -0.00078890,
    L: 181.97909950,  LDot: 58517.81538729,
    wbar: 131.60246718, wbarDot:  0.00268329,
    Omega: 76.67984255, OmegaDot: -0.27769418,
  },
  Earth: {
    a: 1.00000261,   aDot:  0.00000562,
    e: 0.01671123,   eDot: -0.00004392,
    I: -0.00001531,  IDot: -0.01294668,
    L: 100.46457166,  LDot: 35999.37244981,
    wbar: 102.93768193, wbarDot:  0.32327364,
    Omega: 0.0,        OmegaDot:  0.0,
  },
  Mars: {
    a: 1.52371034,   aDot:  0.00001847,
    e: 0.09339410,   eDot:  0.00007882,
    I: 1.84969142,   IDot: -0.00813131,
    L: -4.55343205,   LDot: 19140.30268499,
    wbar: -23.94362959, wbarDot:  0.44441088,
    Omega: 49.55953891, OmegaDot: -0.29257343,
  },
  Jupiter: {
    a: 5.20288700,   aDot: -0.00011607,
    e: 0.04838624,   eDot: -0.00013253,
    I: 1.30439695,   IDot: -0.00183714,
    L: 34.39644051,   LDot: 3034.74612775,
    wbar: 14.72847983,  wbarDot:  0.21252668,
    Omega: 100.47390909, OmegaDot: 0.20469106,
  },
  Saturn: {
    a: 9.53667594,   aDot: -0.00125060,
    e: 0.05386179,   eDot: -0.00050991,
    I: 2.48599187,   IDot:  0.00193609,
    L: 49.95424423,   LDot: 1222.49362201,
    wbar: 92.59887831,  wbarDot: -0.41897216,
    Omega: 113.66242448, OmegaDot: -0.28867794,
  },
  Uranus: {
    a: 19.18916464,  aDot: -0.00196176,
    e: 0.04725744,   eDot: -0.00004397,
    I: 0.77263783,   IDot: -0.00242939,
    L: 313.23810451,  LDot: 428.48202785,
    wbar: 170.95427630, wbarDot:  0.40805281,
    Omega: 74.01692503, OmegaDot: 0.04240589,
  },
  Neptune: {
    a: 30.06992276,  aDot:  0.00026291,
    e: 0.00859048,   eDot:  0.00005105,
    I: 1.77004347,   IDot:  0.00035372,
    L: -55.12002969,  LDot: 218.45945325,
    wbar: 44.96476227,  wbarDot: -0.32241464,
    Omega: 131.78422574, OmegaDot: -0.00508664,
  },
};
