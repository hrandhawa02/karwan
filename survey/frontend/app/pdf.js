function wrap(line, width) {
  if (line.length <= width) return [line];
  const parts = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < 1) cut = width;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

function pdfEscape(text) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\u2019", "'")
    .replaceAll("\u2014", "-")
    .replace(/[^\x20-\x7E]/g, "");
}

function rowOf(line) {
  const cut = line.indexOf(": ");
  if (cut < 1 || cut > 24) return null;
  return [line.slice(0, cut), line.slice(cut + 2)];
}

function text(font, size, x, y, color, value) {
  return [
    "BT",
    `${font} ${size} Tf`,
    color,
    `1 0 0 1 ${x} ${y} Tm`,
    `(${pdfEscape(value)}) Tj`,
    "ET",
  ].join("\n");
}

function rule(x1, y, x2) {
  return `0.89 0.91 0.9 RG\n0.8 w\n${x1} ${y} m ${x2} ${y} l S`;
}

export function pdfBytes(note) {
  const lines = note.split("\n");
  const title = lines[0] || "";
  const place = lines[1] || "";
  const rows = [];
  const closing = [];
  lines.slice(2).forEach((line) => {
    if (!line) return;
    const row = rowOf(line);
    if (row && closing.length === 0) rows.push(row);
    else closing.push(line);
  });

  const left = 56;
  const right = 556;
  const labelX = 68;
  const valueX = 210;
  const commands = [
    text("/F1", 22, left, 730, "0.639 0.306 0.133 rg", title),
    text("/F1", 13, left, 698, "0 0 0 rg", place),
  ];

  let y = 668;
  commands.push(rule(left, y, right));
  rows.forEach(([label, value]) => {
    const wrapped = wrap(value, 48);
    const height = 16 + wrapped.length * 15;
    const baseline = y - 22;
    commands.push(text("/F2", 11, labelX, baseline, "0.369 0.420 0.396 rg", label));
    wrapped.forEach((part, index) => {
      commands.push(text("/F1", 11, valueX, baseline - index * 15, "0 0 0 rg", part));
    });
    y -= height;
    commands.push(rule(left, y, right));
  });
  commands.push(`0.89 0.91 0.9 RG\n0.8 w\n${valueX - 14} 668 m ${valueX - 14} ${y} l S`);

  let closeY = y - 36;
  closing.forEach((line) => {
    commands.push(text("/F1", 12, left, closeY, "0 0 0 rg", line));
    closeY -= 18;
  });

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}
