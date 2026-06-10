// Eenmalig refactorscript: hernoemt referenties naar top-level mutable state in
// public/app.ts scope-bewust naar `state.<naam>` (TypeScript compiler-API,
// dus shadowende locals/parameters blijven onaangeraakt).
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'public/app.ts';
const STATE_VARS = [
  'session', 'profile', 'competitions', 'riders', 'stages', 'myPicks',
  'dnfRiderIds', 'selectedRiderId', 'activeCompId', '_cache', '_riderMap',
  'stageRiders', '_riderDropdownStageId', '_realtimeChannel', '_avatarMap',
  'teamShirts', 'allRiders',
];

const program = ts.createProgram([FILE], { allowJs: false, target: ts.ScriptTarget.ES2022 });
const checker = program.getTypeChecker();
const sf = program.getSourceFile(FILE);

// Verzamel de top-level declaraties van de state-variabelen
const topLevelDecls = new Map();
for (const stmt of sf.statements) {
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && STATE_VARS.includes(decl.name.text)) {
        topLevelDecls.set(decl.name.text, decl);
      }
    }
  }
}
const missing = STATE_VARS.filter(v => !topLevelDecls.has(v));
if (missing.length) throw new Error('Niet gevonden als top-level: ' + missing.join(', '));

// Vind alle identifier-referenties die naar die top-level declaraties wijzen
const edits = []; // {start, end, text}
function visit(node) {
  if (ts.isIdentifier(node) && STATE_VARS.includes(node.text)) {
    // Sla property-namen (obj.session), declaratienamen en object-literal keys over
    const p = node.parent;
    const isPropertyName = (ts.isPropertyAccessExpression(p) && p.name === node)
      || (ts.isPropertyAssignment(p) && p.name === node)
      || (ts.isPropertySignature(p) && p.name === node)
      || ts.isQualifiedName(p);
    const isDeclName = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)
      || ts.isBindingElement(p)) && p.name === node;
    if (!isPropertyName && !isDeclName) {
      const sym = checker.getSymbolAtLocation(node);
      const decl = sym?.declarations?.[0];
      if (decl && decl === topLevelDecls.get(node.text)) {
        // Shorthand property ({ riders }) heeft expliciete vorm nodig
        if (ts.isShorthandPropertyAssignment(p)) {
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${node.text}: state.${node.text}` });
        } else {
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `state.${node.text}` });
        }
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(sf);

// Declaraties zelf worden later vervangen door de state-module-import;
// referenties binnen de declaratie-initializers zijn al meegenomen hierboven.
let src = readFileSync(FILE, 'utf8');
edits.sort((a, b) => b.start - a.start);
for (const e of edits) src = src.slice(0, e.start) + e.text + src.slice(e.end);
writeFileSync(FILE, src);
console.log(`${edits.length} referenties hernoemd naar state.*`);
