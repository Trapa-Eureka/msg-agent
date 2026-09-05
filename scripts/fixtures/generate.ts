// Regenerates fixtures/docs/* deterministically. Run: npm run fixtures
// Outputs are committed; this script is only needed to change them. It uses macOS system fonts
// for CJK/Arabic PDFs (Arial Unicode). Not part of `npm run check`.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const OUT = join(process.cwd(), "fixtures", "docs");
const UNICODE_FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";
const FIXED_DATE = new Date("2026-09-05T00:00:00Z");

function pdf(
  file: string,
  build: (doc: PDFKit.PDFDocument) => void,
  opts: PDFKit.PDFDocumentOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      info: { Title: file, CreationDate: FIXED_DATE, ModDate: FIXED_DATE },
      ...opts,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => {
      writeFileSync(join(OUT, file), Buffer.concat(chunks));
      resolve();
    });
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

function heading(doc: PDFKit.PDFDocument, text: string, font = "Helvetica-Bold"): void {
  doc.font(font).fontSize(16).text(text);
  doc.moveDown(0.5);
}
function para(doc: PDFKit.PDFDocument, text: string, font = "Helvetica"): void {
  doc.font(font).fontSize(11).text(text, { align: "left" });
  doc.moveDown();
}

const EN_SECTIONS: [string, string[]][] = [
  [
    "Service Agreement Overview",
    [
      "This agreement describes the services provided by the Vendor to the Client, the fees payable, and the responsibilities of both parties. It takes effect on 1 October 2026 and remains in force for twelve months unless terminated earlier under Section 4.",
      "The Vendor will deliver the software modules listed in Appendix A and provide support during business hours (09:00 to 18:00, Monday to Friday, Manila time).",
    ],
  ],
  [
    "Fees and Payment",
    [
      "The Client agrees to pay a monthly fee of USD 2,400. Invoices are issued on the first business day of each month and are payable within 30 days. Late payments accrue interest at 1.5% per month.",
    ],
  ],
  [
    "Confidentiality",
    [
      "Each party shall keep the other party's confidential information secret and shall not disclose it to any third party without prior written consent, except as required by law.",
    ],
  ],
];

function lorem(i: number): string {
  return (
    `Clause ${String(i)}. The parties acknowledge that delivery milestones may be adjusted by mutual written agreement. ` +
    "Any adjustment must record the new date, the reason for the change, and the person approving it. " +
    "Failure to meet an adjusted milestone by more than fifteen business days entitles the Client to a service credit equal to 5% of the monthly fee for each week of delay, capped at 25%. " +
    "Service credits are the Client's sole remedy for delay unless the delay exceeds sixty days."
  );
}

