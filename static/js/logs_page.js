import {
    fetchClientSettings,
    getLogStats,
    searchRuns,
    lookupRuleInfo,
    lookupFileInfo,
    fetchAllServices,
    loadRules,
    availableServices,
    currentlyLoadedRules
} from './api.js';

let statsChartInstance = null;
const DEFAULT_RECORDS_PER_PAGE = 50;
let currentLogSearchParams = {
    limit: DEFAULT_RECORDS_PER_PAGE,
    offset: 0,
    sort_by: 'timestamp_desc',
    time_frame: '1w'
};

// --- DOM Elements ---
let butlerNameHeader;
// Lookup Elements
let lookupSection, lookupTypeSelect, lookupQueryInput, lookupButton, lookupResultsDiv, lookupLoadingMessage, lookupErrorMessage;
// Chart Elements
let statsTimeFrameSelect, statsCustomDateDiv, statsStartDateInput, statsEndDateInput, updateStatsChartButton, filesProcessedChartCanvas, statsLoadingMessage, statsErrorMessage;

// Detailed Log Elements
let logSearchForm, searchFileHashInput, searchRuleIdInput, searchRunIdInput, searchRuleExecutionIdInput, searchStatusFilterInput, searchTimeFrameSelect, searchCustomDateDiv, searchStartDateInput, searchEndDateInput, searchSortBySelect, searchLogsButton, resetSearchLogsButton, logsLoadingMessage, logsErrorMessage, detailedLogsTableBody, logsPaginationControls, detailedLogsResultsSummary;


// --- Helper and Formatting Functions ---

/**
 * Formats an ISO date string into a more readable local date-time format.
 * @param {string} isoString - The ISO date string.
 * @returns {string} The formatted date string or 'N/A'.
 */
function formatTimestamp(isoString) {
    if (!isoString) return 'N/A';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return date.toLocaleString();
    } catch (e) {
        return isoString;
    }
}

/**
 * Formats a JSON object into a pretty-printed string.
 * @param {object|string} data - The JSON object or string.
 * @returns {string} The formatted JSON string.
 */
function prettyPrintJson(data) {
    if (data === null || data === undefined) return 'N/A';
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch (e) {
            return data;
        }
    }
    return JSON.stringify(data, null, 2);
}

// --- Rendering Functions (Previously in Adapter) ---

/**
 * Renders rule lookup info in a simple grid format.
 * @param {object} data - The rule data from the API.
 * @returns {string} HTML string for the rule information.
 */
function renderRuleInfoContent(data) {
    const { stats, set } = data;
    return `
        <h3>Rule: ${data.rule_name}</h3>
        <div class="lookup-grid">
            <div><strong>Rule ID:</strong></div><div><code>${data.rule_id}</code></div>
            <div><strong>Created:</strong></div><div>${formatTimestamp(data.creation_timestamp)}</div>
            <div><strong>Part of Set:</strong></div><div>${set ? `${set.name} (<code>${set.id}</code>)` : 'None'}</div>
            <div><strong>Schedule:</strong></div><div>${data.execution_override || 'Default'} (${data.interval_seconds ? `${data.interval_seconds}s` : 'Global'})</div>
            <div><strong>Has Been Run:</strong></div><div>${data.has_been_run ? 'Yes' : 'No'}</div>
            <div><strong>Total Runs:</strong></div><div>${stats.total_runs || 0}</div>
            <div><strong>Total Successes:</strong></div><div>${stats.total_successes || 0}</div>
            <div><strong>Total Files Processed:</strong></div><div>${stats.total_files_processed || 0}</div>
            <div><strong>Last Run:</strong></div><div>${stats.last_run_time ? formatTimestamp(stats.last_run_time) : 'Never'}</div>
        </div>
    `;
}

/**
 * Renders file lookup info with state and a modern history timeline.
 * @param {object} data - The file data from the API.
 * @returns {string} HTML string for the file information.
 */
