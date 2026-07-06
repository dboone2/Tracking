// =================================================================
// 1. DATA DICTIONARIES & CONSTANTS (3-Tier Active + Repaired)
// =================================================================
const statuses = [
    { value:'S1',  label:'S1',  cssClass:'S1',  description:'Severity 1 — Water in Aisleway',  sub:'Water present in forklift traffic or pedestrian lanes.' },
    { value:'S2',  label:'S2',  cssClass:'S2',  description:'Severity 2 — Water on Equipment', sub:'Water contacting production machinery, lines, or facility systems.' },
    { value:'S3',  label:'S3',  cssClass:'S3',  description:'Severity 3 — Water on Electrical / Address Immediately', sub:'Immediate hazard. Water on power boxes, bus bars, control panels, or exposed wiring.' },
    { value:'REP', label:'REP', cssClass:'REP', description:'Repaired — Leak Resolved',          sub:'Roof leak repair is completed and signed off.' }
];

// Cleaned Rows: Removed 'A/B', 'B-C', 'CC', 'G-J', and 'JN'
const customRows = [
    'AA','A','B','C','D','E','F',
    'G','H','J','K','L','M','N','P','Q','R','S'
];

const customCols = [
    '47','46','45','44','43','42','41','40','39','38','37','36','35',
    '34','33','32','31','30','29','28','27','26','25','24','23','22',
    '21','20','19','18','17','16','15','14','13','12','11','10','9',
    '8','7','6','5','4','3','2','1',
    '01','02','03','04','05','06','07','08','09','010','011','012','013'
];

// =================================================================
// 2. CENTRAL STATE ENGINE
// =================================================================
let gridData = {};      
let bayHistory = {};    
let fullRecords = [];   
let dynamicBuildings = new Set();
let hideRepMode = false;

window.addEventListener('DOMContentLoaded', () => {
    const savedGrid = localStorage.getItem('leak_grid_data');
    const savedHist = localStorage.getItem('leak_bay_history');
    const savedRecs = localStorage.getItem('leak_raw_records');

    if (savedGrid && savedHist && savedRecs) {
        try {
            gridData = JSON.parse(savedGrid);
            bayHistory = JSON.parse(savedHist);
            fullRecords = JSON.parse(savedRecs);
            
            dynamicBuildings.clear();
            fullRecords.forEach(r => {
                if (r.building) dynamicBuildings.add(r.building);
            });
        } catch (e) {
            console.error("Local storage restoration failed, cleaning storage.", e);
            clearTrackerState();
        }
    }

    rebuildDynamicFilters();
    drawVisualizationGrid();
    updateDashboardMetrics();
    setupTooltipHoverEngine();
});

function saveStateToLocalStorage() {
    localStorage.setItem('leak_grid_data', JSON.stringify(gridData));
    localStorage.setItem('leak_bay_history', JSON.stringify(bayHistory));
    localStorage.setItem('leak_raw_records', JSON.stringify(fullRecords));
}

function clearTrackerState() {
    if (confirm("Are you sure you want to delete all loaded roof leak records?")) {
        localStorage.clear();
        gridData = {};
        bayHistory = {};
        fullRecords = [];
        dynamicBuildings.clear();
        
        rebuildDynamicFilters();
        drawVisualizationGrid();
        updateDashboardMetrics();
        alert("System data wiped successfully!");
    }
}

// =================================================================
// 3. CSV PARSER INTERFACES
// =================================================================
function triggerCSVInput() {
    document.getElementById('csvFileInput').click();
}

function handleCSVUpload(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        importCSVDatabase(e.target.result);
    };
    reader.readAsText(file);
    inputElement.value = ''; 
}

function parseCSVText(text) {
    let result = [];
    let isInsideQuotes = false;
    let currentRow = [''];
    
    for (let i = 0; i < text.length; i++) {
        let currentChar = text[i];
        let nextChar = text[i + 1];
        
        if (currentChar === '"') {
            if (isInsideQuotes && nextChar === '"') {
                currentRow[currentRow.length - 1] += '"'; 
                i++;
            } else {
                isInsideQuotes = !isInsideQuotes; 
            }
        } else if (currentChar === ',' && !isInsideQuotes) {
            currentRow.push(''); 
        } else if ((currentChar === '\r' || currentChar === '\n') && !isInsideQuotes) {
            if (currentChar === '\r' && nextChar === '\n') { i++; } 
            result.push(currentRow);
            currentRow = [''];
        } else {
            currentRow[currentRow.length - 1] += currentChar;
        }
    }
    if (currentRow.length > 1 || currentRow[0] !== '') {
        result.push(currentRow);
    }
    return result;
}