async function main(): Promise<void> {
  if (!existsSync(UNICODE_FONT)) {
    throw new Error(`Font not found: ${UNICODE_FONT} (this generator expects macOS system fonts)`);
  }
  mkdirSync(OUT, { recursive: true });

  // 1. English PDF, short (< 3,000 chars)
  await pdf("en-short.pdf", (doc) => {
    for (const [title, paras] of EN_SECTIONS) {
      heading(doc, title);
      for (const p of paras) para(doc, p);
    }
  });

  // 2. English PDF, long (> 3,000 chars, multi-page)
  await pdf("en-long.pdf", (doc) => {
    heading(doc, "Master Services Agreement");
    para(doc, "This Master Services Agreement contains the general terms that govern every statement of work between the parties.");
    for (let i = 1; i <= 14; i++) {
      heading(doc, `Section ${String(i)}. Delivery Milestones`);
      para(doc, lorem(i));
    }
  });

  // 3. Korean PDF (same-language skip case)
  await pdf("ko.pdf", (doc) => {
    doc.registerFont("uni", UNICODE_FONT);
    heading(doc, "서비스 이용 약관", "uni");
    para(doc, "본 약관은 회사가 제공하는 서비스의 이용 조건과 절차, 회사와 이용자의 권리와 의무를 규정합니다. 본 약관은 2026년 10월 1일부터 적용됩니다.", "uni");
    heading(doc, "요금 및 결제", "uni");
    para(doc, "이용자는 매월 1일에 발행되는 청구서에 따라 30일 이내에 요금을 납부해야 합니다. 연체 시 월 1.5%의 이자가 부과됩니다.", "uni");
  });

  // 4. Scanned-looking PDF: a drawn page with no text layer
  await pdf("scanned.pdf", (doc) => {
    doc.rect(60, 60, 480, 700).lineWidth(2).stroke();
    for (let y = 100; y < 740; y += 24) doc.moveTo(80, y).lineTo(520, y).lineWidth(0.5).stroke();
  });

  // 5. Encrypted PDF (user password "secret")
  await pdf(
    "encrypted.pdf",
    (doc) => {
      heading(doc, "Confidential Memo");
      para(doc, "This document is protected with a user password and cannot be read without it.");
    },
    { userPassword: "secret", ownerPassword: "owner", pdfVersion: "1.7" },
  );

  // 6. Spanish DOCX with headings, paragraphs, and a list
  const docx = new Document({
    creator: "message fixtures",
    sections: [
      {
        children: [
          new Paragraph({ text: "Contrato de Servicios", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun(
                "Este contrato describe los servicios que el Proveedor prestará al Cliente, los honorarios pagaderos y las responsabilidades de ambas partes. Entra en vigor el 1 de octubre de 2026.",
              ),
            ],
          }),
          new Paragraph({ text: "Honorarios y pago", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            children: [
              new TextRun(
                "El Cliente pagará una cuota mensual de USD 2.400. Las facturas se emiten el primer día hábil de cada mes y vencen a los 30 días.",
              ),
            ],
          }),
          new Paragraph({ text: "Entregables", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "Módulo de facturación", bullet: { level: 0 } }),
          new Paragraph({ text: "Módulo de informes", bullet: { level: 0 } }),
          new Paragraph({ text: "Soporte en horario laboral", bullet: { level: 0 } }),
        ],
      },
    ],
  });
  writeFileSync(join(OUT, "es.docx"), await Packer.toBuffer(docx));

  // 7. Japanese TXT
  writeFileSync(
    join(OUT, "ja.txt"),
    [
      "# 業務委託契約書",
      "",
      "本契約は、受託者が委託者に対して提供するサービスの内容、報酬、および双方の責任について定めるものです。本契約は2026年10月1日から効力を生じます。",
      "",
      "## 報酬および支払い",
      "",
      "委託者は毎月1日に発行される請求書に基づき、30日以内に報酬を支払うものとします。支払いが遅延した場合、月1.5%の遅延利息が発生します。",
      "",
    ].join("\n"),
  );

  // 8. Arabic RTL TXT
  writeFileSync(
    join(OUT, "ar-rtl.txt"),
    [
      "اتفاقية الخدمات",
      "",
      "تصف هذه الاتفاقية الخدمات التي يقدمها المورد للعميل، والرسوم المستحقة، ومسؤوليات الطرفين. تدخل هذه الاتفاقية حيز التنفيذ في 1 أكتوبر 2026.",
      "",
      "الرسوم والدفع",
      "",
      "يوافق العميل على دفع رسوم شهرية قدرها 2,400 دولار أمريكي. تصدر الفواتير في أول يوم عمل من كل شهر وتستحق خلال 30 يومًا.",
      "",
    ].join("\n"),
  );

  // 9. Large English TXT (> maxChars 120,000) — deterministic
  const parts: string[] = ["# Master Services Agreement (extended)", ""];
  for (let i = 1; parts.join("\n").replace(/\s+/gu, "").length < 130_000; i++) {
    parts.push(`## Section ${String(i)}`, "", lorem(i), "");
  }
  writeFileSync(join(OUT, "large-en.txt"), parts.join("\n"));

  // 10. Short English MD (Markdown path)
  writeFileSync(
    join(OUT, "en-short.md"),
    ["# Release Notes", "", "Version 2.1 adds bulk export and fixes the timezone bug in reports.", "", "## Upgrade steps", "", "1. Back up the database.", "2. Run the migration.", ""].join("\n"),
  );

  console.log(`fixtures written to ${OUT}`);
}

await main();