function renderFileInfoContent(data) {
    const getRuleName = (ruleId) => {
        if (!currentlyLoadedRules) return `Unknown Rule (${ruleId.substring(0, 8)})`;
        const rule = currentlyLoadedRules.find(r => r.id === ruleId);
        return rule ? rule.name : `Unknown Rule (${ruleId.substring(0, 8)})`;
    };

    const getServiceNameByKey = (key) => {
        if (!availableServices) return key;
        const service = availableServices.find(s => s.service_key === key);
        return service ? service.name : key;
    };

    let stateHtml = '<h4>Current State</h4>';
    if (data.state) {
        let rulesInAppHtml = '<p>None</p>';
        if (data.state.rules_in_application && Array.isArray(data.state.rules_in_application) && data.state.rules_in_application.length > 0) {
            const ruleNames = data.state.rules_in_application.map(id => `<li>${getRuleName(id)} <code class="short-code">(${id.substring(0, 8)}...)</code></li>`).join('');
            rulesInAppHtml = `<ul>${ruleNames}</ul>`;
        }

        let placementHtml = '<p>None</p>';
        if (data.state.correct_placement && Array.isArray(data.state.correct_placement) && data.state.correct_placement.length > 0) {
            const serviceNames = data.state.correct_placement.map(key => {
                const name = getServiceNameByKey(key);
                return `<li>${name} <code class="short-code">(${key.substring(0, 10)}...)</code></li>`;
            }).join('');
            placementHtml = `<ul>${serviceNames}</ul>`;
        }

        stateHtml += `
            <div class="lookup-grid">
                <div><strong>Last Updated:</strong></div><div>${formatTimestamp(data.state.last_updated)}</div>
                <div><strong>Rules in Application:</strong></div><div>${rulesInAppHtml}</div>
                <div><strong>Correct Placement:</strong></div><div>${placementHtml}</div>
                <div><strong>Force-In Priority:</strong></div><div>${data.state.force_in_priority_governance}</div>
                <div><strong>Rating Governance:</strong></div><div><details><summary>View JSON</summary><pre>${prettyPrintJson(data.state.rating_priority_governance)}</pre></details></div>
            </div>`;
    } else {
        stateHtml += '<p>This file is not currently tracked in the state table.</p>';
    }

    let historyHtml = '<h4>Event History</h4>';
    if (data.history && data.history.length > 0) {
        historyHtml += '<div class="modern-timeline">';
        data.history.forEach(event => {
            const iconClass = event.event_status === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
            historyHtml += `
                <div class="modern-timeline-item status-${event.event_status}">
                    <div class="timeline-icon"><i class="fas ${iconClass}"></i></div>
                    <div class="timeline-body">
                        <div class="timeline-header">
                            <strong class="timeline-title">${event.rule_name}</strong>
                            <span class="timeline-time">${formatTimestamp(event.start_time)}</span>
                        </div>
                        <p class="timeline-message">${event.message || 'Execution details below.'}</p>
                        ${event.details_json ? `<details><summary>Details</summary><pre>${prettyPrintJson(event.details_json)}</pre></details>` : ''}
                    </div>
                </div>`;
        });
        historyHtml += '</div>';
    } else {
        historyHtml += '<p>No historical log events found for this file.</p>';
    }

    return stateHtml + '<hr style="border-color: var(--border-color); margin: 20px 0;">' + historyHtml;
}

/**
 * Renders a single log entry as a table row.
 * @param {object} log - The log entry data.
 * @returns {string} HTML string for a `<tr>` element.
 */
function renderDetailedLogRow(log) {
    const runIdParts = log.parent_run_id.split('_');
    const shortRunId = runIdParts[runIdParts.length - 1].substring(0, 8);

    let summaryHtml = log.summary_message || '';
    if (log.details_json) {
        summaryHtml += `<details><summary>Execution Details</summary><pre>${prettyPrintJson(log.details_json)}</pre></details>`;
    }

    const statusClass = log.status === 'success' ? 'status-success' : log.status === 'failure' ? 'status-failure' : '';

    return `
        <tr>
            <td>${formatTimestamp(log.start_time)}</td>
            <td class="clickable-cell" data-action="lookup-rule" data-rule-id="${log.rule_id}" title="Click to lookup rule: ${log.rule_name}">${log.rule_name}</td>
            <td>
                Matched: ${log.matched_search_count}<br>
                Eligible: ${log.eligible_for_action_count}<br>
                Succeeded: ${log.actions_succeeded_count}<br>
                Failed: ${log.actions_failed_count}
            </td>
            <td class="${statusClass}">${log.status}</td>
            <td>${summaryHtml}</td>
            <td class="clickable-cell" data-action="filter-run" data-run-id="${log.parent_run_id}" title="Click to filter by Run ID: ${log.parent_run_id}">run#${shortRunId}</td>
            <td class="clickable-cell" data-action="filter-exec" data-exec-id="${log.run_log_id}" title="Click to filter by Execution ID: ${log.run_log_id}">${log.run_log_id.substring(0, 8)}...</td>
        </tr>
    `;
}

