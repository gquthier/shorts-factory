# Proof stack

A full-screen vertical talking head that drops to the lower half each time something can be shown. A dark stage opens above the speaker with the proof: the real capture, a figure counting up, or the name of the tool. Between two proofs the speaker is full screen again, with punch-ins and big words on the chest. Use when the speaker keeps naming things the viewer should see.

Captures come from the clip's `proof/` folder (`data/clips/<id>/proof/`): the first word of a file name is the spoken word that brings it in, the other words complete its label. Without a capture the format writes the name or counts the figure; it never fakes a screen. Screen recordings fall back to black-frame.

Measured on the hand-built film this format was drawn from (3 min 38, one continuous take): 13 stage openings covering about 45 % of the running time, 25 proof cards, 10 chest keywords, 53 zoom changes, captions of 2 to 4 words, one proof every 6 s on average and never two strong things at once. That film also used hand-designed cards this format does not generate (a coin grid, a typing terminal, step lists, scrolling walls of results); build those as a custom edit when a clip needs them.

Implementation: `template.mjs` (`plan()` decides what shows when). Reusable instructions: `skills/format-proof-stack/SKILL.md`.
