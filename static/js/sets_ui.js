// static/js/sets_ui.js

/**
 * @file This file handles all UI logic for the "Sets" side menu. It includes
 * fetching data, rendering set cards using a built-in adapter, and handling
 * user interactions like running or reordering a set.
 */

// Import necessary functions from the API and UI modules.
import {
    fetchAllSets,
    runSet,
    saveSetConfiguration,
    clientShowRunAllNotificationsSetting,
    currentlyLoadedRules
} from './api.js';
import { showRunSummaryModal } from './modal.js';
import { showManualRunModal } from './rules_actions.js';

/**
 * UI Adapter for rendering set cards.
 */
const SetAdapter = {
    containerSelector: '#sets-list-container',

    /**
     * Formats the execution interval for display on the card.
     * @param {object} set - The set data object.
     * @returns {string} The HTML string for the timing element, or an empty string.
     */
    _formatInterval(set) {
        if (set.execution_override === 'custom' && set.interval_seconds) {
            const totalSeconds = set.interval_seconds;
            let icon = 'fa-clock';
            let text = '';

            if (totalSeconds < 3600) { // Less than an hour -> minutes
                const minutes = Math.round(totalSeconds / 60);
                text = `${minutes}m`;
            } else if (totalSeconds < 86400) { // Less than a day -> hours
                const hours = Math.round(totalSeconds / 3600);
                text = `${hours}h`;
            } else { // Days
                const days = Math.round(totalSeconds / 86400);
                icon = 'fa-calendar-day';
                text = days === 1 ? 'Daily' : `${days}d`;
            }
            return `<div class="set-timing"><i class="fas ${icon}"></i> <span>${text}</span></div>`;
        }

        if (set.execution_override === 'default' || set.execution_override === null) {
            return `<div class="set-timing"><i class="fas fa-globe-americas"></i> <span>Global</span></div>`;
        }

        return '';
    },

    /**
     * Renders the HTML for a single set card.
     * @param {object} set - The set data object.
     * @param {number} ruleCount - The number of rules in the set.
     * @returns {string} The HTML string for the set card.
     */
    renderItem(set, ruleCount) {
        const timingHTML = this._formatInterval(set);

        return `
            <div class="set-card" data-set-id="${set.id}">
                <div class="set-header">
                    <div class="set-name">${set.name}</div>
                    ${timingHTML}
                </div>
                <div class="set-info">
                    <div class="set-info-left">
                        <div class="rule-count">${ruleCount} rule${ruleCount !== 1 ? 's' : ''}</div>
                        <div class="set-reorder-controls">
                            <button class="reorder-btn reorder-set-btn" data-direction="up" title="Move Up">
                                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="2.5"></circle><circle cx="8" cy="13" r="2.5"></circle><circle cx="16" cy="13" r="2.5"></circle></svg>
                            </button>
                            <button class="reorder-btn reorder-set-btn" data-direction="down" title="Move Down">
                                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="16" r="2.5"></circle><circle cx="8" cy="11" r="2.5"></circle><circle cx="16" cy="11" r="2.5"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <div class="set-actions">
                        <button class="control-btn run-set-btn" title="Run Set"><i class="fas fa-play"></i></button>
                        <button class="control-btn edit-set-btn" title="Edit Set"><i class="fas fa-edit"></i></button>
                    </div>
                </div>
            </div>
        `;
    }
};

let loadedSets = [];
let loadedAssociations = [];
let setsContainer = null;
const currentSetAdapter = SetAdapter; // The single, default adapter for rendering.

/**
 * Attaches click event listeners to the "Run", "Edit", and "Reorder" buttons on the set cards.
 */