// --- Page Sections Logic ---

/**
 * Updates the butler name in the header using settings passed from the template.
 */
function updateButlerNameDisplay() {
    const butlerName = window.HYDRUS_BUTLER_SETTINGS?.butler_name;
    if (butlerNameHeader && butlerName) {
        butlerNameHeader.textContent = `${butlerName} - Activity Logs`;
    }
}

/**
 * Handles the main lookup form submission.
 */
async function handleLookup() {
    const type = lookupTypeSelect.value;
    const query = lookupQueryInput.value.trim();

    if (!query) {
        lookupErrorMessage.textContent = 'Please enter a Rule ID or File Hash to look up.';
        lookupErrorMessage.style.display = 'block';
        return;
    }

    lookupLoadingMessage.style.display = 'block';
    lookupErrorMessage.style.display = 'none';
    lookupResultsDiv.innerHTML = '';

    let result;
    if (type === 'rule_id') {
        result = await lookupRuleInfo(query);
        if (result.success) lookupResultsDiv.innerHTML = renderRuleInfoContent(result.data);
    } else {
        result = await lookupFileInfo(query);
        if (result.success) lookupResultsDiv.innerHTML = renderFileInfoContent(result.data);
    }

    lookupLoadingMessage.style.display = 'none';
    if (!result.success) {
        lookupErrorMessage.textContent = `Lookup failed: ${result.message || 'Unknown error'}`;
        lookupErrorMessage.style.display = 'block';
    }
}

function initializeLookupSection() {
    lookupButton.addEventListener('click', handleLookup);
    lookupQueryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLookup();
        }
    });
}

/**
 * Fetches and renders the log statistics chart.
 */
async function loadAndRenderLogStats() {
    if (!statsTimeFrameSelect || !filesProcessedChartCanvas) return;

    statsLoadingMessage.style.display = 'block';
    statsErrorMessage.style.display = 'none';
    if (statsChartInstance) {
        statsChartInstance.destroy();
        statsChartInstance = null;
    }

    const timeFrame = statsTimeFrameSelect.value;
    const startDate = (timeFrame === 'custom') ? statsStartDateInput.value : null;
    const endDate = (timeFrame === 'custom') ? statsEndDateInput.value : null;

    if (timeFrame === 'custom' && (!startDate || !endDate)) {
        statsLoadingMessage.style.display = 'none';
        statsErrorMessage.textContent = 'For custom range, both start and end dates are required.';
        statsErrorMessage.style.display = 'block';
        return;
    }

    const result = await getLogStats(timeFrame, startDate, endDate);

    statsLoadingMessage.style.display = 'none';
    if (result.success && result.data) {
        if (result.data.length === 0) {
            statsErrorMessage.textContent = `No rule activity found for the selected period (${result.time_frame_used}).`;
            statsErrorMessage.style.display = 'block';
            return;
        }
        renderFilesProcessedChart(result.data);
    } else {
        statsErrorMessage.textContent = `Failed to load statistics: ${result.message || 'Unknown error'}`;
        statsErrorMessage.style.display = 'block';
    }
}

/**
 * Renders the bar chart for files processed by rules.
 * @param {Array<object>} data - The statistics data from the API.
 */
function renderFilesProcessedChart(data) {
    const labels = data.map(item => item.rule_name);
    const values = data.map(item => item.total_success_count);

    const ctx = filesProcessedChartCanvas.getContext('2d');
    statsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Files Successfully Actioned',
                data: values,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                y: { beginAtZero: true },
                x: { title: { display: true, text: 'Number of Files' } }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Top Rules by Files Processed' }
            }
        }
    });
}

function initializeLogStats() {
    statsTimeFrameSelect.addEventListener('change', () => {
        statsCustomDateDiv.style.display = statsTimeFrameSelect.value === 'custom' ? 'block' : 'none';
    });
    updateStatsChartButton.addEventListener('click', loadAndRenderLogStats);
    loadAndRenderLogStats();
}