// =================================================================
// 4. COORDINATES LOOKAROUND LOCATOR
// =================================================================
function extractBaysFromLocation(locationString) {
    if (!locationString) return [];
    const keys = new Set();
    const clean = locationString.toUpperCase().replace(/\s+/g, ' ').trim();
    
    const sortedRows = [...customRows].sort((a,b) => b.length - a.length);
    const rowRegexPart = '(' + sortedRows.map(r => r.replace('/', '\\/').replace('-', '\\-')).join('|') + ')';
    
    const multiColRegex = new RegExp(`\\b${rowRegexPart}[-/_\\s]*(\\d+)(?:[-/,_\\s]+(\\d+))+\\b`, 'g');
    let match;
    while ((match = multiColRegex.exec(clean)) !== null) {
        const row = match[1];
        const rowSegment = match[0];
        const cols = rowSegment.match(/\d+/g);
        if (cols) {
            cols.forEach(c => {
                const normalizedCol = normalizeCol(c);
                if (normalizedCol) keys.add(`${row}-${normalizedCol}`);
            });
        }
    }
    
    const rowRangeRegex = new RegExp(`\\b${rowRegexPart}[-/_\\s]*(\\d+)\\s*-\\s*${rowRegexPart}[-/_\\s]*\\2\\b`, 'g');
    while ((match = rowRangeRegex.exec(clean)) !== null) {
        const r1 = match[1];
        const col = match[2];
        const r2 = match[3];
        const normalizedCol = normalizeCol(col);
        if (normalizedCol) {
            const idx1 = customRows.indexOf(r1);
            const idx2 = customRows.indexOf(r2);
            if (idx1 !== -1 && idx2 !== -1) {
                for (let i = Math.min(idx1, idx2); i <= Math.max(idx1, idx2); i++) {
                    keys.add(`${customRows[i]}-${normalizedCol}`);
                }
            }
        }
    }

    const standardRegex = new RegExp(`(?:\\b|[^A-Z0-9])${rowRegexPart}[-/_\\s]*(\\d+(?:\\.\\d+)?)(?:\\b|[^A-Z0-9])`, 'g');
    standardRegex.lastIndex = 0;
    while ((match = standardRegex.exec(" " + clean + " ")) !== null) {
        const row = match[1];
        const normalizedCol = normalizeCol(match[2]);
        if (normalizedCol) {
            keys.add(`${row}-${normalizedCol}`);
        }
    }

    return Array.from(keys);
}

function normalizeCol(raw) {
    raw = String(raw).trim();
    const hasLeadingZero = raw.length > 1 && raw[0] === '0' && !raw.includes('.');

    let c = parseFloat(raw);
    if (isNaN(c)) return null;
    c = Math.round(c);

    if (hasLeadingZero) {
        const padded = c < 10 ? '0' + c : String(c);
        if (customCols.includes(padded)) return padded;
    }

    const asStr = String(c);
    if (customCols.includes(asStr)) return asStr;

    if (c < 10) {
        const padded = '0' + c;
        if (customCols.includes(padded)) return padded;
    }

    return null;
}