function attachSetCardActionListeners() {
    // --- "Run Set" Button Listeners ---
    document.querySelectorAll('.run-set-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();

            const card = button.closest('[data-set-id]');
            const setId = card.dataset.setId;
            const setName = card.querySelector('.set-name').textContent;

            const associatedRuleIds = loadedAssociations
                .filter(assoc => assoc.set_id === setId)
                .map(assoc => assoc.rule_id);
            const rulesForThisSet = currentlyLoadedRules.filter(rule => associatedRuleIds.includes(rule.id));

            if (rulesForThisSet.length === 0) {
                alert("This set has no rules to run.");
                return;
            }

            // --- Shared Execution and Summary Logic ---
            const executeAndShowSummary = async (options) => {
                button.disabled = true;
                // Since the run button is now just an icon, we don't need to manage text content.
                // We can add a visual "running" state if desired, e.g., by adding a class.
                button.classList.add('running');


                try {
                    const result = await runSet(setId, options);
                    if (result.success) {
                        let summaryLines = [result.message || `Set run for "${setName}" finished.`, ''];
                        let allInformationalNotes = [];

                        if (result.results_per_rule && result.results_per_rule.length > 0) {
                            summaryLines.push('--- Breakdown by Rule ---');
                            result.results_per_rule.forEach(ruleResult => {
                                summaryLines.push(`\n[ ${ruleResult.rule_name} ]`);
                                if (!ruleResult.success) {
                                    summaryLines.push(`  ❌ FAILED: ${ruleResult.message}`);
                                } else if (ruleResult.files_matched_by_search === 0) {
                                    summaryLines.push('  • Completed. No files matched the search criteria.');
                                } else {
                                    summaryLines.push(`  • ${ruleResult.message}`, `  ---`, `  • 🔍 Matched: ${ruleResult.files_matched_by_search ?? 0}`, `  • 🎯 Candidates: ${ruleResult.files_action_attempted_on ?? 0}`, `  • 🛡️ Skipped (Override): ${ruleResult.files_skipped_due_to_override ?? 0}`, `  • ✅ Succeeded: ${ruleResult.files_succeeded_count ?? 0}`);
                                    const failed_count = (ruleResult.files_action_attempted_on ?? 0) - (ruleResult.files_succeeded_count ?? 0);
                                    if (failed_count > 0) summaryLines.push(`  • ❌ Failed: ${failed_count}`);
                                }
                                const infoNotes = (ruleResult.details?.translation_warnings ?? []).filter(w => w.level === 'info');
                                if (infoNotes.length > 0) {
                                    allInformationalNotes.push(`--- Notes for ${ruleResult.rule_name} ---`);
                                    allInformationalNotes.push(...infoNotes.map(n => n.message));
                                }
                            });
                        }
                        showRunSummaryModal(`Set Run Summary: "${setName}"`, summaryLines.join('\n'), allInformationalNotes);
                    } else {
                        showRunSummaryModal('Set Run Failed', result.message || 'An unknown error occurred.', []);
                    }
                } catch (error) {
                    console.error(`Error during set execution for ${setId}:`, error);
                    showRunSummaryModal('Set Run Error', `An unexpected error occurred: ${error.message}`, []);
                } finally {
                    button.disabled = false;
                    button.classList.remove('running');
                }
            };

            // --- Modal flow based on user settings ---
            if (clientShowRunAllNotificationsSetting) {
                try {
                    const options = await showManualRunModal(rulesForThisSet);
                    await executeAndShowSummary(options);
                } catch (error) {
                    console.log(`Set run for ${setName} cancelled by user.`, error.message);
                }
            } else {
                console.log(`Bypassing 'Run Set' modal for "${setName}" due to user settings.`);
                await executeAndShowSummary({});
            }
        });
    });

    // --- "Edit Set" Button Listeners ---
    document.querySelectorAll('.edit-set-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const setId = event.currentTarget.closest('[data-set-id]').dataset.setId;
            localStorage.setItem('hydrusButler_targetSetId', setId);
            window.location.href = '/sets';
        });
    });

    // --- "Reorder Set" Button Listeners ---
    document.querySelectorAll('.reorder-set-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation(); // Prevent other card events

            const setId = button.closest('[data-set-id]').dataset.setId;
            const direction = button.dataset.direction;

            const currentIndex = loadedSets.findIndex(s => s.id === setId);
            if (currentIndex === -1) return; // Should not happen

            if (direction === 'up' && currentIndex > 0) {
                // Swap with the previous element
                [loadedSets[currentIndex], loadedSets[currentIndex - 1]] = [loadedSets[currentIndex - 1], loadedSets[currentIndex]];
            } else if (direction === 'down' && currentIndex < loadedSets.length - 1) {
                // Swap with the next element
                [loadedSets[currentIndex], loadedSets[currentIndex + 1]] = [loadedSets[currentIndex + 1], loadedSets[currentIndex]];
            } else {
                return; // Can't move further
            }

            // Re-render the UI with the new order and save it
            renderSetCards();
            saveSetOrder();
        });
    });
}


