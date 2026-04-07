import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ArticleAsset, BuiltEpub, ExtractedArticle } from "../types";

type ZipEntry = {
  name: string;
  data: Uint8Array;
  compress?: boolean;
};

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosTime = ((date.getUTCHours() & 0x1f) << 11) | ((date.getUTCMinutes() & 0x3f) << 5) | ((Math.floor(date.getUTCSeconds() / 2)) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((date.getUTCMonth() + 1) & 0xf) << 5) | (date.getUTCDate() & 0x1f);
  return { dosDate, dosTime };
}

async function zipEntries(entries: ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const source = entry.data;
    const compressed = entry.compress === false ? source : new Uint8Array(await new Response(source).arrayBuffer());
    const method = entry.compress === false ? 0 : 0;
    const crc = crc32(source);

    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, now.dosTime, true);
    localView.setUint16(12, now.dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, source.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);
    fileParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, method, true);
    centralView.setUint16(12, now.dosTime, true);
    centralView.setUint16(14, now.dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, source.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const totalSize = offset + centralSize + end.length;
  const output = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of fileParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(end, cursor);
  return output;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapArticleXhtml(article: ExtractedArticle) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>${escapeXml(article.title)}</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <article>
      <h1>${escapeXml(article.title)}</h1>
      ${article.author ? `<p><em>${escapeXml(article.author)}</em></p>` : ""}
      ${article.contentHtml}
      <hr />
      <p><a href="${escapeXml(article.canonicalUrl)}">Source</a></p>
    </article>
  </body>
</html>`;
}

function buildManifestItems(assets: ArticleAsset[]) {
  return assets.map((asset) => `    <item id="${escapeXml(asset.id)}" href="${escapeXml(asset.href)}" media-type="${escapeXml(asset.mediaType)}" />`).join("\n");
}

function buildContentOpf(article: ExtractedArticle, identifier: string) {
  const modified = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(article.title)}</dc:title>
    <dc:language>en</dc:language>
    ${article.author ? `<dc:creator>${escapeXml(article.author)}</dc:creator>` : ""}
    ${article.publishedAt ? `<dc:date>${escapeXml(article.publishedAt)}</dc:date>` : ""}
    <meta property="dcterms:modified">${modified}</meta>
    <dc:source>${escapeXml(article.canonicalUrl)}</dc:source>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="article" href="article.xhtml" media-type="application/xhtml+xml" />
${buildManifestItems(article.assets)}
  </manifest>
  <spine>
    <itemref idref="article" />
  </spine>
</package>`;
}

function buildNav(article: ExtractedArticle) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${escapeXml(article.title)}</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
        <li><a href="article.xhtml">${escapeXml(article.title)}</a></li>
      </ol>
    </nav>
  </body>
</html>`;
}

export async function buildEpub(article: ExtractedArticle, outPath: string): Promise<BuiltEpub> {
  const contentHash = createHash("sha256").update(article.contentHtml).digest("hex");
  const encoder = new TextEncoder();
  const identifier = `${article.canonicalUrl}#${contentHash.slice(0, 12)}`;

  const entries: ZipEntry[] = [
    { name: "mimetype", data: encoder.encode("application/epub+zip"), compress: false },
    {
      name: "META-INF/container.xml",
      data: encoder.encode(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
      compress: false,
    },
    { name: "OEBPS/content.opf", data: encoder.encode(buildContentOpf(article, identifier)), compress: false },
    { name: "OEBPS/nav.xhtml", data: encoder.encode(buildNav(article)), compress: false },
    { name: "OEBPS/article.xhtml", data: encoder.encode(wrapArticleXhtml(article)), compress: false },
    ...article.assets.map((asset) => ({
      name: `OEBPS/${asset.href}`,
      data: asset.bytes,
      compress: false,
    })),
  ];

  const zipped = await zipEntries(entries);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, zipped);

  return {
    tmpPath: outPath,
    contentHash,
    title: article.title,
  };
}
