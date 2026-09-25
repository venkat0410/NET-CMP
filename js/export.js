/**
 * export.js
 * Handles CSV, Excel, PDF, and HTML exports.
 */

window.SiemensExport = (function() {
    'use strict';

    // ---------- Shared Helpers ----------

    function escapeHtml(str) {
        if (str == null || str === '') return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Map Siemens property arrays to display columns.
     * Typical order: partName, partNumber, tolerance, value (or similar).
     */
    function propsToColumns(properties) {
        if (!properties || !properties.length) {
            return { partName: '', partNumber: '', value: '', footprint: '', description: '', layer: '', raw: '' };
        }
        const p = properties;
        return {
            partName: p[0] || '',
            partNumber: p[1] || '',
            value: p[3] || p[2] || '',
            footprint: p[4] || '',
            description: p.length > 5 ? p.slice(5).join(', ') : (p[2] && p[3] ? p[2] : ''),
            layer: '',
            raw: p.join(' | ')
        };
    }

    function computeUnchangedComponents(oldData, newData, results) {
        if (!oldData || !newData || !results) return [];

        const changed = new Set();
        results.componentsAdded.forEach(function(c) { changed.add(c.refdes); });
        results.componentsDeleted.forEach(function(c) { changed.add(c.refdes); });
        results.componentsModified.forEach(function(c) { changed.add(c.refdes); });

        const unchanged = [];
        for (const refdes in oldData.compDb) {
            if (newData.compDb[refdes] && !changed.has(refdes)) {
                unchanged.push({
                    refdes: refdes,
                    properties: newData.compDb[refdes].properties
                });
            }
        }
        return unchanged.sort(function(a, b) {
            return a.refdes.localeCompare(b.refdes, undefined, { numeric: true });
        });
    }

    function computeSummaryCounts(results, oldData, newData) {
        const added = results.componentsAdded.length;
        const deleted = results.componentsDeleted.length;
        const modified = results.componentsModified.length;
        const unchanged = computeUnchangedComponents(oldData, newData, results).length;
        const totalOld = oldData ? Object.keys(oldData.compDb).length : 0;
        const totalNew = newData ? Object.keys(newData.compDb).length : 0;
        const totalComponents = Math.max(totalOld, totalNew);
        const matched = unchanged + modified;

        return {
            totalComponents: totalComponents,
            matchedComponents: matched,
            addedComponents: added,
            deletedComponents: deleted,
            replacedComponents: modified,
            modifiedComponents: modified,
            unchangedComponents: unchanged,
            connectivityChanges: results.connectivityChanges.length,
            netsAdded: results.netsAdded.length,
            netsDeleted: results.netsDeleted.length,
            netsRenamed: results.netRenames.length
        };
    }

    function highlightChange(oldVal, newVal) {
        if (oldVal === newVal) return escapeHtml(newVal || '—');
        return '<span class="val-old">' + escapeHtml(oldVal || '—') + '</span>' +
               ' <span class="val-arrow">→</span> ' +
               '<span class="val-new">' + escapeHtml(newVal || '—') + '</span>';
    }

    function renderComponentRow(cols) {
        return '<tr>' +
            '<td><strong>' + escapeHtml(cols.refdes) + '</strong></td>' +
            '<td>' + escapeHtml(cols.partNumber) + '</td>' +
            '<td>' + escapeHtml(cols.value) + '</td>' +
            '<td>' + escapeHtml(cols.footprint) + '</td>' +
            '<td>' + escapeHtml(cols.description || cols.partName) + '</td>' +
            '<td>' + escapeHtml(cols.layer || '—') + '</td>' +
            '</tr>';
    }

    function renderSideBySideRow(refdes, oldCols, newCols) {
        function cell(oldV, newV) {
            if (oldV === newV) return '<td>' + escapeHtml(newV || '—') + '</td>';
            return '<td class="cell-changed">' + highlightChange(oldV, newV) + '</td>';
        }
        return '<tr>' +
            '<td><strong>' + escapeHtml(refdes) + '</strong></td>' +
            cell(oldCols.partNumber, newCols.partNumber) +
            cell(oldCols.value, newCols.value) +
            cell(oldCols.footprint, newCols.footprint) +
            cell(oldCols.description || oldCols.partName, newCols.description || newCols.partName) +
            '</tr>';
    }

    // ---------- Excel Export (unchanged logic) ----------

    function exportExcel() {
        if (typeof XLSX === 'undefined') {
            alert('SheetJS (XLSX) library is not loaded. Cannot export to Excel.');
            return;
        }

        const wb = XLSX.utils.book_new();

        const compData = window.SiemensReport.getTab1Data().map(function(c) {
            return {
                'RefDes': c.refdes,
                'Status': c.status,
                'Old Properties': c.oldProperties ? c.oldProperties.join('; ') : '',
                'New Properties': c.newProperties ? c.newProperties.join('; ') : ''
            };
        });
        if (compData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compData), 'Component Changes');
        }

        const connData = window.SiemensReport.getTab2Data().map(function(c) {
            return {
                'RefDes': c.refdes,
                'Pin': c.pin,
                'Pin Name': c.pinName,
                'Old Net': c.oldNet,
                'New Net': c.newNet,
                'Status': c.status
            };
        });
        if (connData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(connData), 'Connectivity Changes');
        }

        const renameData = window.SiemensReport.getTab4Data().map(function(n) {
            return { 'Old Net': n.oldNet, 'New Net': n.newNet };
        });
        if (renameData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(renameData), 'Net Renames');
        }

        const netChangesData = window.SiemensReport.getTab5Data().map(function(n) {
            return { 'Net': n.net, 'Status': n.status };
        });
        if (netChangesData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(netChangesData), 'Net Add_Delete');
        }

        XLSX.writeFile(wb, 'Siemens_ECO_Report.xlsx');
    }

    // ---------- PDF Export (unchanged logic) ----------

    function exportPDF() {
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            alert('jsPDF library is not loaded. Cannot export to PDF.');
            return;
        }

        const jsPDF = window.jspdf.jsPDF;
        const doc = new jsPDF();

        doc.setFontSize(16);
        doc.text('Siemens Schematic Net Comparator - ECO Report', 14, 15);
        doc.setFontSize(10);
        doc.text('Generated: ' + new Date().toLocaleString(), 14, 22);

        let finalY = 28;

        const compData = window.SiemensReport.getTab1Data();
        if (compData.length > 0) {
            doc.text('Component Changes', 14, finalY + 5);
            doc.autoTable({
                startY: finalY + 8,
                head: [['RefDes', 'Status', 'Old Properties', 'New Properties']],
                body: compData.map(function(c) {
                    return [
                        c.refdes,
                        c.status,
                        c.oldProperties ? c.oldProperties.join('\n') : '',
                        c.newProperties ? c.newProperties.join('\n') : ''
                    ];
                }),
                theme: 'striped',
                headStyles: { fillColor: [41, 128, 185] },
                styles: { fontSize: 8 }
            });
            finalY = doc.lastAutoTable.finalY + 10;
        }

        const connData = window.SiemensReport.getTab2Data();
        if (connData.length > 0) {
            if (finalY > 250) { doc.addPage(); finalY = 20; }
            doc.text('Connectivity Changes', 14, finalY + 5);
            doc.autoTable({
                startY: finalY + 8,
                head: [['RefDes', 'Pin', 'Pin Name', 'Old Net', 'New Net', 'Status']],
                body: connData.map(function(c) {
                    return [c.refdes, c.pin, c.pinName, c.oldNet, c.newNet, c.status];
                }),
                theme: 'striped',
                headStyles: { fillColor: [192, 57, 43] },
                styles: { fontSize: 8 }
            });
            finalY = doc.lastAutoTable.finalY + 10;
        }

        const renameData = window.SiemensReport.getTab4Data();
        if (renameData.length > 0) {
            if (finalY > 250) { doc.addPage(); finalY = 20; }
            doc.text('Net Renames', 14, finalY + 5);
            doc.autoTable({
                startY: finalY + 8,
                head: [['Old Net', 'New Net']],
                body: renameData.map(function(n) { return [n.oldNet, n.newNet]; }),
                theme: 'striped',
                headStyles: { fillColor: [39, 174, 96] },
                styles: { fontSize: 8 }
            });
        }

        doc.save('Siemens_ECO_Report.pdf');
    }

    // ---------- HTML Export (Enhanced) ----------

    function getReportStyles() {
        return `
<style>
  :root {
    --c-added: #059669; --c-added-bg: #ecfdf5;
    --c-deleted: #dc2626; --c-deleted-bg: #fef2f2;
    --c-modified: #d97706; --c-modified-bg: #fffbeb;
    --c-replaced: #2563eb; --c-replaced-bg: #eff6ff;
    --c-unchanged: #64748b; --c-unchanged-bg: #f8fafc;
    --c-header: #0f172a; --c-accent: #4f46e5;
    --c-border: #e2e8f0; --c-text: #1e293b; --c-muted: #64748b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #f1f5f9; color: var(--c-text); line-height: 1.6;
    font-size: 13px;
  }
  .report-container { max-width: 1200px; margin: 0 auto; padding: 32px 24px 60px; }

  /* Header */
  .report-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
    color: #fff; padding: 36px 40px; border-radius: 12px;
    margin-bottom: 28px; box-shadow: 0 4px 20px rgba(15,23,42,0.25);
  }
  .report-header h1 { font-size: 1.75rem; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.02em; }
  .report-header .subtitle { font-size: 0.85rem; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.08em; }
  .report-meta {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px; margin-top: 24px; padding-top: 20px;
    border-top: 1px solid rgba(255,255,255,0.15);
  }
  .report-meta dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.65; margin-bottom: 2px; }
  .report-meta dd { font-size: 0.9rem; font-weight: 600; }

  /* TOC */
  .toc {
    background: #fff; border: 1px solid var(--c-border); border-radius: 10px;
    padding: 20px 28px; margin-bottom: 28px;
  }
  .toc h2 { font-size: 1rem; margin-bottom: 12px; color: var(--c-header); }
  .toc ol { padding-left: 20px; columns: 2; column-gap: 32px; }
  .toc li { margin-bottom: 6px; font-size: 0.85rem; }
  .toc a { color: var(--c-accent); text-decoration: none; }
  .toc a:hover { text-decoration: underline; }

  /* Summary Cards */
  .summary-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px; margin-bottom: 32px;
  }
  .summary-card {
    background: #fff; border: 1px solid var(--c-border); border-radius: 10px;
    padding: 16px 18px; text-align: center; position: relative; overflow: hidden;
  }
  .summary-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .summary-card .val { font-size: 1.75rem; font-weight: 800; font-family: 'Consolas', monospace; line-height: 1.1; }
  .summary-card .lbl { font-size: 0.68rem; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; font-weight: 600; }
  .card-total::after { background: var(--c-header); } .card-total .val { color: var(--c-header); }
  .card-matched::after { background: var(--c-accent); } .card-matched .val { color: var(--c-accent); }
  .card-added::after { background: var(--c-added); } .card-added .val { color: var(--c-added); }
  .card-deleted::after { background: var(--c-deleted); } .card-deleted .val { color: var(--c-deleted); }
  .card-replaced::after { background: var(--c-replaced); } .card-replaced .val { color: var(--c-replaced); }
  .card-modified::after { background: var(--c-modified); } .card-modified .val { color: var(--c-modified); }
  .card-unchanged::after { background: var(--c-unchanged); } .card-unchanged .val { color: var(--c-unchanged); }

  /* Sections */
  .report-section {
    background: #fff; border: 1px solid var(--c-border); border-radius: 10px;
    margin-bottom: 28px; overflow: hidden; page-break-inside: avoid;
  }
  .section-header {
    padding: 14px 24px; font-size: 1rem; font-weight: 700; color: #fff;
    display: flex; align-items: center; justify-content: space-between;
  }
  .section-header .count {
    font-size: 0.75rem; font-weight: 600; opacity: 0.85;
    background: rgba(255,255,255,0.15); padding: 2px 10px; border-radius: 12px;
  }
  .section-added .section-header { background: var(--c-added); }
  .section-deleted .section-header { background: var(--c-deleted); }
  .section-replaced .section-header { background: var(--c-replaced); }
  .section-modified .section-header { background: var(--c-modified); }
  .section-unchanged .section-header { background: var(--c-unchanged); }
  .section-connectivity .section-header { background: #7c3aed; }
  .section-nets .section-header { background: #0891b2; }
  .section-body { padding: 0; overflow-x: auto; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th {
    background: #f1f5f9; color: var(--c-muted); font-weight: 700;
    text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.06em;
    padding: 10px 14px; text-align: left; border-bottom: 2px solid var(--c-border);
    white-space: nowrap;
  }
  td { padding: 8px 14px; border-bottom: 1px solid var(--c-border); vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  tr:hover { background: #eef2ff; }

  .section-added tbody tr { background: var(--c-added-bg); }
  .section-added tbody tr:nth-child(even) { background: #d1fae5; }
  .section-deleted tbody tr { background: var(--c-deleted-bg); }
  .section-deleted tbody tr:nth-child(even) { background: #fecaca; }
  .section-modified tbody tr, .section-replaced tbody tr { background: var(--c-modified-bg); }
  .section-modified tbody tr:nth-child(even), .section-replaced tbody tr:nth-child(even) { background: #fde68a; }
  .section-unchanged tbody tr { background: var(--c-unchanged-bg); }

  /* Diff highlighting */
  .val-old { color: var(--c-deleted); text-decoration: line-through; opacity: 0.75; }
  .val-new { color: var(--c-added); font-weight: 700; }
  .val-arrow { color: var(--c-muted); margin: 0 4px; }
  .cell-changed { background: #fef3c7 !important; }
  .prop-changed { color: var(--c-modified); font-weight: 700; }

  /* Side-by-side headers */
  .dual-header th { text-align: center; }
  .dual-header .col-prev { background: #fef2f2; color: var(--c-deleted); }
  .dual-header .col-new { background: #ecfdf5; color: var(--c-added); }

  .empty-notice {
    padding: 32px 24px; text-align: center; color: var(--c-muted); font-style: italic;
  }

  .report-footer {
    text-align: center; padding: 24px; color: var(--c-muted); font-size: 0.78rem;
    border-top: 1px solid var(--c-border); margin-top: 16px;
  }

  @media print {
    body { background: #fff; font-size: 10pt; }
    .report-container { padding: 0; max-width: 100%; }
    .report-header { border-radius: 0; box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toc { page-break-after: always; }
    .report-section { page-break-inside: avoid; border: 1px solid #ccc; }
    .section-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr:nth-child(even) { background: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media (max-width: 768px) {
    .report-header { padding: 24px 20px; }
    .toc ol { columns: 1; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>`;
    }

    function exportHTML() {
        const results = window.SiemensReport.getResults();
        if (!results) {
            alert('No comparison results available. Please run a comparison first.');
            return;
        }

        const ctx = window.SiemensReport.getExportContext() || {};
        const oldData = ctx.oldData || null;
        const newData = ctx.newData || null;
        const timestamp = new Date().toLocaleString();
        const counts = computeSummaryCounts(results, oldData, newData);
        const unchanged = computeUnchangedComponents(oldData, newData, results);

        // Build section HTML
        let sectionsHtml = '';

        // --- Added Components ---
        if (results.componentsAdded.length) {
            let rows = results.componentsAdded.map(function(c) {
                const cols = propsToColumns(c.newProperties);
                cols.refdes = c.refdes;
                return renderComponentRow(cols);
            }).join('');
            sectionsHtml += buildSection('added', 'Added Components', results.componentsAdded.length,
                ['Reference', 'Part Number', 'Value', 'Footprint', 'Description', 'Layer'], rows);
        }

        // --- Deleted Components ---
        if (results.componentsDeleted.length) {
            let rows = results.componentsDeleted.map(function(c) {
                const cols = propsToColumns(c.oldProperties);
                cols.refdes = c.refdes;
                return renderComponentRow(cols);
            }).join('');
            sectionsHtml += buildSection('deleted', 'Deleted Components', results.componentsDeleted.length,
                ['Reference', 'Part Number', 'Value', 'Footprint', 'Description', 'Layer'], rows);
        }

        // --- Replaced / Modified Components (side-by-side) ---
        if (results.componentsModified.length) {
            let rows = results.componentsModified.map(function(c) {
                const oldCols = propsToColumns(c.oldProperties);
                const newCols = propsToColumns(c.newProperties);
                return renderSideBySideRow(c.refdes, oldCols, newCols);
            }).join('');
            sectionsHtml += buildSection('replaced', 'Replaced / Modified Components', results.componentsModified.length,
                ['Reference', 'Part Number', 'Value', 'Footprint', 'Description'], rows);
        }

        // --- Modified detail with property-level diff ---
        if (results.componentsModified.length) {
            let rows = results.componentsModified.map(function(c) {
                const oldCols = propsToColumns(c.oldProperties);
                const newCols = propsToColumns(c.newProperties);
                const fields = [
                    { label: 'Part Name', old: oldCols.partName, new: newCols.partName },
                    { label: 'Part Number', old: oldCols.partNumber, new: newCols.partNumber },
                    { label: 'Value', old: oldCols.value, new: newCols.value },
                    { label: 'Footprint', old: oldCols.footprint, new: newCols.footprint },
                    { label: 'Description', old: oldCols.description || oldCols.partName, new: newCols.description || newCols.partName }
                ];
                let diffCells = fields.map(function(f) {
                    if (f.old === f.new) return '<td>' + escapeHtml(f.new || '—') + '</td>';
                    return '<td class="cell-changed">' + highlightChange(f.old, f.new) + '</td>';
                }).join('');
                return '<tr><td><strong>' + escapeHtml(c.refdes) + '</strong></td>' + diffCells + '</tr>';
            }).join('');
            sectionsHtml += buildSection('modified', 'Modified Components — Detailed Differences', results.componentsModified.length,
                ['Reference', 'Part Name', 'Part Number', 'Value', 'Footprint', 'Description'], rows);
        }

        // --- Unchanged Components ---
        if (unchanged.length) {
            let rows = unchanged.map(function(c) {
                const cols = propsToColumns(c.properties);
                cols.refdes = c.refdes;
                return renderComponentRow(cols);
            }).join('');
            sectionsHtml += buildSection('unchanged', 'Unchanged Components', unchanged.length,
                ['Reference', 'Part Number', 'Value', 'Footprint', 'Description', 'Layer'], rows);
        } else {
            sectionsHtml += '<div class="report-section section-unchanged" id="sec-unchanged">' +
                '<div class="section-header">Unchanged Components <span class="count">' + counts.unchangedComponents + '</span></div>' +
                '<div class="empty-notice">All ' + counts.unchangedComponents + ' matched components are unchanged (no property differences detected).</div></div>';
        }

        // --- Connectivity Changes ---
        if (results.connectivityChanges.length) {
            let rows = results.connectivityChanges.map(function(c) {
                return '<tr><td><strong>' + escapeHtml(c.refdes) + '</strong></td>' +
                    '<td>' + escapeHtml(c.pin) + '</td>' +
                    '<td>' + escapeHtml(c.pinName) + '</td>' +
                    '<td>' + escapeHtml(c.oldNet) + '</td>' +
                    '<td>' + escapeHtml(c.newNet) + '</td>' +
                    '<td>' + escapeHtml(c.status) + '</td></tr>';
            }).join('');
            sectionsHtml += buildSection('connectivity', 'Connectivity Changes', results.connectivityChanges.length,
                ['RefDes', 'Pin', 'Pin Name', 'Old Net', 'New Net', 'Status'], rows);
        }

        // --- Net Renames ---
        if (results.netRenames.length) {
            let rows = results.netRenames.map(function(n) {
                return '<tr><td class="val-old" style="text-decoration:none;opacity:1;font-weight:600;">' + escapeHtml(n.oldNet) + '</td>' +
                    '<td style="text-align:center;color:var(--c-muted);">→</td>' +
                    '<td class="val-new">' + escapeHtml(n.newNet) + '</td></tr>';
            }).join('');
            sectionsHtml += buildSection('nets', 'Net Renames', results.netRenames.length,
                ['Old Net Name', '', 'New Net Name'], rows);
        }

        // --- Added / Deleted Nets ---
        const allNetChanges = results.netsAdded.concat(results.netsDeleted);
        if (allNetChanges.length) {
            let rows = allNetChanges.map(function(n) {
                const cls = n.status === 'Added Net' ? 'val-new' : 'val-old';
                return '<tr><td class="' + cls + '" style="text-decoration:none;opacity:1;font-weight:600;">' + escapeHtml(n.net) + '</td>' +
                    '<td>' + escapeHtml(n.status) + '</td></tr>';
            }).join('');
            sectionsHtml += buildSection('nets', 'Added / Deleted Nets', allNetChanges.length,
                ['Net Name', 'Status'], rows);
        }

        const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
            '<title>Siemens ECO Comparison Report — ' + escapeHtml(timestamp) + '</title>\n' +
            getReportStyles() + '\n</head>\n<body>\n<div class="report-container">\n\n' +

            '<!-- Report Header -->\n' +
            '<div class="report-header">\n' +
            '  <div class="subtitle">Engineering Change Order Report</div>\n' +
            '  <h1>Siemens Schematic Net Comparator</h1>\n' +
            '  <dl class="report-meta">\n' +
            '    <div><dt>Previous Version</dt><dd>' + escapeHtml(ctx.oldFileName || 'Not specified') + '</dd></div>\n' +
            '    <div><dt>New Version</dt><dd>' + escapeHtml(ctx.newFileName || 'Not specified') + '</dd></div>\n' +
            '    <div><dt>Date &amp; Time</dt><dd>' + escapeHtml(timestamp) + '</dd></div>\n' +
            '    <div><dt>Report Generated By</dt><dd>' + escapeHtml(ctx.generatedBy || 'Siemens Net Comparator') + '</dd></div>\n' +
            '  </dl>\n' +
            '</div>\n\n' +

            '<!-- Table of Contents -->\n' +
            '<nav class="toc">\n' +
            '  <h2>Table of Contents</h2>\n' +
            '  <ol>\n' +
            '    <li><a href="#sec-summary">Executive Summary</a></li>\n' +
            (results.componentsAdded.length ? '    <li><a href="#sec-added">Added Components (' + results.componentsAdded.length + ')</a></li>\n' : '') +
            (results.componentsDeleted.length ? '    <li><a href="#sec-deleted">Deleted Components (' + results.componentsDeleted.length + ')</a></li>\n' : '') +
            (results.componentsModified.length ? '    <li><a href="#sec-replaced">Replaced / Modified Components (' + results.componentsModified.length + ')</a></li>\n' : '') +
            (results.componentsModified.length ? '    <li><a href="#sec-modified">Modified Details (' + results.componentsModified.length + ')</a></li>\n' : '') +
            '    <li><a href="#sec-unchanged">Unchanged Components (' + counts.unchangedComponents + ')</a></li>\n' +
            (results.connectivityChanges.length ? '    <li><a href="#sec-connectivity">Connectivity Changes (' + results.connectivityChanges.length + ')</a></li>\n' : '') +
            (results.netRenames.length ? '    <li><a href="#sec-nets">Net Renames (' + results.netRenames.length + ')</a></li>\n' : '') +
            (allNetChanges.length ? '    <li><a href="#sec-net-changes">Added / Deleted Nets (' + allNetChanges.length + ')</a></li>\n' : '') +
            '  </ol>\n' +
            '</nav>\n\n' +

            '<!-- Executive Summary -->\n' +
            '<div id="sec-summary">\n' +
            '  <h2 style="font-size:1.15rem;margin-bottom:14px;color:var(--c-header);">Executive Summary</h2>\n' +
            '  <div class="summary-grid">\n' +
            summaryCard('card-total', counts.totalComponents, 'Total Components') +
            summaryCard('card-matched', counts.matchedComponents, 'Matched Components') +
            summaryCard('card-added', counts.addedComponents, 'Added') +
            summaryCard('card-deleted', counts.deletedComponents, 'Deleted') +
            summaryCard('card-replaced', counts.replacedComponents, 'Replaced / Modified') +
            summaryCard('card-modified', counts.modifiedComponents, 'Modified') +
            summaryCard('card-unchanged', counts.unchangedComponents, 'Unchanged') +
            '  </div>\n' +
            '  <div class="summary-grid" style="margin-top:-12px;">\n' +
            summaryCard('card-total', counts.connectivityChanges, 'Connectivity Changes') +
            summaryCard('card-added', counts.netsAdded, 'Nets Added') +
            summaryCard('card-deleted', counts.netsDeleted, 'Nets Deleted') +
            summaryCard('card-replaced', counts.netsRenamed, 'Nets Renamed') +
            '  </div>\n' +
            '</div>\n\n' +

            sectionsHtml +

            '<div class="report-footer">\n' +
            '  Generated by Siemens Schematic Net Comparator &mdash; ' + escapeHtml(timestamp) + '\n' +
            '</div>\n\n' +
            '</div>\n</body>\n</html>';

        downloadFile('Siemens_ECO_Report.html', html, 'text/html');
    }

    function summaryCard(cls, val, label) {
        return '<div class="summary-card ' + cls + '"><div class="val">' + val + '</div><div class="lbl">' + label + '</div></div>';
    }

    function buildSection(type, title, count, headers, rows) {
        const idMap = {
            'Added Components': 'sec-added',
            'Deleted Components': 'sec-deleted',
            'Replaced / Modified Components': 'sec-replaced',
            'Modified Components — Detailed Differences': 'sec-modified',
            'Unchanged Components': 'sec-unchanged',
            'Connectivity Changes': 'sec-connectivity',
            'Net Renames': 'sec-nets',
            'Added / Deleted Nets': 'sec-net-changes'
        };
        const id = idMap[title] || 'sec-' + type;
        const headerCells = headers.map(function(h) { return '<th>' + h + '</th>'; }).join('');
        return '<div class="report-section section-' + type + '" id="' + id + '">' +
            '<div class="section-header">' + title + ' <span class="count">' + count + '</span></div>' +
            '<div class="section-body"><table><thead><tr>' + headerCells + '</tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div></div>';
    }

    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: mime + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return {
        exportExcel: exportExcel,
        exportPDF: exportPDF,
        exportHTML: exportHTML
    };
})();
