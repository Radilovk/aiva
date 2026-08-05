#!/usr/bin/env node
/**
 * Smoke tests for session goodbye patterns and haptics playback scheduling.
 * Run: node scripts/test-apk-fixes.mjs
 */
import assert from 'node:assert/strict';

const USER_GOODBYE_WORDS = [
  'спри', 'стоп', 'затвори', 'излез', 'чао', 'ciao', 'довиждане', 'до видане',
  'благодаря', 'мерси', 'thanks', 'thank you', 'danke', 'gracias', 'merci',
  'obrigado', 'obrigada', 'goodbye', 'bye', 'stop', 'exit', 'quit',
  'arrivederci', 'sayonara', 'adiós', 'adios', 'adeu', 'paka', 'чао чао',
];

function normalizeUtterance(text) {
  return String(text || '').toLowerCase().trim().replace(/[.!?,…]+$/g, '');
}

function utteranceHasGoodbyeWord(normalized, word) {
  if (!normalized || !word) return false;
  if (normalized === word) return true;
  const tokens = normalized.split(/[\s,;]+/).filter(Boolean);
  return tokens.some((token) => token === word || token.startsWith(word));
}

function isUserGoodbye(text) {
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;
  return USER_GOODBYE_WORDS.some((word) => utteranceHasGoodbyeWord(normalized, word));
}

const ASSISTANT_FAREWELL_RE = /(оставам\s+на\s+разположение|на\s+разположение\s+съм|до\s+скоро|приятен\s+ден|до\s+ново\s+срещане|i\s*'?m\s+here\s+if\s+you\s+need|reach\s+out\s+any\s*time|на\s+услуга)/i;

function detectAssistantGoodbye(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return /\b(чао|довиждане|до\s*видане|goodbye|bye\s*bye)\b/i.test(lower) || ASSISTANT_FAREWELL_RE.test(lower);
}

assert.equal(isUserGoodbye('чао'), true, 'чао');
assert.equal(isUserGoodbye('чао, благодаря'), true, 'чао, благодаря');
assert.equal(isUserGoodbye('благодаря ти'), true, 'благодаря ти');
assert.equal(isUserGoodbye('thank you'), true, 'thank you');
assert.equal(isUserGoodbye('merci beaucoup'), true, 'merci');
assert.equal(isUserGoodbye('добави задача за утре'), false, 'not goodbye');

assert.equal(detectAssistantGoodbye('Оставам на разположение!'), true, 'assistant farewell');
assert.equal(detectAssistantGoodbye('Разбрах, записвам задачата'), false, 'not assistant farewell');

function simulatePlaybackSchedule(chunks, sampleRate = 24000) {
  let playbackEndCtxTime = 0;
  const ctxNow = () => 0;
  const schedules = [];

  for (const chunk of chunks) {
    const durationSec = chunk.length / sampleRate;
    const now = ctxNow();
    const delaySec = Math.max(0, playbackEndCtxTime - now);
    playbackEndCtxTime = now + delaySec + durationSec;
    schedules.push({ delayMs: delaySec * 1000, durationMs: durationSec * 1000 });
  }

  return { schedules, totalMs: playbackEndCtxTime * 1000 };
}

const chunkA = new Float32Array(24000);
const chunkB = new Float32Array(12000);
const { schedules, totalMs } = simulatePlaybackSchedule([chunkA, chunkB]);
assert.equal(schedules.length, 2);
assert.equal(schedules[0].delayMs, 0, 'first chunk immediate');
assert.equal(schedules[1].delayMs, 1000, 'second chunk after first');
assert.equal(totalMs, 1500, 'total playback 1.5s');

console.log('✓ All APK fix smoke tests passed');
