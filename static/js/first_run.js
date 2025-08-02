import { fetchFirstRunStatusApi } from './api.js';

// Store the state to prevent re-fetching on simple UI updates
let firstRunStatuses = {};

/**
 * Fetches the first-run status for a list of rule IDs from the backend.
 * This is called only when the rules table is rendered.
 * @param {string[]} ruleIds - An array of rule IDs to check.
 */
async function fetchFirstRunStatuses(ruleIds) {
    if (ruleIds.length === 0) {
        firstRunStatuses = {};
        return;
    }

    try {
        const response = await fetchFirstRunStatusApi(ruleIds);
        if (response.success) {
            firstRunStatuses = response.statuses;
        } else {
            console.error('Failed to fetch first-run statuses:', response.message);
            firstRunStatuses = {}; // Clear on failure to avoid stale data
        }
    } catch (error) {
        console.error('Error fetching first-run statuses:', error);
        firstRunStatuses = {};
    }
}

/**
 * Applies a visual glow to the "Run" buttons of rules that have never been run.
 * @param {string[]} ruleIds - The IDs of all rules currently in the table.
 */
export async function applyFirstRunVisuals(ruleIds) {
    await fetchFirstRunStatuses(ruleIds);
    
    const ruleRows = document.querySelectorAll('#rules-table tbody tr');
    ruleRows.forEach(row => {
        const ruleId = row.dataset.ruleId;
        const runButton = row.querySelector('.run-button');
        if (!runButton) return;

        if (firstRunStatuses[ruleId]) {
            runButton.classList.add('first-run-glow');
            // The title is now more generic as it doesn't lead to a different modal
            runButton.title = 'First run! This will open the manual run options.';
        } else {
            runButton.classList.remove('first-run-glow');
            runButton.title = 'Run this rule now';
        }
    });
}