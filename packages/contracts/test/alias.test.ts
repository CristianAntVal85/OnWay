// Alias de personas y código de localidad (Q-36, D-E2): funciones puras que comparten la API y la web.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasBase, localityCode, normalizeWord } from '../src/index.js';

test('normalizeWord quita acentos y deja solo letras en minúscula', () => {
  assert.equal(normalizeWord('Antón'), 'anton');
  assert.equal(normalizeWord("D'Urgell-2"), 'durgell');
  assert.equal(normalizeWord('Sabiñánigo'), 'sabinanigo');
  assert.equal(normalizeWord('  '), '');
});

test('aliasBase: tres letras de cada una de las tres primeras palabras', () => {
  assert.equal(aliasBase('Cristian Antón Valdés'), 'criantval');
  assert.equal(aliasBase('Cristian Antón Valdés Pérez'), 'criantval');
  assert.equal(aliasBase('Marta Sánchez'), 'marsan');
  assert.equal(aliasBase('Marta'), 'mar');
});

test('aliasBase: salta las partículas y admite palabras cortas', () => {
  assert.equal(aliasBase('María de la Cruz Soto'), 'marcrusot');
  assert.equal(aliasBase('Juan del Río'), 'juario');
  assert.equal(aliasBase('Ana Li Ro'), 'analiro');
  assert.equal(aliasBase('Jo Ana'), 'joana');
  assert.equal(aliasBase('Ana y Luis'), 'analui');
});

test('aliasBase: un nombre sin letras da un valor de reserva', () => {
  assert.equal(aliasBase('   '), 'user');
  assert.equal(aliasBase('123'), 'user');
});

test('localityCode: la primera letra y las consonantes siguientes', () => {
  assert.equal(localityCode('Alicante'), 'ALC');
  assert.equal(localityCode('Sabiñánigo'), 'SBN');
  assert.equal(localityCode('Biescas'), 'BSC');
  assert.equal(localityCode('Benasque'), 'BNS');
  assert.equal(localityCode('Torla'), 'TRL');
});

test('localityCode: si no llega a tres, se completa con las letras siguientes', () => {
  assert.equal(localityCode('Jaca'), 'JCA');
  assert.equal(localityCode('Aínsa'), 'ANS');
  assert.equal(localityCode('Oia'), 'OIA');
});

test('localityCode: varias palabras, y reserva con menos de tres letras', () => {
  assert.equal(localityCode('La Seu d’Urgell'), 'LSD');
  assert.equal(localityCode('Ai'), 'AIX');
  assert.equal(localityCode(''), 'XXX');
  assert.match(localityCode('Zaragoza'), /^[A-Z0-9]{3}$/);
});
