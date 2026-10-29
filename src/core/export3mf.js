// 3MF writer laid out the way Bambu Studio writes its own projects:
//   3D/3dmodel.model            -> one assembled object made of components (production extension)
//   3D/Objects/object_1.model   -> the actual meshes (one per part), with optional per-triangle paint_color
//   Metadata/model_settings.config -> part names + filament ("extruder") assignment
import { zipSync, strToU8 } from 'fflate';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const NS_BBS = 'http://schemas.bambulab.com/package/2021';
const REL_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const SUB_PATH = '/3D/Objects/object_1.model';
const BBS_VERSION = '02.08.02.61';
const BBS_APP_ID = `BambuStudio-${BBS_VERSION}`;

export const PROFILES = {
  a1_04_pei: {
    name: 'Bambu A1 (0.4mm) · Textured PEI',
    printer_model: 'Bambu Lab A1',
    printer_settings_id: 'Bambu Lab A1 0.4 nozzle',
    process_settings_id: '0.20mm Standard @BBL A1',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.4'],
    filament_preset: 'Bambu PLA Basic @BBL A1',
  },
  a1_02_pei: {
    name: 'Bambu A1 (0.2mm) · Textured PEI',
    printer_model: 'Bambu Lab A1',
    printer_settings_id: 'Bambu Lab A1 0.2 nozzle',
    process_settings_id: '0.10mm Standard @BBL A1 0.2 nozzle',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.2'],
    filament_preset: 'Bambu PLA Basic @BBL A1 0.2 nozzle',
  },
  a1m_04_pei: {
    name: 'Bambu A1 mini (0.4mm) · Textured PEI',
    printer_model: 'Bambu Lab A1 mini',
    printer_settings_id: 'Bambu Lab A1 mini 0.4 nozzle',
    process_settings_id: '0.20mm Standard @BBL A1M',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.4'],
    filament_preset: 'Bambu PLA Basic @BBL A1M',
  },
  a1m_02_pei: {
    name: 'Bambu A1 mini (0.2mm) · Textured PEI',
    printer_model: 'Bambu Lab A1 mini',
    printer_settings_id: 'Bambu Lab A1 mini 0.2 nozzle',
    process_settings_id: '0.10mm Standard @BBL A1M 0.2 nozzle',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.2'],
    filament_preset: 'Bambu PLA Basic @BBL A1M 0.2 nozzle',
  },
  p1s_04_pei: {
    name: 'Bambu P1S (0.4mm) · Textured PEI',
    printer_model: 'Bambu Lab P1S',
    printer_settings_id: 'Bambu Lab P1S 0.4 nozzle',
    process_settings_id: '0.20mm Standard @BBL P1S',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.4'],
    filament_preset: 'Bambu PLA Basic @BBL P1S',
  },
  x1c_04_pei: {
    name: 'Bambu X1C (0.4mm) · Textured PEI',
    printer_model: 'Bambu Lab X1 Carbon',
    printer_settings_id: 'Bambu Lab X1 Carbon 0.4 nozzle',
    process_settings_id: '0.20mm Standard @BBL X1C',
    curr_bed_type: 'Textured PEI Plate',
    nozzle_diameter: ['0.4'],
    filament_preset: 'Bambu PLA Basic @BBL X1C',
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/**
 * @param {object} args
 * @param {string} args.name object name
 * @param {{name:string, slot:number, mesh:{positions:Float32Array,indices:Uint32Array}, paint?:string[]}[]} args.parts
 * @param {number} [args.baseSlot=1] object-level filament
 * @param {number[]} [args.plateCenter=[128,128]] where to put the model on the bed
 * @param {boolean} [args.injectA1=false] whether to embed Bambu Lab A1 0.4mm nozzle Textured PEI profile
 * @param {string[]} [args.slotColors=[]] optional hex color palette for filament preview
 * @returns {Uint8Array} zipped 3MF
 */
export function build3MF({
  name,
  parts,
  baseSlot = 1,
  plateCenter = [128, 128],
  profile = 'a1_04_pei',
  injectA1,
  slotColors = [],
}) {
  // Shift geometry so the assembly is centered in XY and rests on Z=0; the build item then places it on the plate.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];

  // --- sub model with meshes ---
  const sub = [];
  sub.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  sub.push(`<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:BambuStudio="${NS_BBS}" xmlns:p="${NS_PROD}" requiredextensions="p">\n`);
  sub.push(' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n');
  parts.forEach((part, i) => {
    const id = i + 1;
    sub.push(`  <object id="${id}" p:UUID="${uuid()}" type="model">\n   <mesh>\n    <vertices>\n`);
    const p = part.mesh.positions;
    for (let v = 0; v < p.length; v += 3) {
      sub.push(`     <vertex x="${fmt(p[v] + shift[0])}" y="${fmt(p[v + 1] + shift[1])}" z="${fmt(p[v + 2] + shift[2])}"/>\n`);
    }
    sub.push('    </vertices>\n    <triangles>\n');
    const I = part.mesh.indices;
    for (let t = 0; t < I.length; t += 3) {
      const paint = part.paint?.[t / 3];
      sub.push(`     <triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"${paint ? ` paint_color="${paint}"` : ''}/>\n`);
    }
    sub.push('    </triangles>\n   </mesh>\n  </object>\n');
  });
  sub.push(' </resources>\n</model>\n');

  // --- root model: one object assembled from components ---
  const objId = parts.length + 1;
  const root = [];
  root.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  root.push(`<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:BambuStudio="${NS_BBS}" xmlns:p="${NS_PROD}" requiredextensions="p">\n`);
  root.push(` <metadata name="Application">${BBS_APP_ID}</metadata>\n`);
  root.push(' <metadata name="BambuStudio:3mfVersion">1</metadata>\n');
  root.push(` <metadata name="Title">${esc(name)}</metadata>\n`);
  root.push(' <resources>\n');
  root.push(`  <object id="${objId}" p:UUID="${uuid()}" type="model">\n   <components>\n`);
  parts.forEach((_, i) => {
    root.push(`    <component p:path="${SUB_PATH}" objectid="${i + 1}" p:UUID="${uuid()}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n`);
  });
  root.push('   </components>\n  </object>\n </resources>\n');
  root.push(` <build p:UUID="${uuid()}">\n`);
  root.push(`  <item objectid="${objId}" p:UUID="${uuid()}" transform="1 0 0 0 1 0 0 0 1 ${fmt(plateCenter[0])} ${fmt(plateCenter[1])} 0" printable="1"/>\n`);
  root.push(' </build>\n</model>\n');

  // --- model settings: names + filament per part ---
  const totalFaces = parts.reduce((acc, p) => acc + p.mesh.indices.length / 3, 0);
  const cfg = [];
  cfg.push('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n');
  cfg.push(`  <object id="${objId}">\n`);
  cfg.push(`    <metadata key="name" value="${esc(name)}"/>\n`);
  cfg.push(`    <metadata key="extruder" value="${baseSlot}"/>\n`);
  cfg.push(`    <metadata face_count="${totalFaces}"/>\n`);
  parts.forEach((part, i) => {
    const partFaces = part.mesh.indices.length / 3;
    cfg.push(`    <part id="${i + 1}" subtype="normal_part" uuid="${uuid()}">\n`);
    cfg.push(`      <metadata key="name" value="${esc(part.name)}"/>\n`);
    cfg.push('      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n');
    cfg.push(`      <metadata key="extruder" value="${part.slot}"/>\n`);
    cfg.push(`      <mesh_stat face_count="${partFaces}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n`);
    cfg.push('    </part>\n');
  });
  cfg.push('  </object>\n');
  cfg.push('  <plate>\n');
  cfg.push('    <metadata key="plater_id" value="1"/>\n');
  cfg.push('    <metadata key="plater_name" value=""/>\n');
  cfg.push('    <metadata key="locked" value="false"/>\n');
  cfg.push('    <model_instance>\n');
  cfg.push(`      <metadata key="object_id" value="${objId}"/>\n`);
  cfg.push('      <metadata key="instance_id" value="0"/>\n');
  cfg.push('      <metadata key="identify_id" value="1"/>\n');
  cfg.push('    </model_instance>\n');
  cfg.push('  </plate>\n');
  cfg.push('  <assemble>\n  </assemble>\n');
  cfg.push('</config>\n');

  let projectSettingsStr = null;
  const profKey = injectA1 !== undefined ? (injectA1 ? (profile || 'a1_04_pei') : 'none') : (profile || 'a1_04_pei');
  const prof = profKey !== 'none' ? (PROFILES[profKey] || PROFILES.a1_04_pei) : null;
  if (prof) {
    const maxSlot = Math.max(4, ...parts.map((p) => p.slot || 1), baseSlot);
    const filamentSettings = [];
    const filamentTypes = [];
    const filamentColours = [];

    for (let s = 1; s <= maxSlot; s++) {
      filamentSettings.push(prof.filament_preset);
      filamentTypes.push('PLA');
      const hex = (slotColors && slotColors[s - 1]) ? slotColors[s - 1] : '#E2E8F0';
      filamentColours.push(hex.toUpperCase());
    }

    const proj = {
      version: BBS_VERSION,
      header: 'BambuStudio',
      printer_model: prof.printer_model,
      printer_settings_id: prof.printer_settings_id,
      process_settings_id: prof.process_settings_id,
      curr_bed_type: prof.curr_bed_type,
      nozzle_diameter: prof.nozzle_diameter,
      filament_settings_id: filamentSettings,
      filament_type: filamentTypes,
      filament_colour: filamentColours,
    };
    projectSettingsStr = JSON.stringify(proj, null, 2);
  }

  const sliceInfoXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<config>\n' +
    '  <header>\n' +
    '    <header_item key="X-BBL-Client-Type" value="slicer"/>\n' +
    `    <header_item key="X-BBL-Client-Version" value="${BBS_VERSION}"/>\n` +
    '  </header>\n' +
    '</config>\n';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    ' <Default Extension="config" ContentType="text/xml"/>\n' +
    '</Types>\n';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${REL_3DMODEL}"/>\n` +
    '</Relationships>\n';
  const modelRels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    ` <Relationship Target="${SUB_PATH}" Id="rel-1" Type="${REL_3DMODEL}"/>\n` +
    '</Relationships>\n';

  const zipFiles = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(root.join('')),
    '3D/_rels/3dmodel.model.rels': strToU8(modelRels),
    '3D/Objects/object_1.model': strToU8(sub.join('')),
    'Metadata/model_settings.config': strToU8(cfg.join('')),
    'Metadata/slice_info.config': strToU8(sliceInfoXml),
  };

  if (projectSettingsStr) {
    zipFiles['Metadata/project_settings.config'] = strToU8(projectSettingsStr);
  }

  return zipSync(zipFiles, { level: 6 });
}

