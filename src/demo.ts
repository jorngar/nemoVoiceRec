import type { Recording } from "./types";
export const demo: Recording = {
  id: "demo",
  title: "A little room for every voice",
  createdAt: "2026-09-29T09:00:00",
  duration: 92,
  favorite: false,
  deleted: false,
  demo: true,
  transcribed: true,
  peaks: Array.from(
    { length: 240 },
    (_, i) => 0.08 + Math.abs(Math.sin(i * 0.71) * Math.cos(i * 0.13)) * 0.65,
  ),
  speakers: {
    speaker_1: "Alex",
    speaker_2: "Jamie",
    speaker_3: "Morgan",
    overlap: "Overlapping voices",
  },
  turns: [
    {
      start: 0,
      end: 12,
      speaker: "speaker_1",
      text: "I love the idea of being able to just press record and stay in the conversation. No scrambling to write everything down.",
    },
    {
      start: 13,
      end: 25,
      speaker: "speaker_2",
      text: "Exactly. And when you come back to it, you should know who said what. The small details are usually the ones worth keeping.",
    },
    {
      start: 26,
      end: 36,
      speaker: "speaker_3",
      text: "What if every voice had its own color? Something you could follow through the whole conversation.",
    },
    {
      start: 37,
      end: 48,
      speaker: "speaker_1",
      text: "That feels right. Familiar, like a voice memo, but with a little more clarity.",
    },
    {
      start: 49,
      end: 56,
      speaker: "overlap",
      text: "And we can still see when people talk at the same time.",
    },
    {
      start: 57,
      end: 73,
      speaker: "speaker_2",
      text: "I would want to give each speaker a name, too. Then click a sentence and hear that exact moment again.",
    },
    {
      start: 74,
      end: 92,
      speaker: "speaker_3",
      text: "A place for the conversation to live. Let’s keep it that simple.",
    },
  ],
};
