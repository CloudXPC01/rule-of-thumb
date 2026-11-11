# Rule of Thumb: Devpost submission draft

Track: Gaming · Division: New Experience · Platform: Meta Quest (WebXR, Immersive Web SDK)

## Name
Rule of Thumb

## Tagline (118 / 140 characters)
You can't speak. They're watching your hands. Everything you do becomes scripture, and they will get it slightly wrong.

## Description (≈430 / 500 words)

**Inspiration.** I wanted a god game where you are not a cursor with a menu, just a hand. A tiny voxel village lives on a floating island on your real desk, in passthrough. They are hungry and cold, so they chop, burn and overfish, and the land turns grey. You can't speak to them. All you have is what your hands do, and the fact that somebody might be watching.

**How it plays.** Look at a villager and they look back up at you with a little "!". Now they are your witness. Pinch a seed pod and plant it on a stump in front of them, and the village Scribe chisels a stone tablet: "WHERE THE AXE FALLS, A SEED FOLLOWS". From then on, lumberjacks replant. But about a third of the time they misread you. Wring the cloud over dry dust and they decide "WHEN THE CLOUD COMES, WE DANCE". Smother a fire and they conclude the Hand hates warmth, so nobody lights a fire again and everyone shivers. Close your fist on a wrong tablet to crush it (they all go "ooooh"), or hold your palm up under a good one to bless it gold. Villagers also come to you with petitions on little signs, "CUT THE OLD GROVE?", and you answer palm up for yes, fist for no.

A session is about ten minutes across three Ages (Wood, Smoke, Plenty) and ends in a Festival. They read your laws back to you in order, lanterns rise past your face, and you close your fist to put out the sun. Then you find out what kind of god you were: Harmony, Zealotry, or Exodus, where the villagers sail off the edge of your desk. Every law and misreading you discover is kept in the Book of the Hand, so there is always one more page to find.

**How I built it.** This is my first VR project, and I don't own a headset. It's built with Meta's Immersive Web SDK (three.js, ECS, WebXR) and runs as a WebXR link on Quest, hands only. Everything is procedural: instanced voxels (under 100 draw calls), canvas pixel-art text with a hand-made 5×7 font, and WebAudio sound in a pentatonic scale. The Scribe is a small Claude model (Haiku) behind a serverless function. It reads the omen, the witness and the village's mood and must choose between exactly two whitelisted laws, faithful or misread, and write a short folk verse; the game validates the answer and falls back to a local reading after 2.5 seconds. I built and tested everything in the IWER emulator, including scripted hand-tracking playtests, and wrote it with Claude Code as my pair programmer.

**What's next.** Shared multiplayer gods arguing over one village, more omens (wind, seasons, predators), a real desk-anchored island using plane detection on first launch, and a store release on Quest.

## How the hand interactions work (optional field)
- **Gaze (head):** look at a villager for a moment to make them your witness.
- **Pinch:** pluck and carry the seed pod; drag the cloud; pinch the island's rim to move it anywhere.
- **Fist:** inside the cloud it wrings rain (how tightly you curl sets the rain rate); low over flames it smothers fire; on a tablet it crushes the law; answers "no" to a petition.
- **Palm up:** held under a tablet, blesses it gold and permanent; answers "yes" to a petition.
- **Poke (index finger):** jab the cloud for lightning. It works, and they will fear you.
Every interaction sits inside a 2-foot radius of a seated player, all gestures use hysteresis so tracking jitter doesn't misfire, and nothing ever asks for a controller.

## What excites me about VR (optional field)
Hands make you legible. On a flat screen, a god game is clicks. In mixed reality the villagers can actually see your hand hovering over them and duck under its shadow, follow it with their little eyes, and misunderstand it. The space between what you meant and what they saw is the whole game, and it only exists because your real hand is in the room.

## Target launch date
TBD (suggest: Q2 2027 on the Meta Horizon Store; the WebXR build stays live and free throughout judging)

## Team
XPC, solo developer (India). Design, direction and production by XPC; code written with Claude Code (Anthropic).