// =================================================================
// 5. TRANSLATION PIPELINE
// =================================================================
function importCSVDatabase(rawCsvString) {
    const lines = parseCSVText(rawCsvString);
    if (lines.length < 2) {
        alert("The selected spreadsheet lacks valid header or row rows.");
        return;
    }

    const headers = lines[0].map(h => h.trim());
    const indices = {
        building: headers.findIndex(h => h.toLowerCase().includes('building')),
        location: headers.findIndex(h => h.toLowerCase().includes('location')),
        date: headers.findIndex(h => h.toLowerCase().includes('date')),
        status: headers.findIndex(h => h.toLowerCase().includes('status')),
        severity: headers.findIndex(h => h.toLowerCase().includes('severity')),
        notes: headers.findIndex(h => h.toLowerCase().includes('notes')),
        reportedBy: headers.findIndex(h => h.toLowerCase().replace(/\s/g, '').includes('reportedby'))
    };

    if (indices.location === -1) {
        alert("Parsing Error: Could not locate 'Location' column inside the CSV file.");
        return;
    }

    gridData = {};
    bayHistory = {};
    fullRecords = [];
    dynamicBuildings.clear();

    let successfullyImportedRows = 0;
    let totalMappedBayCount = 0;

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (row.length === 1 && row[0] === '') continue; 

        const bld = indices.building !== -1 ? (row[indices.building] || '').trim() : '';
        const loc = indices.location !== -1 ? (row[indices.location] || '').trim() : '';
        const dte = indices.date !== -1 ? (row[indices.date] || '').trim() : '';
        const statRaw = indices.status !== -1 ? (row[indices.status] || '').trim() : '';
        const sevRaw = indices.severity !== -1 ? (row[indices.severity] || '').trim() : '';
        const nts = indices.notes !== -1 ? (row[indices.notes] || '').trim() : '';
        const repBy = indices.reportedBy !== -1 ? (row[indices.reportedBy] || '').trim() : '';

        if (bld) dynamicBuildings.add(bld);

        let derivedStatus = 'S1'; 
        
        if (statRaw.toLowerCase() === 'repaired') {
            derivedStatus = 'REP';
        } else if (sevRaw) {
            const cleanSev = sevRaw.toUpperCase().trim();
            if (cleanSev === 'S1') {
                derivedStatus = 'S1';
            } else if (cleanSev === 'S2') {
                derivedStatus = 'S2';
            } else if (cleanSev === 'S3' || cleanSev === 'S4' || cleanSev === 'S5') {
                derivedStatus = 'S3'; 
            }
        }

        const structuralRecord = {
            id: i,
            building: bld,
            location: loc,
            date: dte || new Date().toLocaleDateString(),
            status: statRaw,
            severity: sevRaw,
            derivedStatus: derivedStatus,
            notes: nts,
            reportedBy: repBy
        };

        fullRecords.push(structuralRecord);

        const matchedBays = extractBaysFromLocation(loc);
        if (matchedBays.length > 0) {
            matchedBays.forEach(bay => {
                if (!bayHistory[bay]) {
                    bayHistory[bay] = [];
                }
                bayHistory[bay].push(structuralRecord);
                totalMappedBayCount++;
            });
            successfullyImportedRows++;
        }
    }

    Object.keys(bayHistory).forEach(bay => {
        bayHistory[bay].sort((a, b) => {
            return new Date(a.date) - new Date(b.date);
        });

        const mostRecentReport = bayHistory[bay][bayHistory[bay].length - 1];
        gridData[bay] = mostRecentReport.derivedStatus;
    });

    saveStateToLocalStorage();
    rebuildDynamicFilters();
    drawVisualizationGrid();
    updateDashboardMetrics();

    const toast = document.getElementById('importToast');
    document.getElementById('importToastMsg').innerText = `Processed ${successfullyImportedRows} active records across ${totalMappedBayCount} grid coordinates successfully!`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 6000);
}

// =================================================================
// 6. REBUILD DYNAMIC FILTERS
// =================================================================
function rebuildDynamicFilters() {
    const buildingContainer = document.getElementById('buildingRadioContainer');
    const statusContainer = document.getElementById('statusRadioContainer');

    if (!buildingContainer || !statusContainer) return;

    const selectedBuilding = document.querySelector('input[name="filterBuilding"]:checked')?.value || 'All';
    const selectedStatus = document.querySelector('input[name="filterStatus"]:checked')?.value || 'All';

    let buildingHtml = `
        <label class="radio-label">
            <input type="radio" name="filterBuilding" value="All" ${selectedBuilding === 'All' ? 'checked' : ''} onchange="applyFilters()">
            <span class="radio-text">All Buildings</span>
        </label>
    `;
    
    const sorted = Array.from(dynamicBuildings).sort();
    sorted.forEach(b => {
        buildingHtml += `
            <label class="radio-label">
                <input type="radio" name="filterBuilding" value="${b}" ${selectedBuilding === b ? 'checked' : ''} onchange="applyFilters()">
                <span class="radio-text">${b}</span>
            </label>
        `;
    });
    buildingContainer.innerHTML = buildingHtml;

    let statusHtml = `
        <label class="radio-label">
            <input type="radio" name="filterStatus" value="All" ${selectedStatus === 'All' ? 'checked' : ''} onchange="applyFilters()">
            <span class="radio-text">All Statuses</span>
        </label>
    `;

    statuses.forEach(s => {
        statusHtml += `
            <label class="radio-label">
                <input type="radio" name="filterStatus" value="${s.value}" ${selectedStatus === s.value ? 'checked' : ''} onchange="applyFilters()">
                <span class="radio-text"><span class="status-pill-text status-${s.value}">${s.label}</span></span>
            </label>
        `;
    });

    statusHtml += `
        <label class="radio-label">
            <input type="radio" name="filterStatus" value="Unspecified" ${selectedStatus === 'Unspecified' ? 'checked' : ''} onchange="applyFilters()">
            <span class="radio-text">Empty Bays</span>
        </label>
    `;

    statusContainer.innerHTML = statusHtml;
}

