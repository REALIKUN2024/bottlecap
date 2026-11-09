export interface ParsedLyrics {
  lrc: string;
  plain: string;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function parseQrc(content: string): ParsedLyrics {
  const text = String(content || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { lrc: "", plain: "" };
  const lines: { time: number; text: string }[] = [];
  const linePattern = /^\[(\d+),(\d+)\](.*)$/;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(linePattern);
    if (!match) continue;
    const start = Number(match[1]);
    const body = match[3].replace(/<\d+,\d+,\d+>/g, "").replace(/<[^>]*>/g, "").trim();
    if (!body) continue;
    lines.push({ time: start, text: body });
  }
  lines.sort((a, b) => a.time - b.time);
  const lrc = lines
    .map((line) => {
      const minutes = Math.floor(line.time / 60000);
      const seconds = Math.floor((line.time % 60000) / 1000);
      const centis = Math.floor((line.time % 1000) / 10);
      return `[${pad(minutes)}:${pad(seconds)}.${pad(centis)}]${line.text}`;
    })
    .join("\n");
  return { lrc, plain: lines.map((line) => line.text).join("\n") };
}

export function formatLrcFile(lrc: string, title: string, artist: string): string {
  const head = [`[ti:${title}]`, `[ar:${artist}]`, "[by:Bottlecap]"].join("\n");
  return lrc ? `${head}\n${lrc}` : head;
}
