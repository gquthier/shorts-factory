---
name: format-proof-stack
description: Render or adapt the Proof stack short-video format in Shorts Factory. Full-screen vertical talking head that drops to the lower half each time something can be shown, while a dark stage above it displays the real capture, a figure counting up or the named tool; big words on the chest between two proofs. Use when the speaker keeps naming things the viewer should see (pages, products, results, files, numbers), and for finding and placing those real images.
---

# Proof stack

Work inside the Shorts Factory checkout. Read [the renderer contract](../../templates/README.md), [the implementation](../../templates/proof-stack/template.mjs) and [its notes](../../templates/proof-stack/NOTES.md) before changing layout or timing. Shared identity lives in [brand.mjs](../../templates/brand.mjs).

The idea: the viewer never has to take the speaker's word for it. Each thing named is shown at the moment it is said, above the speaker, who stays on screen the whole time. One proof at a time. Nothing ever covers the face.

## Step by step

1. **Read the clip's transcript and list what can be shown.** Every page, product screen, result, file, person, place or figure the speaker names. Note the exact word that names each one.
2. **Find the real image for each item.** In this order:
   - the creator's own files: product screenshots, exports, slides, photos, brand assets;
   - a public page: `node tools/capture-proof.mjs <url> <out.png> --selector "<css>"` (or `--clip x,y,w,h` in page pixels) captures it at device scale 3; take the one element that matters (the price card, the review, the calendar), not the whole page;
   - a frame of the creator's own footage or screen recording.
   Never draw a fake screen, a fake logo or a fake review, and never invent a number: when there is no real source, give the format no image and it writes the name or the figure instead. Leave out anything showing private data (emails, phone numbers, payment details, other people's messages) unless it is already public and the creator owns the right to show it.
3. **Save the images in the clip's `proof/` folder** (`data/clips/<clip id>/proof/`). The file name is the trigger: its first word is the word that must be said, the following words complete the label shown above the capture. `tarifs-page-abonnement.png` appears when "tarifs" is said, under the label "Tarifs page abonnement". PNG, JPG or WebP. A wide capture is shown 880 px wide, a tall one 560 px high: export at twice that size or more.
4. **Check the beats.** The hook stage writes them (`phrase` = 1 to 4 exact spoken words, `text` = 1 to 4 words on screen). `stat` = a figure that was said: it counts up on the stage ("700 000 € generated" becomes a counter, the unit and the rest under it). `tool` = a named thing: it takes the capture whose file name matches the beat or the words around it, or else its name over a short accent rule. `label` = a key idea: big words on the chest, full screen, in place of the caption.
5. **Render** the clip with the `proof-stack` format, then open the result at delivery size and check the list at the end of this file.

## What the format does with them

| Element | Value |
|---|---|
| Canvas | 1080 x 1920, dark stage `#0D0C0A` with a soft accent glow from the top |
| Full screen | seam 0: the speaker fills the frame; captions centred on y 1405 (chest) |
| Proof shown | seam 900: stage above, speaker below, face about 430 px high; captions on y 1705 (under the chin) |
| Proof zone | 960 x 690 at x 60, y 92; nothing in the top 92 px |
| Capture | whole image in a rounded window (radius 30, 2 px light border, deep shadow), label above in 800 weight, 44 to 62 px |
| Figure | counter in the accent, 120 to 190 px, counting for 0.85 s; the rest of the text in 42 px under it |
| Named thing, no image | its name, 70 to 150 px, over a 260 px accent rule |
| Big words | band y 1180 to 1620: first line in the accent (up to 230 px), the rest in white at 62 %, soft dark shadow, lands 28 % big and settles |
| Hook | dark rounded pill at y 140 for the first 2.6 s, one *starred* word in the accent |
| Captions | brand font 800, 74 px, up to 4 words and 21 characters, white with a soft shadow, emphasised words in the accent |

Rhythm, in take seconds:

- nothing but the hook and the captions in the first 2.8 s;
- a proof lands 0.16 s after the stage starts opening and holds 1.6 to 4.2 s;
- proofs less than 4.6 s apart share one opening and swap on the stage; otherwise the speaker comes back full screen for at least 1.5 s;
- a `label` beat inside or right after an opening becomes a stage card instead of chest words;
- punch-ins only full screen, on sentence starts, at least 3.2 s apart, cycling 1.12, 1.0, 1.15, 1.04; the big words punch to 1.15 and release;
- no speed-up, no music, quiet interface sounds only (engine cues at -33 LUFS).

## Rules

- Use the creator's own media, profile and verified transcript. All template input comes from `TemplateCtx`; do not hardcode a person, path, sample hook or timing. Template spec times are TAKE seconds; overlay intervals are FINAL seconds after cuts. Preserve this distinction.
- One strong thing at a time: a proof or the big words, never both, and no caption under the big words.
- A figure on screen must have been said in the clip. A capture must be the real thing.
- Screen recordings fall back to black-frame: this format needs a face.
- Colours and fonts come from `brand.mjs`. The film this format was drawn from used a warm gold accent (`#F0A63A`) and Bricolage Grotesque 800.

## After changing the format

Run `node --no-warnings --test test/templates.test.ts`, render a short fixture with real captures in a `proof/` folder, and inspect the opening, one stage opening, one swap, the big words and the final frame at delivery resolution. Check: the face is never covered and stays whole under the seam; each capture is readable and appears on its word; no caption sits on the mouth; nothing is clipped at the edges or in the top 92 px; the stage is never empty for more than a beat. Hook quality and render quality are separate checks. Rendering does not authorize publication.