// =================================================================
// 6b. APPLY FILTERS (called by radio onchange)
// =================================================================
function applyFilters() {
    drawVisualizationGrid();
}

// =================================================================
// 7. DRAW VISUALIZATION GRID
// =================================================================
function drawVisualizationGrid() {
    const table = document.getElementById('mainGrid');
    
    const selectedBuildingFilter = document.querySelector('input[name="filterBuilding"]:checked')?.value || 'All';
    const selectedStatusFilter = document.querySelector('input[name="filterStatus"]:checked')?.value || 'All';

    let html = '';

    html += '<thead><tr><th></th>';
    customCols.forEach(col => {
        html += `<th>${col}</th>`;
    });
    html += '</tr></thead><tbody>';

    customRows.forEach(row => {
        html += '<tr>';
        html += `<td class="row-label">${row}</td>`;
        
        customCols.forEach(col => {
            const cellKey = `${row}-${col}`;
            let currentStatus = (gridData[cellKey] || '').toString().trim().toUpperCase();
            const logs = bayHistory[cellKey] || [];
            
            let isGrayedOut = false;
            if (selectedBuildingFilter !== 'All' && logs.length > 0) {
                const hasMatchingBuildingReport = logs.some(l => l.building === selectedBuildingFilter);
                if (!hasMatchingBuildingReport) {
                    isGrayedOut = true;
                }
            }

            if (selectedStatusFilter !== 'All' && currentStatus) {
                if (selectedStatusFilter === 'Unspecified' && currentStatus !== '') {
                    isGrayedOut = true;
                } else if (selectedStatusFilter !== 'Unspecified' && currentStatus.toLowerCase() !== selectedStatusFilter.toLowerCase()) {
                    isGrayedOut = true;
                }
            }

            const cleanStatusLabel = currentStatus ? currentStatus.replace('+', '').trim().toUpperCase() : '';
            
            const statusClass = (currentStatus && !isGrayedOut) 
                ? `status-${cleanStatusLabel} status-${cleanStatusLabel.toLowerCase()}` 
                : '';
            const commentClass = (logs.length > 0 && !isGrayedOut) ? 'has-comments' : '';
            const displayLabel = (currentStatus && !isGrayedOut) ? currentStatus : '';

            let inlineStyle = isGrayedOut ? 'opacity: 0.15; cursor: not-allowed;' : '';
            if (currentStatus && !isGrayedOut) {
                if (cleanStatusLabel === 'S1') {
                    inlineStyle += ' background-color: #facc15 !important; color: #000000 !important;';
                } else if (cleanStatusLabel === 'S2') {
                    inlineStyle += ' background-color: #f97316 !important; color: #ffffff !important;';
                } else if (cleanStatusLabel === 'S3') {
                    inlineStyle += ' background-color: #ef4444 !important; color: #ffffff !important;';
                } else if (cleanStatusLabel === 'REP') {
                    inlineStyle += ' background-color: #22c55e !important; color: #ffffff !important;';
                }
            }

            html += `
                <td id="cell-${cellKey}" 
                    class="grid-cell ${statusClass} ${commentClass}" 
                    data-key="${cellKey}" 
                    ondblclick="viewBayHistoryModal('${cellKey}')"
                    style="${inlineStyle}">
                    ${displayLabel}
                </td>
            `;
        });
        html += '</tr>';
    });

    html += '</tbody>';
    table.innerHTML = html;

    const gridPanelTable = document.getElementById('mainGrid');
    if (gridPanelTable) {
        gridPanelTable.classList.toggle('hide-rep', hideRepMode);
    }
}