/**
 * Fetches and renders the detailed log entries.
 * @param {number} [page=1] - The page number to fetch.
 */
async function loadAndRenderDetailedLogs(page = 1) {
    logsLoadingMessage.style.display = 'block';
    logsErrorMessage.style.display = 'none';
    detailedLogsTableBody.innerHTML = '';
    logsPaginationControls.innerHTML = '';
    detailedLogsResultsSummary.textContent = '';

    currentLogSearchParams.offset = (page - 1) * currentLogSearchParams.limit;

    const result = await searchRuns(currentLogSearchParams);
    logsLoadingMessage.style.display = 'none';

    if (result.success && result.logs) {
        if (result.logs.length === 0) {
            detailedLogsResultsSummary.textContent = 'No rule executions found matching your criteria.';
        } else {
            detailedLogsResultsSummary.textContent = `Showing ${currentLogSearchParams.offset + 1}-${currentLogSearchParams.offset + result.logs.length} of ${result.total_records} executions.`;
            
            const tableHtml = result.logs.map(log => renderDetailedLogRow(log)).join('');
            detailedLogsTableBody.innerHTML = tableHtml;

            renderPaginationControls(result.total_records, currentLogSearchParams.limit, currentLogSearchParams.offset);
        }
    } else {
        logsErrorMessage.textContent = `Failed to load logs: ${result.message || 'Unknown error'}`;
        logsErrorMessage.style.display = 'block';
    }
}

/**
 * Renders pagination controls for the detailed logs table.
 * @param {number} totalRecords - Total number of available records.
 * @param {number} limit - Records per page.
 * @param {number} currentOffset - The offset of the current page.
 */
function renderPaginationControls(totalRecords, limit, currentOffset) {
    logsPaginationControls.innerHTML = '';
    if (totalRecords <= limit) return;

    const totalPages = Math.ceil(totalRecords / limit);
    const currentPage = Math.floor(currentOffset / limit) + 1;

    const prevButton = document.createElement('button');
    prevButton.textContent = 'Previous';
    prevButton.disabled = currentPage === 1;
    prevButton.addEventListener('click', () => loadAndRenderDetailedLogs(currentPage - 1));
    logsPaginationControls.appendChild(prevButton);

    const pageInfo = document.createElement('span');
    pageInfo.textContent = ` Page ${currentPage} of ${totalPages} `;
    logsPaginationControls.appendChild(pageInfo);

    const nextButton = document.createElement('button');
    nextButton.textContent = 'Next';
    nextButton.disabled = currentPage === totalPages;
    nextButton.addEventListener('click', () => loadAndRenderDetailedLogs(currentPage + 1));
    logsPaginationControls.appendChild(nextButton);
}

/**
 * Handles the submission of the log search form.
 * @param {Event} event - The form submission event.
 */
function handleLogSearchFormSubmit(event) {
    event.preventDefault();
    currentLogSearchParams.file_hash = searchFileHashInput.value.trim();
    currentLogSearchParams.rule_id = searchRuleIdInput.value.trim();
    currentLogSearchParams.run_id = searchRunIdInput.value.trim();
    currentLogSearchParams.rule_execution_id = searchRuleExecutionIdInput.value.trim();
    currentLogSearchParams.status_filter = searchStatusFilterInput.value.trim();
    currentLogSearchParams.sort_by = searchSortBySelect.value;
    currentLogSearchParams.time_frame = searchTimeFrameSelect.value;

    if (currentLogSearchParams.time_frame === 'custom') {
        currentLogSearchParams.start_date = searchStartDateInput.value;
        currentLogSearchParams.end_date = searchEndDateInput.value;
        if (!currentLogSearchParams.start_date || !currentLogSearchParams.end_date) {
            logsErrorMessage.textContent = 'For custom range, both start and end dates are required.';
            logsErrorMessage.style.display = 'block';
            return;
        }
    } else {
        delete currentLogSearchParams.start_date;
        delete currentLogSearchParams.end_date;
    }
    loadAndRenderDetailedLogs(1);
}

/**
 * Resets the log search form and reloads the default log view.
 */
