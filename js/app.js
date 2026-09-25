/**
 * app.js
 * Main entry point for the Siemens Schematic Net Comparator.
 */

document.addEventListener('DOMContentLoaded', function() {
    'use strict';

    let oldFileContent = null;
    let newFileContent = null;
    let oldFileName = '';
    let newFileName = '';
    let parsedOldData = null;
    let parsedNewData = null;

    const THEME_KEY = 'net-cmp-theme';

    const oldInput = document.getElementById('old-file-input');
    const newInput = document.getElementById('new-file-input');
    const oldFileLabel = document.getElementById('old-file-label');
    const newFileLabel = document.getElementById('new-file-label');
    const btnCompare = document.getElementById('btn-compare');
    const btnClear = document.getElementById('btn-clear');
    const themeToggle = document.getElementById('theme-toggle');

    const btnExportHtml = document.getElementById('btn-export-html');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnExportPdf = document.getElementById('btn-export-pdf');

    // ---------- Theme System ----------
    function getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
    }

    function toggleTheme() {
        setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    themeToggle.addEventListener('click', toggleTheme);

    // ---------- Toast Notifications ----------
    function showToast(message, type) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + (type || 'info');
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        toast.innerHTML = '<span>' + icon + '</span><span>' + message + '</span>';
        container.appendChild(toast);
        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(function() { toast.remove(); }, 300);
        }, 3500);
    }

    // ---------- File Upload ----------
    oldInput.addEventListener('change', function(e) {
        handleFileUpload(e.target.files[0], function(content) {
            oldFileContent = content;
            oldFileName = e.target.files[0].name;
            document.getElementById('old-file-name').innerText = oldFileName;
            oldFileLabel.classList.add('loaded');
            checkReady();
            showToast('OLD file loaded: ' + oldFileName, 'success');
        });
    });

    newInput.addEventListener('change', function(e) {
        handleFileUpload(e.target.files[0], function(content) {
            newFileContent = content;
            newFileName = e.target.files[0].name;
            document.getElementById('new-file-name').innerText = newFileName;
            newFileLabel.classList.add('loaded');
            checkReady();
            showToast('NEW file loaded: ' + newFileName, 'success');
        });
    });

    function handleFileUpload(file, callback) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) { callback(e.target.result); };
        reader.onerror = function() { showToast('Error reading file', 'error'); };
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

    // ---------- Run Comparison ----------
    btnCompare.addEventListener('click', function() {
        if (!oldFileContent || !newFileContent) return;

        btnCompare.innerHTML = '<span class="spinner"></span> Parsing...';
        btnCompare.disabled = true;

        setTimeout(function() {
            try {
                parsedOldData = window.SiemensParser.buildDatabase(oldFileContent);
                parsedNewData = window.SiemensParser.buildDatabase(newFileContent);

                const results = window.SiemensComparator.compare(parsedOldData, parsedNewData);

                window.SiemensReport.render(results);
                window.SiemensReport.setExportContext({
                    oldFileName: oldFileName,
                    newFileName: newFileName,
                    oldData: parsedOldData,
                    newData: parsedNewData,
                    generatedBy: navigator.userAgent ? 'Web Browser' : ''
                });

                document.getElementById('results-section').style.display = 'block';
                btnCompare.innerText = 'Compare';
                btnCompare.disabled = false;
                showToast('Comparison complete!', 'success');
            } catch (err) {
                console.error(err);
                showToast('Error: ' + err.message, 'error');
                alert('Error parsing or comparing files: ' + err.message);
                btnCompare.innerText = 'Compare';
                btnCompare.disabled = false;
            }
        }, 100);
    });

    // ---------- Clear ----------
    btnClear.addEventListener('click', function() {
        oldInput.value = '';
        newInput.value = '';
        oldFileContent = null;
        newFileContent = null;
        oldFileName = '';
        newFileName = '';
        parsedOldData = null;
        parsedNewData = null;
        document.getElementById('old-file-name').innerText = 'Upload OLD File';
        document.getElementById('new-file-name').innerText = 'Upload NEW File';
        oldFileLabel.classList.remove('loaded');
        newFileLabel.classList.remove('loaded');
        document.getElementById('results-section').style.display = 'none';
        window.SiemensReport.setExportContext(null);
        checkReady();
        showToast('All data cleared', 'info');
    });

    // ---------- Tab Switching ----------
    document.querySelectorAll('.tab-link').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-link').forEach(function(l) { l.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function(c) { c.style.display = 'none'; });
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).style.display = 'block';
        });
    });

    // ---------- Filtering and Searching ----------
    const filterInputs = document.querySelectorAll('.filter-container input');
    filterInputs.forEach(function(input) {
        input.addEventListener('change', function() {
            if (window.SiemensReport.getResults()) {
                window.SiemensReport.applyFilters();
            }
        });
    });

    document.getElementById('globalSearch').addEventListener('input', function() {
        if (window.SiemensReport.getResults()) {
            window.SiemensReport.applyFilters();
        }
    });

    // ---------- Exports ----------
    btnExportExcel.addEventListener('click', window.SiemensExport.exportExcel);
    btnExportPdf.addEventListener('click', window.SiemensExport.exportPDF);
    btnExportHtml.addEventListener('click', window.SiemensExport.exportHTML);
});
