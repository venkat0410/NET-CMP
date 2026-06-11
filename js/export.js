/**
 * export.js
 * Handles CSV, Excel, and PDF exports.
 */

window.SiemensExport = (function() {
    'use strict';

    function exportExcel() {
        if (typeof XLSX === 'undefined') {
            alert('SheetJS (XLSX) library is not loaded. Cannot export to Excel.');
            return;
        }

        const wb = XLSX.utils.book_new();

        // Components
        const compData = window.SiemensReport.getTab1Data().map(c => ({
            'RefDes': c.refdes,
            'Status': c.status,
            'Old Properties': c.oldProperties ? c.oldProperties.join('; ') : '',
            'New Properties': c.newProperties ? c.newProperties.join('; ') : ''
        }));
        if (compData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compData), 'Component Changes');
        }

        // Connectivity
        const connData = window.SiemensReport.getTab2Data().map(c => ({
            'RefDes': c.refdes,
            'Pin': c.pin,
            'Pin Name': c.pinName,
            'Old Net': c.oldNet,
            'New Net': c.newNet,
            'Status': c.status
        }));
        if (connData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(connData), 'Connectivity Changes');
        }

        // Net Renames
        const renameData = window.SiemensReport.getTab4Data().map(n => ({
            'Old Net': n.oldNet,
            'New Net': n.newNet
        }));
        if (renameData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(renameData), 'Net Renames');
        }

        // Added / Deleted Nets
        const netChangesData = window.SiemensReport.getTab5Data().map(n => ({
            'Net': n.net,
            'Status': n.status
        }));
        if (netChangesData.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(netChangesData), 'Net Add_Delete');
        }

        XLSX.writeFile(wb, 'Siemens_ECO_Report.xlsx');
    }

    function exportPDF() {
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            alert('jsPDF library is not loaded. Cannot export to PDF.');
            return;
        }

        const { jsPDF } = window.jspdf;
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
                body: compData.map(c => [
                    c.refdes, 
                    c.status, 
                    c.oldProperties ? c.oldProperties.join('\n') : '', 
                    c.newProperties ? c.newProperties.join('\n') : ''
                ]),
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
                body: connData.map(c => [c.refdes, c.pin, c.pinName, c.oldNet, c.newNet, c.status]),
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
                body: renameData.map(n => [n.oldNet, n.newNet]),
                theme: 'striped',
                headStyles: { fillColor: [39, 174, 96] },
                styles: { fontSize: 8 }
            });
            finalY = doc.lastAutoTable.finalY + 10;
        }

        doc.save('Siemens_ECO_Report.pdf');
    }

    function exportHTML() {
        const results = window.SiemensReport.getResults();
        if (!results) return;
        
        let htmlContent = `
        <html><head><title>ECO HTML Report</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 12px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background: #eee; }
        </style>
        </head><body>
        <h1>Siemens ECO Comparison Report</h1>`;

        htmlContent += `<h2>Component Changes</h2><table><tr><th>RefDes</th><th>Status</th><th>Old</th><th>New</th></tr>`;
        window.SiemensReport.getTab1Data().forEach(c => {
            htmlContent += `<tr><td>${c.refdes}</td><td>${c.status}</td><td>${c.oldProperties ? c.oldProperties.join('; ') : ''}</td><td>${c.newProperties ? c.newProperties.join('; ') : ''}</td></tr>`;
        });
        htmlContent += `</table>`;

        htmlContent += `<h2>Connectivity Changes</h2><table><tr><th>RefDes</th><th>Pin</th><th>Pin Name</th><th>Old Net</th><th>New Net</th><th>Status</th></tr>`;
        window.SiemensReport.getTab2Data().forEach(c => {
            htmlContent += `<tr><td>${c.refdes}</td><td>${c.pin}</td><td>${c.pinName}</td><td>${c.oldNet}</td><td>${c.newNet}</td><td>${c.status}</td></tr>`;
        });
        htmlContent += `</table>`;

        htmlContent += `</body></html>`;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Siemens_ECO_Report.html';
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