// =================================================================
// 8. DASHBOARD METRICS SUMMARY COUNTS
// =================================================================
function updateDashboardMetrics() {
    const counts = { 'S1':0, 'S2':0, 'S3':0, 'REP':0 };
    let grandTotalActive = 0;

    Object.keys(gridData).forEach(key => {
        const stat = (gridData[key] || '').toString().trim().toUpperCase();
        if (counts[stat] !== undefined) {
            counts[stat]++;
            if (stat !== 'REP') {
                grandTotalActive++;
            }
        }
    });

    document.getElementById('statActive').innerText = grandTotalActive;
    document.getElementById('statS3').innerText = counts['S3'];
    document.getElementById('statRepaired').innerText = counts['REP'];
    document.getElementById('statTotalRecords').innerText = fullRecords.length;

    const tbody = document.getElementById('summaryBody');
    let html = '';
    let summaryGrandTotal = 0;

    statuses.forEach(s => {
        const count = counts[s.value] || 0;
        summaryGrandTotal += count;

        html += `
            <tr>
                <td class="code-cell"><span class="code-pill status-${s.value}">${s.value}</span></td>
                <td class="desc-cell">
                    ${s.description}
                    <span class="desc-sub">${s.sub}</span>
                </td>
                <td class="count-cell">${count}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    document.getElementById('grandTotal').innerText = summaryGrandTotal;
}

// =================================================================
// 9. DOUBLE-CLICK HISTORY MODAL VIEWER
// =================================================================
function viewBayHistoryModal(key) {
    const logs = bayHistory[key] || [];
    const modal = document.getElementById('historyModal');
    
    document.getElementById('historyModalTitle').innerText = `📋 Complete Historical Logs for Bay ${key}`;
    const container = document.getElementById('historyLog');

    if (logs.length === 0) {
        container.innerHTML = '<p class="no-history">No leak reports are currently registered for this coordinate on the spreadsheet.</p>';
    } else {
                let html = '';
        [...logs].reverse().forEach(log => {

            const cleanStatus = (log.derivedStatus || '').toUpperCase();
            html += `
                <div class="history-entry">
                    <div class="he-meta-row">
                        <span class="code-pill status-${cleanStatus}">${cleanStatus}</span>
                        <span class="he-date">${log.date}</span>
                        <span class="he-building">${log.building}</span>
                    </div>
                    <div class="he-location"><strong>Location:</strong> ${log.location}</div>
                    ${log.reportedBy ? `<div class="he-reported"><strong>Reported By:</strong> ${log.reportedBy}</div>` : ''}
                    ${log.notes ? `<div class="he-notes"><strong>Notes:</strong> ${log.notes}</div>` : ''}
                </div>
            `;

        });
        container.innerHTML = html;
    }

    modal.style.display = 'flex';
}

function closeHistoryModal() {
    document.getElementById('historyModal').style.display = 'none';
}

// =================================================================
// 10. TOGGLE REPAIRED BAYS VISIBILITY
// =================================================================
function toggleRepBays() {
    hideRepMode = !hideRepMode;
    drawVisualizationGrid();
}

// =================================================================
// 11. TOGGLE SUMMARY PANEL
// =================================================================
function toggleSummary() {
    const panel = document.querySelector('.summary-panel');
    const btn = document.getElementById('toggleSummaryBtn');
    if (panel) {
        panel.classList.toggle('collapsed');
        if (btn) {
            const isCollapsed = panel.classList.contains('collapsed');
            btn.innerText = isCollapsed ? '▶' : '◀';
            btn.title = isCollapsed ? 'Expand Summary Panel' : 'Collapse Summary Panel';
        }
    }
}

// =================================================================
// 12. PRINT SCREEN
// =================================================================
function openPrintScreen() {
    window.print();
}

// =================================================================
// 13. TOOLTIP HOVER ENGINE
// =================================================================
function setupTooltipHoverEngine() {
    const tooltip = document.getElementById('customTooltip');
    if (!tooltip) return;

    document.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.grid-cell');
        if (!cell) return;
        const key = cell.dataset.key;
        const logs = bayHistory[key] || [];
        if (logs.length === 0) return;

        const latest = logs[logs.length - 1];
        tooltip.innerHTML = `
            <strong>${key}</strong><br>
            ${latest.building} — ${latest.date}<br>
            ${latest.notes || ''}
        `;
        tooltip.style.display = 'block';
    });

    document.addEventListener('mousemove', (e) => {
        if (tooltip.style.display === 'block') {
            tooltip.style.left = (e.pageX + 15) + 'px';
            tooltip.style.top = (e.pageY + 15) + 'px';
        }
    });

    document.addEventListener('mouseout', (e) => {
        const cell = e.target.closest('.grid-cell');
        if (cell) {
            tooltip.style.display = 'none';
        }
    });
}

