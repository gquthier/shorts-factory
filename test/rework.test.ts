import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignToSource, resolveEnd, sentenceRange } from '../src/lib/ending.ts';
import { isCameraFrame, isFullCamera } from '../src/lib/framing.ts';
import { verticalFrame } from '../src/lib/reframe.ts';
import { coldOpenRange } from '../src/lib/transcript.ts';

const W = 960; const H = 540;
const onCamera = { texts: [], face: { x: 440, y: 150, w: 60, h: 60 } };
const webcamCorner = { texts: [], face: { x: 860, y: 450, w: 60, h: 60 } };
const slide = { texts: [{ x: 0, y: 0, w: 100, h: 20, conf: 1, text: 'Acquisition client et service cinq étoiles avec process' }], face: { x: 440, y: 150, w: 60, h: 60 } };

test('a face in the middle with no text on screen is the camera, even when small', () => {
  assert.equal(isCameraFrame(onCamera, W, H), true);
  assert.equal(isCameraFrame(webcamCorner, W, H), false);
  assert.equal(isCameraFrame(slide, W, H), false);
  assert.equal(isCameraFrame({ texts: [] }, W, H), false);
  assert.equal(isCameraFrame({ texts: [], face: { x: 470, y: 250, w: 20, h: 20 } }, W, H), false);
});

test('a clip goes vertical only when most of it is on camera', () => {
  assert.equal(isFullCamera([onCamera, onCamera, onCamera, slide], W, H), true);
  assert.equal(isFullCamera([onCamera, slide, slide, webcamCorner], W, H), false);
  assert.equal(isFullCamera([], W, H), false);
});

test('the vertical frame zooms in on a small face, but no further than the source can take', () => {
  const samples = [{ t: 0, cx: 900, cy: 400, w: 100, h: 100 }];
  const far = verticalFrame({ w: 1920, h: 1080, faceH: 100, samples });
  assert.equal(far.h, 620);
  assert.equal(far.w, 348);
  assert.ok(far.y >= 0 && far.y + far.h <= 1080);
  const close = verticalFrame({ w: 1920, h: 1080, faceH: 300, samples });
  assert.equal(close.h, 1080);
  assert.equal(close.y, 0);
  assert.equal(verticalFrame({ w: 1280, h: 480, faceH: 50, samples }).h, 480);
});

const say = (text: string, from: number, step = 0.4) => text.split(' ').map((t, i) => ({ text: t, start: from + i * step, end: from + (i + 1) * step - 0.05 }));
const words = [...say('Bon alors je commence par le contexte de cette histoire ok', 0), ...say('Ton agence ne vend pas un service elle règle une douleur.', 6), ...say('Et voilà pourquoi tes clients restent.', 12)];

test('the line replayed at the opening comes from later in the clip and is not cut', () => {
  const r = coldOpenRange(words, 'Ton agence ne vend pas un service', [0, 15], []);
  assert.ok(r && r[0] < 6 && r[0] > 5.9 && r[1] > 8.7 && r[1] < 9.1);
  assert.equal(coldOpenRange(words, 'ce mot n existe pas', [0, 15], []), null);
  assert.equal(coldOpenRange(words, 'Bon alors je commence par le contexte', [0, 15], []), null, 'already at the top');
  assert.equal(coldOpenRange(words, 'Ton agence', [0, 15], []), null, 'too short');
  assert.equal(coldOpenRange(words, 'Ton agence ne vend pas un service', [0, 15], [[7, 8]]), null, 'part of it was edited out');
});

const sentences = ['Ton agence vend du temps et personne ne veut acheter du temps.', 'Les clients veulent un résultat précis et mesurable.', 'Donc vends le résultat.', 'Sinon tu restes coincé.', 'Bon on passe aux ads.']
  .map((text, i) => ({ text, start: i * 10, end: i * 10 + 9 }));

test('the clip waits for the conclusion, within bounds', () => {
  assert.deepEqual(sentenceRange(sentences, 0, 19), { a: 0, b: 1 });
  assert.equal(resolveEnd(sentences, 0, 1, 2, 90), 2);
  assert.equal(resolveEnd(sentences, 0, 1, 99, 90), 1, 'unknown sentence');
  assert.equal(resolveEnd(sentences, 0, 1, 3, 30), 2, 'over the maximum length');
  assert.equal(resolveEnd(sentences, 1, 2, 0, 90), 2, 'before the start');
});

test('an edited clip is found back in the whole video', () => {
  assert.deepEqual(alignToSource(sentences, 'Ton agence vend du temps. Les clients veulent un résultat précis et mesurable.'), { a: 0, b: 1 });
  assert.equal(alignToSource(sentences, 'rien à voir avec cette vidéo du tout mais vraiment rien'), null);
  assert.equal(alignToSource(sentences, 'trop court'), null);
});
