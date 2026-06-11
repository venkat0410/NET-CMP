/**
 * report.js
 * Handles UI rendering for the 5 tabs, dashboard, and search/sort/filter.
 */

window.SiemensReport = (function() {
    'use strict';

    let currentResults = null;
    const PAGE_SIZE = 50;

    const state = {
        tab1: { data: [], filtered: [], page: 1, sortCol: null, sortDir: 'asc' },
        tab2: { data: [], filtered: [], page: 1, sortCol: null, sortDir: 'asc' },
        tab3: { data: [], filtered: [], page: 1 },
        tab4: { data: [], filtered: [], page: 1 },
        tab5: { data: [], filtered: [], page: 1 }
    };

    function render(results) {
        currentResults = results;
        updateDashboard(results);
        
        // Prepare data arrays
        const compChanges = [];
        results.componentsAdded.forEach(c => compChanges.push({...c, status: 'Added Component'}));
        results.componentsDeleted.forEach(c => compChanges.push({...c, status: 'Deleted Component'}));
        results.componentsModified.forEach(c => compChanges.push({...c, status: 'Modified Component'}));
        state.tab1.data = compChanges;
        
        state.tab2.data = results.connectivityChanges;
        
        // For Tab 3 (Drill Down), we group connectivity changes by RefDes
        const groupedConn = {};
        results.connectivityChanges.forEach(c => {
            if (!groupedConn[c.refdes]) groupedConn[c.refdes] = [];
            groupedConn[c.refdes].push(c);
        });
        state.tab3.data = Object.keys(groupedConn).map(refdes => ({
            refdes: refdes,
            changes: groupedConn[refdes]
        })).sort((a,b) => a.refdes.localeCompare(b.refdes, undefined, {numeric:true}));
        
        state.tab4.data = results.netRenames;
        
        const netChanges = [];
        results.netsAdded.forEach(n => netChanges.push(n));
        results.netsDeleted.forEach(n => netChanges.push(n));
        state.tab5.data = netChanges;

        // Initial Filter
        applyFilters();
    }

    function updateDashboard(results) {
        document.getElementById('dash-comp-added').innerText = results.componentsAdded.length;
        document.getElementById('dash-comp-deleted').innerText = results.componentsDeleted.length;
        document.getElementById('dash-comp-modified').innerText = results.componentsModified.length;
        document.getElementById('dash-conn-changes').innerText = results.connectivityChanges.length;
        document.getElementById('dash-nets-added').innerText = results.netsAdded.length;
        document.getElementById('dash-nets-deleted').innerText = results.netsDeleted.length;
        document.getElementById('dash-nets-renamed').innerText = results.netRenames.length;
    }

    function applyFilters() {
        const q = document.getElementById('globalSearch').value.toLowerCase();
        
        const filterState = {
            addComp: document.getElementById('chk-add-comp').checked,
            delComp: document.getElementById('chk-del-comp').checked,
            modComp: document.getElementById('chk-mod-comp').checked,
            conn: document.getElementById('chk-conn').checked,
            netRename: document.getElementById('chk-net-rename').checked,
            addNet: document.getElementById('chk-add-net').checked,
            delNet: document.getElementById('chk-del-net').checked
        };

        // Tab 1
        state.tab1.filtered = state.tab1.data.filter(c => {
            if (c.status === 'Added Component' && !filterState.addComp) return false;
            if (c.status === 'Deleted Component' && !filterState.delComp) return false;
            if (c.status === 'Modified Component' && !filterState.modComp) return false;
            if (q && !c.refdes.toLowerCase().includes(q) && !(c.oldProperties && c.oldProperties.join(' ').toLowerCase().includes(q)) && !(c.newProperties && c.newProperties.join(' ').toLowerCase().includes(q))) return false;
            return true;
        });

        // Tab 2
        state.tab2.filtered = state.tab2.data.filter(c => {
            if (!filterState.conn) return false;
            if (q && !c.refdes.toLowerCase().includes(q) && !c.pin.toLowerCase().includes(q) && !c.pinName.toLowerCase().includes(q) && !c.oldNet.toLowerCase().includes(q) && !c.newNet.toLowerCase().includes(q)) return false;
            return true;
        });

        // Tab 3
        state.tab3.filtered = state.tab3.data.filter(g => {
            if (!filterState.conn) return false;
            if (q && !g.refdes.toLowerCase().includes(q)) return false;
            return true;
        });

        // Tab 4
        state.tab4.filtered = state.tab4.data.filter(n => {
            if (!filterState.netRename) return false;
            if (q && !n.oldNet.toLowerCase().includes(q) && !n.newNet.toLowerCase().includes(q)) return false;
            return true;
        });

        // Tab 5
        state.tab5.filtered = state.tab5.data.filter(n => {
            if (n.status === 'Added Net' && !filterState.addNet) return false;
            if (n.status === 'Deleted Net' && !filterState.delNet) return false;
            if (q && !n.net.toLowerCase().includes(q)) return false;
            return true;
        });

        state.tab1.page = 1;
        state.tab2.page = 1;
        state.tab3.page = 1;
        state.tab4.page = 1;
        state.tab5.page = 1;

        drawTabs();
    }

    function drawTabs() {
        drawTab1();
        drawTab2();
        drawTab3();
        drawTab4();
        drawTab5();
    }

    function drawTab1() {
        const tbody = document.getElementById('tab1-tbody');
        const start = (state.tab1.page - 1) * PAGE_SIZE;
        const pageData = state.tab1.filtered.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageData.map(c => `
            <tr class="row-${c.status.replace(' ', '-').toLowerCase()}">
                <td>${escapeHtml(c.refdes)}</td>
                <td><span class="badge ${c.status.replace(' ', '-').toLowerCase()}">${c.status}</span></td>
                <td>${c.oldProperties ? escapeHtml(c.oldProperties.join(' | ')) : '—'}</td>
                <td>${c.newProperties ? escapeHtml(c.newProperties.join(' | ')) : '—'}</td>
            </tr>
        `).join('');
        
        setupPagination('tab1-pagination', state.tab1, drawTab1);
    }

    function drawTab2() {
        const tbody = document.getElementById('tab2-tbody');
        const start = (state.tab2.page - 1) * PAGE_SIZE;
        const pageData = state.tab2.filtered.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageData.map(c => `
            <tr class="row-${c.status.replace(' ', '-').toLowerCase()}">
                <td><strong>${escapeHtml(c.refdes)}</strong></td>
                <td>${escapeHtml(c.pin)}</td>
                <td>${escapeHtml(c.pinName)}</td>
                <td>${escapeHtml(c.oldNet)}</td>
                <td>${escapeHtml(c.newNet)}</td>
                <td><span class="badge ${c.status.replace(' ', '-').toLowerCase()}">${c.status}</span></td>
            </tr>
        `).join('');
        
        setupPagination('tab2-pagination', state.tab2, drawTab2);
    }

    function drawTab3() {
        const tbody = document.getElementById('tab3-tbody');
        const start = (state.tab3.page - 1) * PAGE_SIZE;
        const pageData = state.tab3.filtered.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageData.map(g => `
            <div class="tree-node">
                <div class="tree-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="tree-icon">▶</span>
                    <strong>${escapeHtml(g.refdes)}</strong> (${g.changes.length} changes)
                </div>
                <div class="tree-content">
                    <table class="data-table" style="margin-top: 10px;">
                        <thead><tr><th>Pin</th><th>Pin Name</th><th>Old Net</th><th>New Net</th><th>Status</th></tr></thead>
                        <tbody>
                            ${g.changes.map(c => `
                                <tr>
                                    <td>${escapeHtml(c.pin)}</td>
                                    <td>${escapeHtml(c.pinName)}</td>
                                    <td>${escapeHtml(c.oldNet)}</td>
                                    <td>${escapeHtml(c.newNet)}</td>
                                    <td>${c.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `).join('');
        
        setupPagination('tab3-pagination', state.tab3, drawTab3);
    }

    function drawTab4() {
        const tbody = document.getElementById('tab4-tbody');
        const start = (state.tab4.page - 1) * PAGE_SIZE;
        const pageData = state.tab4.filtered.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageData.map(n => `
            <tr>
                <td style="color:var(--color-deleted)">${escapeHtml(n.oldNet)}</td>
                <td>→</td>
                <td style="color:var(--color-added)">${escapeHtml(n.newNet)}</td>
            </tr>
        `).join('');
        
        setupPagination('tab4-pagination', state.tab4, drawTab4);
    }

    function drawTab5() {
        const tbody = document.getElementById('tab5-tbody');
        const start = (state.tab5.page - 1) * PAGE_SIZE;
        const pageData = state.tab5.filtered.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageData.map(n => `
            <tr class="row-${n.status.replace(' ', '-').toLowerCase()}">
                <td>${escapeHtml(n.net)}</td>
                <td><span class="badge ${n.status.replace(' ', '-').toLowerCase()}">${n.status}</span></td>
            </tr>
        `).join('');
        
        setupPagination('tab5-pagination', state.tab5, drawTab5);
    }

    function setupPagination(containerId, stateObj, drawFn) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const totalPages = Math.ceil(stateObj.filtered.length / PAGE_SIZE) || 1;
        
        let html = `<button ${stateObj.page === 1 ? 'disabled' : ''} onclick="SiemensReport.setPage('${containerId}', ${stateObj.page - 1})">Prev</button>`;
        html += `<span class="page-info">Page ${stateObj.page} of ${totalPages}</span>`;
        html += `<button ${stateObj.page === totalPages ? 'disabled' : ''} onclick="SiemensReport.setPage('${containerId}', ${stateObj.page + 1})">Next</button>`;
        
        container.innerHTML = html;

        // We bind the drawFn so setPage can call it
        container.dataset.stateKey = containerId.split('-')[0];
    }

    function setPage(containerId, newPage) {
        const key = containerId.split('-')[0];
        if (state[key]) {
            state[key].page = newPage;
            // Redraw specific tab
            if (key === 'tab1') drawTab1();
            if (key === 'tab2') drawTab2();
            if (key === 'tab3') drawTab3();
            if (key === 'tab4') drawTab4();
            if (key === 'tab5') drawTab5();
        }
    }

    function sortTable(tab, colIdx, propName) {
        const tabState = state[tab];
        if (tabState.sortCol === colIdx) {
            tabState.sortDir = tabState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            tabState.sortCol = colIdx;
            tabState.sortDir = 'asc';
        }

        tabState.filtered.sort((a, b) => {
            let valA = a[propName] ? String(a[propName]) : '';
            let valB = b[propName] ? String(b[propName]) : '';
            
            // Arrays (properties)
            if (Array.isArray(a[propName])) valA = a[propName].join(' ');
            if (Array.isArray(b[propName])) valB = b[propName].join(' ');

            const cmp = valA.localeCompare(valB, undefined, {numeric: true});
            return tabState.sortDir === 'asc' ? cmp : -cmp;
        });

        tabState.page = 1;
        if (tab === 'tab1') drawTab1();
        if (tab === 'tab2') drawTab2();
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    return {
        render: render,
        applyFilters: applyFilters,
        setPage: setPage,
        sortTable: sortTable,
        getResults: () => currentResults,
        getTab1Data: () => state.tab1.filtered,
        getTab2Data: () => state.tab2.filtered,
        getTab4Data: () => state.tab4.filtered,
        getTab5Data: () => state.tab5.filtered
    };
})();
