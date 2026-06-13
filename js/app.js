/**
 * app.js
 * Main entry point for the Siemens Schematic Net Comparator.
 */

document.addEventListener('DOMContentLoaded', function() {
    'use strict';

    let oldFileContent = null;
    let newFileContent = null;

    const oldInput = document.getElementById('old-file-input');
    const newInput = document.getElementById('new-file-input');
    const btnCompare = document.getElementById('btn-compare');
    const btnClear = document.getElementById('btn-clear');

    const btnExportHtml = document.getElementById('btn-export-html');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnExportPdf = document.getElementById('btn-export-pdf');

    // Setup file listeners
    oldInput.addEventListener('change', e => {
        handleFileUpload(e.target.files[0], content => {
            oldFileContent = content;
            document.getElementById('old-file-name').innerText = e.target.files[0].name;
            checkReady();
        });
    });

    newInput.addEventListener('change', e => {
        handleFileUpload(e.target.files[0], content => {
            newFileContent = content;
            document.getElementById('new-file-name').innerText = e.target.files[0].name;
            checkReady();
        });
    });

    function handleFileUpload(file, callback) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => callback(e.target.result);
        reader.readAsText(file);
    }

    function checkReady() {
        if (oldFileContent && newFileContent) {
            btnCompare.disabled = false;
            btnCompare.classList.add('ready');
        } else {
            btnCompare.disabled = true;
            btnCompare.classList.remove('ready');
        }
    }

    // Run Comparison
    btnCompare.addEventListener('click', () => {
        if (!oldFileContent || !newFileContent) return;

        btnCompare.innerText = 'Parsing...';
        btnCompare.disabled = true;

        setTimeout(() => {
            try {
                const oldData = window.SiemensParser.buildDatabase(oldFileContent);
                const newData = window.SiemensParser.buildDatabase(newFileContent);
                
                const results = window.SiemensComparator.compare(oldData, newData);
                
                window.SiemensReport.render(results);
                
                document.getElementById('results-section').style.display = 'block';
                btnCompare.innerText = 'Compare';
                btnCompare.disabled = false;
            } catch (err) {
                console.error(err);
                alert('Error parsing or comparing files: ' + err.message);
                btnCompare.innerText = 'Compare';
                btnCompare.disabled = false;
            }
        }, 100);
    });

    // Clear
    btnClear.addEventListener('click', () => {
        oldInput.value = '';
        newInput.value = '';
        oldFileContent = null;
        newFileContent = null;
        document.getElementById('old-file-name').innerText = 'No file selected';
        document.getElementById('new-file-name').innerText = 'No file selected';
        document.getElementById('results-section').style.display = 'none';
        checkReady();
    });

    // Tab Switching
    document.querySelectorAll('.tab-link').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).style.display = 'block';
        });
    });

    // Filtering and Searching
    const filterInputs = document.querySelectorAll('.filter-container input');
    filterInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (window.SiemensReport.getResults()) {
                window.SiemensReport.applyFilters();
            }
        });
    });

    document.getElementById('globalSearch').addEventListener('input', () => {
        if (window.SiemensReport.getResults()) {
            window.SiemensReport.applyFilters();
        }
    });

    // Exports
    btnExportExcel.addEventListener('click', window.SiemensExport.exportExcel);
    btnExportPdf.addEventListener('click', window.SiemensExport.exportPDF);
    btnExportHtml.addEventListener('click', window.SiemensExport.exportHTML);
});
