// NeMo-Speech.cpp JSON words use seconds and 1-based speaker IDs.
function normalizeTranscript(result, activity = []) {
  if (!result || !Array.isArray(result.words))
    throw new Error(
      "The speech engine returned an unsupported transcript format. Update NeMo-Speech.cpp.",
    );
  const turns = [];
  for (const word of result.words) {
    const start = Number(word.start),
      end = Number(word.end);
    const text = String(word.word ?? "").trim();
    if (
      !text ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start
    )
      continue;
    const midpoint = (start + end) / 2;
    const active = [
      ...new Set(
        activity
          .filter((s) => s.start <= midpoint && midpoint < s.end)
          .map((s) => s.speaker),
      ),
    ].sort();
    const speaker =
      active.length > 1
        ? "overlap"
        : activity.length
          ? (active[0] ?? "unknown")
          : Number(word.speaker) > 0
            ? `speaker_${word.speaker}`
            : "unknown";
    const previous = turns.at(-1);
    if (
      previous &&
      previous.speaker === speaker &&
      start - previous.end < 1.2 &&
      end - previous.start < 24
    ) {
      previous.text += /^[.,!?;:]/.test(text) ? text : ` ${text}`;
      previous.end = Math.max(previous.end, end);
    } else turns.push({ start, end, speaker, text });
  }
  return turns;
}
function parseRTTM(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("SPEAKER "))
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      const start = Number(fields[3]),
        duration = Number(fields[4]);
      if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0)
        throw new Error("Invalid diarization timestamps");
      return { start, end: start + duration, speaker: fields[7] };
    });
}
module.exports = { normalizeTranscript, parseRTTM };
