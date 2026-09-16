// Turns a list of rows + a column spec into a downloadable report in one of
// three formats. `columns` is [{ label, value }], where value is either a
// row key (string) or a row -> cell function, shared across all three
// formats so a report only needs to be defined once.

const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } = require('docx');

function cellValue(col, row) {
  return typeof col.value === 'function' ? col.value(row) : row[col.value];
}

function cellText(col, row) {
  const raw = cellValue(col, row);
  return raw === null || raw === undefined || raw === '' ? '—' : String(raw);
}

function toCsv(rows, columns) {
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escape(cellValue(c, row))).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

// pdfkit has no built-in table widget — this lays out fixed-width columns
// by hand, re-printing the header row whenever a page break is needed.
function toPdf(title, rows, columns, subtitle) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / columns.length;
    const rowHeight = 20;

    function drawHeader() {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      columns.forEach((col, i) => {
        doc.text(col.label, doc.page.margins.left + i * colWidth, y, { width: colWidth - 6 });
      });
      doc.font('Helvetica').fontSize(8.5);
      doc.moveDown(1.1);
      doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor('#ccc')
        .stroke();
      doc.moveDown(0.3);
    }

    doc.fontSize(18).fillColor('#000').text(title);
    if (subtitle) doc.fontSize(10).fillColor('#555').text(subtitle);
    doc.fillColor('#000').moveDown(0.8);

    drawHeader();

    rows.forEach((row) => {
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      columns.forEach((col, i) => {
        doc.text(cellText(col, row), doc.page.margins.left + i * colWidth, y, {
          width: colWidth - 6,
          height: rowHeight
        });
      });
      doc.moveDown(1.3);
    });

    if (!rows.length) {
      doc.fillColor('#555').text('No rows match the selected filters.');
    }

    doc.end();
  });
}

async function toDocx(title, rows, columns, subtitle) {
  const cellWidth = { size: Math.floor(100 / columns.length), type: WidthType.PERCENTAGE };

  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(
      (col) =>
        new TableCell({
          width: cellWidth,
          children: [new Paragraph({ children: [new TextRun({ text: col.label, bold: true })] })]
        })
    )
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: columns.map(
          (col) =>
            new TableCell({
              width: cellWidth,
              children: [new Paragraph(cellText(col, row))]
            })
        )
      })
  );

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          ...(subtitle ? [new Paragraph({ text: subtitle })] : []),
          new Paragraph({ text: `${rows.length} row${rows.length === 1 ? '' : 's'}` }),
          new Paragraph({ text: '' }),
          rows.length
            ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] })
            : new Paragraph({ text: 'No rows match the selected filters.' })
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

module.exports = { toCsv, toPdf, toDocx };
