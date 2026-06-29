/* =============================================================================
   donut-svg.js — Layered SVG donut renderer.

   Layers, bottom to top:
     1. soft shadow
     2. filling peek (shell only) — oozes from behind the bottom edge
     3. base dough shape (ring = annulus, shell = disk)
     4. icing (organic hand-dipped blob, recolored via fill)
     5. accent drizzle (Vanilla bonus accent color only)
     6. sprinkle layer (seeded scatter → identical across preview & grid)
     7. specular sheen

   Sprinkle PLACEMENT is driven by a fixed seed, so a given donut looks the
   same in the big preview and in every cell of the 4×3 grid. Only the COLORS
   reassign when the palette selection changes — positions never move.
   ============================================================================ */
(function () {
  "use strict";

  const FIXED_SEED = 0x9e3779b9; // golden-ratio seed → pleasant distribution
  let uidCounter = 0;

  // ---- deterministic PRNG (mulberry32) -------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CX = 100;
  const CY = 100;

  // ---- geometry presets per base family ------------------------------------
  const GEO = {
    ring: { outerR: 86, holeR: 27, icingR: 79, icingHoleR: 33, sprMin: 37, sprMax: 75 },
    shell: { outerR: 86, holeR: 0, icingR: 81, icingHoleR: 0, sprMin: 0, sprMax: 76 },
  };

  function polar(r, a) {
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }

  // Smooth closed blob path through N seeded points (cardinal spline).
  function blobPath(radius, points, irregularity, rng, yStretch) {
    const pts = [];
    for (let i = 0; i < points; i++) {
      const ang = (i / points) * Math.PI * 2 - Math.PI / 2;
      const wobble = 1 + irregularity * (rng() * 2 - 1);
      const r = radius * wobble;
      let [x, y] = polar(r, ang);
      if (yStretch) y = CY + (y - CY) * yStretch;
      pts.push([x, y]);
    }
    // Catmull-Rom → cubic bezier, closed
    let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[(i - 1 + pts.length) % pts.length];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const p3 = pts[(i + 2) % pts.length];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
    }
    return d + "Z";
  }

  // counter-clockwise circle path (for evenodd hole punching)
  function holePath(r) {
    return `M ${CX - r} ${CY} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }

  // ---- sprinkle scatter (seeded + stratified for EVEN areal density) -------
  // The region is split into radial bands; the number of jimmies in each band
  // is proportional to that band's AREA, so density is uniform everywhere —
  // including the solid Classic Shell (where the region runs to the centre and
  // a fixed-per-band count would otherwise clump in the middle). Positions are
  // fully determined by the fixed seed, so a design looks identical in the big
  // preview and every grid cell. `half` keeps only the top.
  function buildSprinkles(geo, count, half) {
    const rng = mulberry32(FIXED_SEED);
    const out = [];
    const rMin = geo.sprMin, rMax = geo.sprMax;
    const areaSpan = rMax * rMax - rMin * rMin; // ∝ total region area
    // band count that keeps cells roughly square (no visible radial banding)
    const spacing = Math.sqrt((Math.PI * areaSpan) / count);
    const bands = Math.max(3, Math.round((rMax - rMin) / spacing));
    for (let b = 0; b < bands; b++) {
      const r0 = rMin + (b / bands) * (rMax - rMin);
      const r1 = rMin + ((b + 1) / bands) * (rMax - rMin);
      // points ∝ band area → constant points-per-area across the whole donut
      const bandPoints = Math.max(1, Math.round((count * (r1 * r1 - r0 * r0)) / areaSpan));
      const offset = rng() * Math.PI * 2;
      const step = (Math.PI * 2) / bandPoints;
      for (let a = 0; a < bandPoints; a++) {
        const ang = offset + a * step + (rng() - 0.5) * step * 0.7;
        const r = Math.sqrt(rng() * (r1 * r1 - r0 * r0) + r0 * r0); // area-uniform within band
        const rot = rng() * 180;
        const [x, y] = polar(r, ang);
        if (half && y > CY) continue;
        out.push({ x, y, rot, idx: out.length });
      }
    }
    return out;
  }

  // Elliptical dollop (rx wide × ry tall) centred at the origin with a soft
  // point toward -y. Placed via a translate+rotate group, so the wide axis lies
  // along the rim and the point sticks straight out past the edge.
  function dollopPath(rx, ry, tipLen) {
    const tipAngle = -Math.PI / 2, phi = 1.05;
    const pt = (a) => [Math.cos(a) * rx, Math.sin(a) * ry];
    const T = [0, -(ry + tipLen)];
    const R = pt(tipAngle + phi);
    const L = pt(tipAngle - phi);
    const cR = [Math.cos(tipAngle + phi * 0.45) * (rx + tipLen * 0.7), Math.sin(tipAngle + phi * 0.45) * (ry + tipLen * 0.7)];
    const cL = [Math.cos(tipAngle - phi * 0.45) * (rx + tipLen * 0.7), Math.sin(tipAngle - phi * 0.45) * (ry + tipLen * 0.7)];
    const f = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    return `M ${f(T)} Q ${f(cR)} ${f(R)} A ${rx} ${ry} 0 1 1 ${f(L)} Q ${f(cL)} ${f(T)} Z`;
  }

  // thin piped drizzle lines swept diagonally across the whole donut. They run
  // full-width and are clipped to the exact icing shape by the caller, so they
  // reach the icing edge and skip the ring hole. Seeded → stable everywhere.
  function drizzleLines(rng) {
    const lines = [];
    const count = 7, slope = -0.5;
    for (let i = 0; i < count; i++) {
      const baseY = CY - 116 + ((i + 0.5) / count) * 232;
      const amp = 3.5 + rng() * 4;
      const freq = 0.06 + rng() * 0.03;
      const phase = rng() * Math.PI * 2;
      let d = "", first = true;
      for (let x = CX - 110; x <= CX + 110; x += 3) {
        const y = baseY + slope * (x - CX) + amp * Math.sin(x * freq + phase);
        d += (first ? "M " : "L ") + x.toFixed(1) + " " + y.toFixed(1) + " ";
        first = false;
      }
      lines.push(d);
    }
    return lines;
  }

  /**
   * Render a donut design to an SVG string.
   * @param {object} design {typeId, fillingId, icingId, icingHex, tieDye, sprinkleHexes[], rainbowColors, heavySprinkles, halfSprinkles, noSprinkles}
   * @param {object} opts {size, ariaLabel, decorative}
   */
  function renderDonut(design, opts) {
    opts = opts || {};
    const size = opts.size || 320;
    const uid = "d" + uidCounter++;
    const type = DB.DONUT_TYPES.find((t) => t.id === design.typeId) || DB.DONUT_TYPES[0];
    const icing = DB.ICINGS.find((i) => i.id === design.icingId);
    const geo = GEO[type.base];

    // Each render uses fresh PRNG streams off the SAME fixed seed → identical
    // placement everywhere this design appears.
    const rngShape = mulberry32(FIXED_SEED ^ hashStr(type.base));

    const icingColor = design.icingHex || (icing ? icing.color : "#F4ECD9");
    const sprinkleHexes = (!design.noSprinkles && design.sprinkleHexes) || [];

    // ---- layer 1: shadow
    let svg = `<svg class="donut-svg" viewBox="0 0 200 200" width="${size}" height="${size}" role="img" ${
      opts.decorative ? 'aria-hidden="true"' : `aria-label="${escapeAttr(opts.ariaLabel || donutLabel(design, type, icing))}"`
    } xmlns="http://www.w3.org/2000/svg">`;

    svg += `<defs>
      <radialGradient id="${uid}-icg" cx="38%" cy="30%" r="78%">
        <stop offset="0%" stop-color="${lighten(icingColor, 0.22)}"/>
        <stop offset="55%" stop-color="${icingColor}"/>
        <stop offset="100%" stop-color="${darken(icingColor, 0.12)}"/>
      </radialGradient>
      <radialGradient id="${uid}-dgh" cx="42%" cy="32%" r="80%">
        <stop offset="0%" stop-color="${lighten(type.dough, 0.16)}"/>
        <stop offset="100%" stop-color="${type.doughShade}"/>
      </radialGradient>
      <radialGradient id="${uid}-shn" cx="36%" cy="26%" r="42%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <filter id="${uid}-td" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
    </defs>`;

    svg += `<ellipse cx="100" cy="178" rx="74" ry="15" fill="#3a2415" opacity="0.16"/>`;

    // ---- filling peek (shell only): a little jelly poking out from behind the
    //      top-right rim. Drawn BEFORE the dough so the donut overlaps its base
    //      and only the bit beyond the rim shows.
    if (type.fillable && design.fillingId && design.fillingId !== "none") {
      const filling = DB.FILLINGS.find((f) => f.id === design.fillingId);
      if (filling && filling.color) {
        // wide jelly bump (long axis along the rim tangent) with a slight point
        // sticking straight out past the top-right edge
        const fx = 165, fy = 47, rx = 22, ry = 14, rot = 50, tipLen = 7;
        svg += `<g transform="translate(${fx} ${fy}) rotate(${rot})"><path d="${dollopPath(rx, ry, tipLen)}" fill="${filling.color}" stroke="${darken(filling.color, 0.2)}" stroke-width="1.3" stroke-linejoin="round"/></g>`;
      }
    }

    // ---- layer 3: base dough
    const doughOuter = blobPath(geo.outerR, 16, 0.018, mulberry32(7), 0.97);
    if (type.base === "ring") {
      svg += `<path d="${doughOuter} ${holePath(geo.holeR)}" fill-rule="evenodd" fill="url(#${uid}-dgh)" stroke="${type.doughShade}" stroke-width="1.5"/>`;
    } else {
      svg += `<path d="${doughOuter}" fill="url(#${uid}-dgh)" stroke="${type.doughShade}" stroke-width="1.5"/>`;
    }

    // ---- layer 4: icing  (solid/tinted gradient, or a tie-dye swirl)
    const icingOuter = blobPath(geo.icingR, 18, 0.05, rngShape, 0.97);
    const icingPath = type.base === "ring" ? `${icingOuter} ${holePath(geo.icingHoleR)}` : icingOuter;
    const icingRule = type.base === "ring" ? 'fill-rule="evenodd"' : "";
    // a clip of the exact icing shape, shared by tie-dye + drizzle so both reach
    // the real (wobbly) icing edge and never spill into the ring hole
    if (design.tieDye || design.drizzleHex) {
      svg += `<clipPath id="${uid}-iclip"><path d="${icingPath}" ${icingRule}/></clipPath>`;
    }
    if (design.tieDye) {
      const tie = DB.TIE_DYE_COLORS;
      const blobs = [[78, 70], [128, 78], [70, 122], [134, 124], [100, 152], [100, 58]];
      svg += `<g clip-path="url(#${uid}-iclip)">`;
      svg += `<rect x="0" y="0" width="200" height="200" fill="#fdf6fa"/>`;
      svg += `<g filter="url(#${uid}-td)">`;
      blobs.forEach((p, i) => {
        svg += `<circle cx="${p[0]}" cy="${p[1]}" r="42" fill="${tie[i % tie.length]}" opacity="0.62"/>`;
      });
      svg += `</g></g>`;
      svg += `<path d="${icingPath}" ${icingRule} fill="none" stroke="rgba(60,30,45,0.16)" stroke-width="0.8"/>`;
    } else {
      svg += `<path d="${icingPath}" ${icingRule} fill="url(#${uid}-icg)" stroke="${darken(icingColor, 0.14)}" stroke-width="0.8"/>`;
    }

    // ---- icing drizzle: thin piped lines, drawn BELOW the sprinkles and
    //      clipped to the icing so they run right to the edge
    if (design.drizzleHex) {
      const lines = drizzleLines(mulberry32(FIXED_SEED ^ 0x55555555));
      svg += `<g clip-path="url(#${uid}-iclip)" fill="none" stroke-linecap="round">`;
      svg += `<g stroke="${darken(design.drizzleHex, 0.22)}" stroke-width="4.4" opacity="0.55">`;
      for (const d of lines) svg += `<path d="${d}"/>`;
      svg += `</g><g stroke="${design.drizzleHex}" stroke-width="3.2">`;
      for (const d of lines) svg += `<path d="${d}"/>`;
      svg += `</g></g>`;
    }

    // ---- layer 6: sprinkles (fine jimmies, density + half + rainbow aware)
    if (!design.noSprinkles && sprinkleHexes.length) {
      const count = design.heavySprinkles ? DB.SPRINKLE_DENSITY.heavy : DB.SPRINKLE_DENSITY.normal;
      const sprinkles = buildSprinkles(geo, count, design.halfSprinkles);
      const colorRng = mulberry32(FIXED_SEED ^ 0xc0ffee); // stable colors, independent of position
      const len = 4.4, w = 1.7;
      svg += `<g>`;
      for (const s of sprinkles) {
        const hex = design.rainbowColors
          ? sprinkleHexes[Math.floor(colorRng() * sprinkleHexes.length)]
          : sprinkleHexes[s.idx % sprinkleHexes.length];
        svg += `<rect x="${(s.x - len / 2).toFixed(2)}" y="${(s.y - w / 2).toFixed(2)}" width="${len}" height="${w}" rx="0.8" fill="${hex}" transform="rotate(${s.rot.toFixed(1)} ${s.x.toFixed(2)} ${s.y.toFixed(2)})"/>`;
      }
      svg += `</g>`;
    }

    // ---- layer 7: sheen
    svg += `<ellipse cx="78" cy="74" rx="34" ry="22" fill="url(#${uid}-shn)" transform="rotate(-24 78 74)"/>`;

    svg += `</svg>`;
    return svg;
  }

  function donutLabel(design, type, icing) {
    // type/icing are optional — derive from the design when called externally.
    type = type || DB.DONUT_TYPES.find((t) => t.id === design.typeId) || DB.DONUT_TYPES[0];
    icing = icing || DB.ICINGS.find((i) => i.id === design.icingId);
    const icingName = design.tieDye ? "tie-dye" : icing ? icing.name : "iced";
    let label = `${type.name} donut, ${icingName} icing`;
    if (type.fillable && design.fillingId && design.fillingId !== "none") {
      const f = DB.FILLINGS.find((x) => x.id === design.fillingId);
      if (f) label += `, ${f.name} filling`;
    }
    if (design.noSprinkles || !(design.sprinkleNames || []).length) {
      label += ", no sprinkles";
    } else {
      label += `, sprinkles: ${design.sprinkleNames.join(", ")}`;
      if (design.heavySprinkles) label += " (extra heavy)";
      if (design.halfSprinkles) label += " (half)";
    }
    if (design.drizzleName) label += `, ${design.drizzleName} drizzle`;
    return label;
  }

  // ---- tiny color utils -----------------------------------------------------
  function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
  }
  function lighten(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  }
  function darken(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
  }
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  window.DonutSVG = { render: renderDonut, label: donutLabel };
})();