/**
 * Renders all loaded set cards into the container.
 * This function clears the container, generates HTML for each set,
 * and then attaches all necessary event listeners.
 */
function renderSetCards() {
    if (!setsContainer) {
        console.error("Cannot render cards, setsContainer is not defined.");
        return;
    }
    if (!currentSetAdapter) {
        console.error("Cannot render cards, currentSetAdapter is not set.");
        return;
    }

    if (!loadedSets || loadedSets.length === 0) {
        setsContainer.innerHTML = '<p>No sets defined. Click "+ Add Set" to create one.</p>';
        return;
    }

    // Clear the container before adding new content
    setsContainer.innerHTML = '';

    loadedSets.forEach(set => {
        // Calculate how many rules are in this set
        const ruleCount = loadedAssociations.filter(assoc => assoc.set_id === set.id).length;
        // Use the adapter to generate the HTML
        const cardHTML = currentSetAdapter.renderItem(set, ruleCount);
        // Append the generated HTML to the container
        setsContainer.insertAdjacentHTML('beforeend', cardHTML);
    });

    // After all cards are rendered, attach the necessary event listeners
    attachSetCardActionListeners();
}

/**
 * Saves the current order of the sets to the backend.
 */
async function saveSetOrder() {
    console.log("Saving new set order...");
    const payloadForApi = loadedSets.map(set => {
        const associatedRules = loadedAssociations
            .filter(assoc => assoc.set_id === set.id)
            .map(assoc => ({ rule_id: assoc.rule_id }));
        return { ...set, associations: associatedRules };
    });

    try {
        const result = await saveSetConfiguration(payloadForApi);
        if (!result.success) {
            console.error("Failed to save set order:", result.message);
            alert(`Error: Could not save the new set order. ${result.message}`);
            // Reload to get the correct state from the server and prevent desync
            initializeSetsUI();
        } else {
            console.log("Set order saved successfully.");
        }
    } catch (error) {
        console.error("A critical error occurred while saving set order:", error);
        alert("A critical error occurred while saving the new set order. The page will reload to ensure data consistency.");
        window.location.reload();
    }
}

/**
 * The main entry point for the sets UI module. It fetches all sets and renders them.
 * This function is exported and called from other parts of the application.
 */
export async function initializeSetsUI() {
    setsContainer = document.querySelector(currentSetAdapter.containerSelector);
    if (!setsContainer) {
        console.error(`Critical: The sets container '${currentSetAdapter.containerSelector}' was not found in the DOM.`);
        return;
    }

    setsContainer.innerHTML = '<p>Loading sets...</p>';

    try {
        const result = await fetchAllSets();

        if (!result.success) {
            setsContainer.innerHTML = `<p style="color: red;">Error loading sets: ${result.message}</p>`;
            return;
        }

        loadedSets = result.sets || [];
        loadedAssociations = result.associations || [];
        renderSetCards();

        // --- SET CARD INTERACTION LOGIC ---
        // This listener enables click-to-filter functionality on set cards.
        setsContainer.addEventListener('click', (event) => {
            const card = event.target.closest('.set-card');

            // Do nothing if the click wasn't on a card, or if it was on a button within the card.
            if (!card || event.target.closest('button')) {
                return;
            }

            const isAlreadyActive = card.classList.contains('active');

            // If the card is already active, do nothing.
            if (isAlreadyActive) {
                return;
            }

            // If we are here, a new, inactive card was clicked.
            const setId = card.dataset.setId;

            // First, remove the active state from all other cards.
            setsContainer.querySelectorAll('.set-card.active').forEach(c => c.classList.remove('active'));

            // Then, make the newly clicked card active.
            card.classList.add('active');

            // Dispatch a custom event that the main UI can listen for to filter the rules list.
            const filterEvent = new CustomEvent('set-selected', {
                detail: { setId: setId },
                bubbles: true,
                composed: true
            });
            document.dispatchEvent(filterEvent);
        });

    } catch (error) {
        console.error("Failed to initialize the sets UI:", error);
        setsContainer.innerHTML = `<p style="color: red;">A critical error occurred while fetching set data.</p>`;
    }
}