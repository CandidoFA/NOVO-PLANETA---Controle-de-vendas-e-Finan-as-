import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { formatDatePT, formatKz } from './format';

export interface ReportExportPayload {
  title: string;
  subtitle: string;
  periodLabel: string;
  summaryRows: { label: string; value: string }[];
  columns: string[];
  rows: (string | number)[][];
  fileNameBase: string;
}

export function exportReportPDF(payload: ReportExportPayload): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('NOVO PLANETA — CONTROLO DE VENDAS E FINANÇAS', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`${payload.title} · ${payload.periodLabel}`, 14, 19);
  doc.text(`Emitido em ${formatDatePT(new Date().toISOString().slice(0, 10))}`, 196, 19, { align: 'right' });

  let cursorY = 36;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(payload.subtitle, 14, cursorY);
  cursorY += 6;

  if (payload.summaryRows.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Indicador', 'Valor']],
      body: payload.summaryRows.map((r) => [r.label, r.value]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
    });
    cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
      ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
      : cursorY + 24;
  }

  autoTable(doc, {
    startY: cursorY,
    head: [payload.columns],
    body: payload.rows.length > 0 ? payload.rows : [['Sem registos para o período selecionado.', ...Array(Math.max(0, payload.columns.length - 1)).fill('')]],
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2.3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${payload.fileNameBase}.pdf`);
}

export function exportReportExcel(payload: ReportExportPayload): void {
  const wb = XLSX.utils.book_new();

  const summarySheetData = [
    ['NOVO PLANETA — CONTROLO DIÁRIO DE VENDAS E FINANÇAS'],
    [payload.title],
    [`Período: ${payload.periodLabel}`],
    [`Emitido em: ${formatDatePT(new Date().toISOString().slice(0, 10))}`],
    [],
    ['Indicador', 'Valor'],
    ...payload.summaryRows.map((r) => [r.label, r.value]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summarySheetData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo');

  const detailSheetData = [
    payload.columns,
    ...(payload.rows.length > 0 ? payload.rows : [['Sem registos neste período']]),
  ];
  const wsDetail = XLSX.utils.aoa_to_sheet(detailSheetData);
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalhes');

  XLSX.writeFile(wb, `${payload.fileNameBase}.xlsx`);
}

export function formatKzForExport(val: number): string {
  return formatKz(val);
}
