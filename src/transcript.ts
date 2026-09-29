import type { Recording } from "./types";
const colors = [
  "#bd603c",
  "#438978",
  "#687ec2",
  "#a86598",
  "#ad872e",
  "#398da7",
  "#887150",
  "#7777a5",
];
export const speakerColor = (speaker: string) =>
  speaker === "overlap"
    ? "#8a7f72"
    : speaker === "unknown"
      ? "#85858b"
      : colors[(Number(speaker.replace("speaker_", "")) - 1) % 8] || colors[0];
const languageNames = new Intl.DisplayNames(undefined, { type: "language" });
export const languageName = (code: string) => {
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
};
// hh:mm:ss once a recording reaches an hour, mm:ss before that.
function timestamp(seconds: number, long: boolean) {
  const s = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(s / 60) % 60, s % 60];
  if (long) parts.unshift(Math.floor(s / 3600));
  else parts[0] = Math.floor(s / 60);
  return parts.map((n) => String(n).padStart(2, "0")).join(":");
}
const speakerName = (r: Recording, speaker: string) =>
  r.speakers[speaker] ||
  (speaker === "overlap"
    ? "Overlapping voices"
    : speaker === "unknown"
      ? "Unassigned"
      : speaker);
function details(r: Recording) {
  const long = r.duration >= 3600;
  const date = new Date(r.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const speakers = Object.keys(r.speakers)
    .filter((s) => s.startsWith("speaker_"))
    .map((s) => speakerName(r, s));
  return {
    long,
    meta: [
      date,
      timestamp(r.duration, long),
      r.language ? languageName(r.language) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    speakers,
  };
}
// Plain text used for the clipboard and .txt export.
export function transcriptText(r: Recording) {
  const { long, meta, speakers } = details(r);
  const header = [r.title, meta, `Speakers: ${speakers.join(", ")}`];
  const body = r.turns.map(
    (t) =>
      `[${timestamp(t.start, long)}] ${speakerName(r, t.speaker)}\n${t.text}`,
  );
  return [...header, "", ...body].join("\n\n").replace(/\n{3,}/g, "\n\n");
}
// Word document with each speaker's name in their transcript color. docx is loaded
// on demand so it never slows down opening the app.
export async function transcriptDocx(r: Recording) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
    await import("docx");
  const { long, meta, speakers } = details(r);
  const hex = (speaker: string) => speakerColor(speaker).slice(1);
  const document = new Document({
    creator: "Voices",
    title: r.title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, text: r.title }),
          new Paragraph({
            children: [new TextRun({ text: meta, color: "7A7A7A" })],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({ text: "Speakers: ", bold: true }),
              new TextRun(speakers.join(", ")),
            ],
          }),
          ...r.turns.flatMap((t) => [
            new Paragraph({
              keepNext: true,
              spacing: { before: 200 },
              children: [
                new TextRun({
                  text: `${timestamp(t.start, long)}  `,
                  color: "8A8A8A",
                }),
                new TextRun({
                  text: speakerName(r, t.speaker),
                  bold: true,
                  color: hex(t.speaker),
                }),
              ],
            }),
            new Paragraph({ text: t.text }),
          ]),
        ],
      },
    ],
  });
  return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
}
export const fileName = (r: Recording, extension: string) =>
  `${r.title.replace(/[/\\:*?"<>|]/g, "-").trim() || "Transcript"}.${extension}`;