function resetLogSearchForm() {
    logSearchForm.reset();
    searchCustomDateDiv.style.display = 'none';
    Object.keys(currentLogSearchParams).forEach(key => {
        if (['limit', 'offset', 'sort_by', 'time_frame'].includes(key)) return;
        currentLogSearchParams[key] = '';
    });
    currentLogSearchParams.time_frame = '1w';
    currentLogSearchParams.sort_by = 'timestamp_desc';
    loadAndRenderDetailedLogs(1);
}

function initializeDetailedLogsSearch() {
    searchTimeFrameSelect.addEventListener('change', () => {
        searchCustomDateDiv.style.display = searchTimeFrameSelect.value === 'custom' ? 'block' : 'none';
    });
    logSearchForm.addEventListener('submit', handleLogSearchFormSubmit);
    resetSearchLogsButton.addEventListener('click', resetLogSearchForm);
    
    detailedLogsTableBody.addEventListener('click', (event) => {
        const cell = event.target.closest('.clickable-cell');
        if (!cell) return;

        const action = cell.dataset.action;
        if (action === 'lookup-rule') {
            lookupTypeSelect.value = 'rule_id';
            lookupQueryInput.value = cell.dataset.ruleId;
            handleLookup();
            lookupSection.scrollIntoView({ behavior: 'smooth' });
        } else if (action === 'filter-run') {
            searchRunIdInput.value = cell.dataset.runId;
            logSearchForm.requestSubmit();
        } else if (action === 'filter-exec') {
            searchRuleExecutionIdInput.value = cell.dataset.execId;
            logSearchForm.requestSubmit();
        }
    });

    loadAndRenderDetailedLogs(1);
}


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', async () => {
    // Assign all DOM elements to variables
    butlerNameHeader = document.getElementById('butler-name-header');
    
    // Lookup Section
    lookupSection = document.getElementById('lookup-section');
    lookupTypeSelect = document.getElementById('lookup-type');
    lookupQueryInput = document.getElementById('lookup-query');
    lookupButton = document.getElementById('lookup-button');
    lookupResultsDiv = document.getElementById('lookup-results-container');
    lookupLoadingMessage = document.getElementById('lookup-loading-message');
    lookupErrorMessage = document.getElementById('lookup-error-message');

    // Stats Section
    statsTimeFrameSelect = document.getElementById('stats-time-frame');
    statsCustomDateDiv = document.getElementById('stats-custom-date-range');
    statsStartDateInput = document.getElementById('stats-start-date');
    statsEndDateInput = document.getElementById('stats-end-date');
    updateStatsChartButton = document.getElementById('update-stats-chart-button');
    filesProcessedChartCanvas = document.getElementById('filesProcessedChart');
    statsLoadingMessage = document.getElementById('stats-loading-message');
    statsErrorMessage = document.getElementById('stats-error-message');
    
    // Detailed Logs Section
    logSearchForm = document.getElementById('log-search-form');
    searchFileHashInput = document.getElementById('search-file-hash');
    searchRuleIdInput = document.getElementById('search-rule-id');
    searchRunIdInput = document.getElementById('search-run-id');
    searchRuleExecutionIdInput = document.getElementById('search-rule-execution-id');
    searchStatusFilterInput = document.getElementById('search-status-filter');
    searchTimeFrameSelect = document.getElementById('search-time-frame');
    searchCustomDateDiv = document.getElementById('search-custom-date-range');
    searchStartDateInput = document.getElementById('search-start-date');
    searchEndDateInput = document.getElementById('search-end-date');
    searchSortBySelect = document.getElementById('search-sort-by');
    resetSearchLogsButton = document.getElementById('reset-search-logs-button');
    logsLoadingMessage = document.getElementById('logs-loading-message');
    logsErrorMessage = document.getElementById('logs-error-message');
    detailedLogsTableBody = document.getElementById('detailed-logs-table-body');
    logsPaginationControls = document.getElementById('logs-pagination-controls');
    detailedLogsResultsSummary = document.getElementById('detailed-logs-results-summary');

    try {
        await fetchClientSettings();

        updateButlerNameDisplay();

        // Load contextual data needed for lookups and rendering
        await Promise.all([fetchAllServices(), loadRules()]);

        // Initialize all sections of the page
        initializeLookupSection();
        initializeLogStats();
        initializeDetailedLogsSearch();
        
    } catch (error) {
        console.error("Error initializing logs page:", error);
        document.body.innerHTML = '<h1>Error Initializing Page</h1><p>Could not load necessary data. Please check the console and refresh.</p>';
    }
});