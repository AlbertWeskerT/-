import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { createWatchTogetherServer } = require('../signaling-server/dist/signaling-server/src/server.js');

test('host and guest complete the built browser room flow', { timeout: 90_000 }, async () => {
  const application = createWatchTogetherServer({ port: 0, messageRateLimitPerMinute: 2_000, reconnectGraceMs: 5_000 });
  const port = await application.start();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--allow-insecure-localhost',
    ],
  });
  const hostContext = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const pageErrors = [];
  host.on('pageerror', (error) => pageErrors.push(`host: ${error.message}`));
  guest.on('pageerror', (error) => pageErrors.push(`guest: ${error.message}`));

  try {
    const health = await fetch(`${origin}/healthz`).then((response) => response.json());
    assert.equal(health.status, 'ok');

    await host.goto(origin);
    await host.locator('#nickname').fill('Host E2E');
    await host.getByRole('button', { name: 'Create room' }).click();
    await host.locator('.invite-link-text').waitFor();
    const roomCode = (await host.locator('.room-code-value').textContent())?.trim();
    const invitationUrl = (await host.locator('.invite-link-text').textContent())?.trim();
    assert.match(roomCode ?? '', /^[A-HJ-NP-Z2-9]{6}$/);
    assert.ok(invitationUrl?.startsWith(`${origin}/room/`));

    const spaResponse = await fetch(invitationUrl);
    assert.equal(spaResponse.status, 200);
    assert.match(await spaResponse.text(), /<div id="root"><\/div>/);

    await guest.goto(origin);
    await guest.getByRole('button', { name: 'Join a room' }).click();
    await guest.locator('#nickname').fill('Guest by code');
    await guest.locator('#code').fill(`  ${roomCode?.toLowerCase()}  `);
    await guest.getByRole('button', { name: 'Join room' }).click();
    await host.getByText('In this room (2)').waitFor();
    await guest.getByText('In this room (2)').waitFor();

    await guest.getByRole('button', { name: 'Leave' }).click();
    await host.getByText('In this room (1)').waitFor();

    await guest.goto(invitationUrl);
    assert.equal(await guest.locator('#code').count(), 0);
    assert.equal(await guest.locator('#nickname').count(), 1);
    await guest.locator('#nickname').fill('Guest E2E');
    await guest.getByRole('button', { name: 'Join room' }).click();
    await host.getByText('In this room (2)').waitFor();
    await guest.getByText('In this room (2)').waitFor();

    await host.getByRole('button', { name: /Unmute/ }).click();
    await guest.getByRole('button', { name: /Unmute/ }).click();
    await host.getByRole('button', { name: /Mute/ }).waitFor();
    await guest.getByRole('button', { name: /Mute/ }).waitFor();
    await host.waitForFunction(() => [...document.querySelectorAll('audio')].some((audio) =>
      audio.srcObject instanceof MediaStream && audio.srcObject.getAudioTracks().some((track) => track.readyState === 'live')));

    await host.getByRole('button', { name: 'Share screen' }).click();
    await host.getByRole('button', { name: 'Stop sharing' }).waitFor({ timeout: 15_000 });
    await guest.locator('.stage video').waitFor({ timeout: 20_000 });
    await guest.waitForFunction(() => {
      const video = document.querySelector('.stage video');
      return video instanceof HTMLVideoElement
        && video.srcObject instanceof MediaStream
        && video.srcObject.getVideoTracks().some((track) => track.readyState === 'live');
    });

    const guestChat = guest.locator('.chat-input-row input:not([type="file"])');
    await guestChat.fill('hello through backend history');
    await guest.getByRole('button', { name: 'Send' }).click();
    await host.getByText('hello through backend history').waitFor();
    await guest.getByText('hello through backend history').waitFor();

    await guest.getByRole('button', { name: 'Draw' }).click();
    const guestCanvas = guest.locator('.drawing-canvas');
    const bounds = await guestCanvas.boundingBox();
    assert.ok(bounds);
    await guest.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.35);
    await guest.mouse.down();
    await guest.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.65, { steps: 8 });
    await guest.mouse.up();
    await host.waitForFunction(() => {
      const canvas = document.querySelector('.drawing-canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const context = canvas.getContext('2d');
      if (!context || canvas.width === 0 || canvas.height === 0) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 64) if (pixels[index] > 0) return true;
      return false;
    }, undefined, { timeout: 10_000 });

    const signalingSockets = [...application.wss.clients];
    assert.equal(signalingSockets.length, 2);
    signalingSockets.at(-1).terminate();
    await guest.locator('.signaling-reconnecting, .signaling-resuming').waitFor({ timeout: 10_000 });
    await guest.locator('.signaling-connected').waitFor({ timeout: 20_000 });
    await host.getByText('In this room (2)').waitFor();
    assert.equal(await host.locator('.participant-row').count(), 2);

    await host.locator('select.preset-select').selectOption('support-lite');
    await guest.getByRole('button', { name: 'Request mouse', exact: true }).waitFor();
    await guest.getByRole('button', { name: 'Request mouse', exact: true }).click();
    await host.getByText('Guest E2E requests control').waitFor();
    assert.equal(await host.getByRole('button', { name: 'Allow mouse' }).isDisabled(), true);

    assert.deepEqual(pageErrors, []);
  } finally {
    await hostContext.close();
    await guestContext.close();
    await browser.close();
    await application.stop();
  }
});
