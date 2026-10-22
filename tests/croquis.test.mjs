import test from 'node:test';
import assert from 'node:assert/strict';
import { decouper, aire, croquisLonLat } from '../public/assets/js/croquis.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const route = [[[-50, -3], [80, -3]]]; // rue le long du bas (y = -3)
const base = { aGarder: 500, lotCible: 450, lotMin: 300, recul: 3, largeurAcces: 3.5 };

test('terrain profond, maison côté rue : lots en drapeau derrière', () => {
  const r = decouper({ ...base, ring: rect(0, 0, 25, 60), batiments: [rect(4, 5, 16, 15)], routes: route });
  assert.ok(r.auto, 'rue détectée');
  assert.ok(r.lots.length >= 1);
  assert.ok(r.lots.every((l) => l.position === 'fond'));
  assert.ok(r.acces, 'accès créé');
  assert.ok(r.aireMaison >= 450, `maison ${r.aireMaison}`);
  const somme = r.aireMaison + r.aireAcces + r.lots.reduce((a, l) => a + l.aire, 0);
  assert.ok(Math.abs(somme - 1500) < 5, `somme ${somme}`);
});

test('maison au fond : lots devant, en façade sur rue', () => {
  const r = decouper({ ...base, ring: rect(0, 0, 40, 50), batiments: [rect(10, 36, 25, 46)], routes: route });
  assert.ok(r.lots.some((l) => l.position === 'rue'));
  assert.equal(r.acces, null);
  for (const l of r.lots) assert.ok(l.facade >= 11);
});

test('terrain nu large : lots côte à côte', () => {
  const r = decouper({ ...base, ring: rect(0, 0, 60, 30), batiments: [], routes: route });
  assert.equal(r.lots.length, 4);
  assert.ok(r.lots.every((l) => l.position === 'rue'));
});

test('terrain nu étroit et profond : lots en profondeur avec accès', () => {
  const r = decouper({ ...base, ring: rect(0, 0, 18, 80), batiments: [], routes: route });
  assert.ok(r.lots.length >= 2, `lots ${r.lots.length}`);
  assert.ok(r.acces);
});

test('maison sur toute la largeur : pas d’accès possible', () => {
  const r = decouper({ ...base, ring: rect(0, 0, 14, 70), batiments: [rect(1, 5, 13, 15)], routes: route });
  assert.equal(r.lots.length, 0);
  assert.ok(r.notes.length);
});

test('version lon/lat', () => {
  const k = 1 / 111320;
  const g = (x, y) => [-1.43 + x * k / Math.cos(43.64 * Math.PI / 180), 43.64 + y * k];
  const poly = (r) => ({ type: 'Polygon', coordinates: [[...r.map(([x, y]) => g(x, y)), g(...r[0])]] });
  const c = croquisLonLat({ ...base, unite: poly(rect(0, 0, 25, 60)), batiments: [poly(rect(4, 5, 16, 15))], routes: [route[0].map(([x, y]) => g(x, y))] });
  assert.ok(c.lots.length >= 1 && c.maison && c.acces);
  assert.ok(Math.abs(c.lots[0].properties.aire - 1500 + c.maison.properties.aire + c.acces.properties.aire) < 20 || c.lots.length > 1);
});

test('aire', () => assert.equal(aire(rect(0, 0, 10, 20)), 200));
