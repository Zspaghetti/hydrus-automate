// static/js/main.js

// Import API functions and state
import {
    fetchClientSettings,
    saveRule,
    deleteRule,
    loadRules,
    currentlyLoadedRules,
    showNotificationsSetting,
    availableServices,
    fetchAllSets,
    saveSetConfiguration,
    getStatusApi,
    retryConnectionApi,
    updateAvailableServices,
    removeRuleFromSet
} from './api.js';


// Import render function for the rules table
import { renderRulesTable } from './rules_ui.js';
// Import modal functions and the function to set the addConditionRow
import { resetForm, showModal, hideModal, setAddConditionRowFunction, renderModifyRatingInputs, resetSetForm, addRuleToSetRow } from './modal.js';
// Import functions related to conditions UI and data
import { refreshModalConditionsUI, addConditionRow } from './conditions_ui.js';
// Import extraction logic for form submission
import { extractConditionData } from './conditions_data.js';
// Import action for running all rules manually
import { runAllRulesManual } from './rules_actions.js';
// Import "first run" confirmation logic
import { applyFirstRunVisuals } from './first_run.js';
// Import the sets UI initializer
import { initializeSetsUI } from './sets_ui.js';
// Import UI utility functions
import { setHydrusRelatedElementsDisabled } from './utils.js';

// --- UI STATE ---
// Tracks the currently selected set to filter the rule view.
let selectedSetId = null;
// Caches set-to-rule associations to avoid repeated API calls when filtering.
const setAssociationsCache = new Map();


// --- MAIN PAGE UI FUNCTIONS ---

/**
 * Attaches the event listener for adding a rule via the dedicated card.
 * @param {function} handler - The function to call when the add card is clicked.
 */
function attachAddRuleListener(handler) {
    document.addEventListener('click', (event) => {
        const rulesContainer = document.getElementById('rules-card-container');
        const addCard = event.target.closest('#add-new-rule-card');
        if (addCard && rulesContainer && rulesContainer.contains(addCard)) {
            handler();
        }
    });
}

/**
 * Updates the main "Run" button's text.
 * @param {string} text - The new text for the button.
 */
function updateRunButtonText(text) {
    const runAllBtn = document.getElementById('run-all-rules-button');
    const span = runAllBtn?.querySelector('span');
    if (span) {
        span.textContent = text;
    }
}

/**
 * Updates the main header title to show the current filter context.
 * @param {string|null} setName - The name of the set, or null for "All Rules".
 */
function updateHeaderForSetFilter(setName) {
    const mainHeader = document.getElementById('main-header-title');
    if (mainHeader) {
        mainHeader.textContent = setName ? `Rules in: ${setName}` : 'All Rules';
    }
}

/**
 * Defines the action for the main "Run" button, which is context-sensitive.
 * It runs all rules globally or just the rules in the currently selected set.
 * @param {function} runAllRulesManual - The function that triggers a run of all rules.
 * @param {string|null} currentSelectedSetId - The currently selected set ID.
 */
function handleRunAllClick(runAllRulesManual, currentSelectedSetId) {
    if (currentSelectedSetId) {
        console.log(`'Run Set' triggered for set ${currentSelectedSetId} from main 'Run' button.`);
        const runSetButton = document.querySelector(`.set-card[data-set-id="${currentSelectedSetId}"] .run-set-btn`);
        if (runSetButton) {
            runSetButton.click();
        } else {
            alert(`Could not find the run button for the selected set (${currentSelectedSetId}).`);
            console.warn(`Could not find .run-set-btn for set with ID ${currentSelectedSetId}`);
        }
    } else {
        console.log("'Run All Rules Now' button clicked (global).");
        runAllRulesManual();
    }
}

/**
 * Updates the entire UI based on the Hydrus connection status.
 * @param {object} statusData - The status object from the API.
 */
function updateUiForHydrusStatus(statusData) {
    const indicator = document.querySelector('.status-indicator');
    const statusText = indicator?.querySelector('.status-text');
    const retryBtn = document.getElementById('update-services-button');
    const offlineMessage = document.getElementById('offline-message');
    const noRulesMessage = document.getElementById('no-rules-message');

    if (!indicator || !statusText || !retryBtn || !offlineMessage || !noRulesMessage) {
        console.error("Could not find status or message elements.");
        return;
    }

    indicator.classList.remove('status-online', 'status-offline');
    const status = statusData.connection.status;
    const message = statusData.connection.message;

    if (status === 'ONLINE') {
        indicator.classList.add('status-online');
        statusText.textContent = 'Connected';
        retryBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Services';
        offlineMessage.style.display = 'none';
    } else { // OFFLINE or UNKNOWN
        indicator.classList.add('status-offline');
        statusText.textContent = status === 'OFFLINE' ? 'Offline' : 'Unknown';
        retryBtn.innerHTML = '<i class="fas fa-plug"></i> Retry Connection';
        offlineMessage.style.display = 'block';
        noRulesMessage.style.display = 'none'; // Hide "no rules" to prevent overlap
    }
    indicator.title = message;

    setHydrusRelatedElementsDisabled(status !== 'ONLINE');

    if (status === 'ONLINE') {
        updateAvailableServices(statusData.services);
    } else {
        updateAvailableServices([]);
    }
}

// --- END: MAIN PAGE UI FUNCTIONS ---


/**
 * Generates a a pseudo-random v4 UUID.
 * @returns {string} A new UUID.
 */
function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

/**
 * Filters and renders the rules list based on a selected set ID.
 * If setId is null, it renders all rules.
 * @param {string|null} setId - The ID of the set to display rules for.
 */
async function renderRulesForSet(setId) {
    console.log(`Rendering rules for set: ${setId || 'All Rules'}`);
    selectedSetId = setId; // Update the global state

    // If no set is selected, show all rules and reset UI text
    if (!setId) {
        renderRulesTable(currentlyLoadedRules, { isSetPage: false });
        updateRunButtonText('Run All Rules');
        updateHeaderForSetFilter(null);
        return;
    }

    // If a set is selected, update UI text
    updateRunButtonText('Run Selected Set');

    // Fetch and cache associations on the first filter attempt
    if (setAssociationsCache.size === 0) {
        const setsData = await fetchAllSets();
        if (setsData.success) {
            setsData.associations.forEach(assoc => {
                if (!setAssociationsCache.has(assoc.set_id)) {
                    setAssociationsCache.set(assoc.set_id, []);
                }
                setAssociationsCache.get(assoc.set_id).push(assoc.rule_id);
            });
            console.log("Cached set associations for performance.");
        } else {
            console.error("Failed to fetch set associations to filter rules:", setsData.message);
            renderRulesTable([]); // Render empty on failure
            return;
        }
    }

    const ruleIdsForSet = setAssociationsCache.get(setId) || [];
    const filteredRules = currentlyLoadedRules.filter(rule => ruleIdsForSet.includes(rule.id));

    // Update the header to show the current set's name
    const selectedSetCard = document.querySelector(`.set-card[data-set-id="${setId}"] .set-name`);
    if (selectedSetCard) {
        updateHeaderForSetFilter(selectedSetCard.textContent);
    }

    renderRulesTable(filteredRules, { isSetPage: true, setId: setId });
}


document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed for main page.');

    const updateServicesButton = document.getElementById('update-services-button');
    const ruleForm = document.getElementById('rule-form');
    const conditionsContainer = document.getElementById('conditions-container');
    const ruleModal = document.getElementById('rule-modal');

    setAddConditionRowFunction(addConditionRow);

    console.log("Initial page load: Fetching client settings, all services, then loading rules.");


    async function initializeApp() {
        try {
            // Fetch client settings and check connection status in parallel.
            const settingsPromise = fetchClientSettings();
            const statusPromise = getStatusApi();
            const [_, initialStatus] = await Promise.all([settingsPromise, statusPromise]);

            // Update the UI based on the initial connection status.
            updateUiForHydrusStatus(initialStatus);

            // Load rules and initialize the UIs.
            const rulesResult = await loadRules();

            if (rulesResult.success) {
                updateHeaderForSetFilter(null); // Set header to "All Rules" on successful load
                updateRunButtonText('Run All Rules'); // Ensure button text is correct for the default view
                renderRulesTable(currentlyLoadedRules);
                const allRuleIds = currentlyLoadedRules.map(rule => rule.id);
                await applyFirstRunVisuals(allRuleIds);
            } else {
                console.error("Failed to load rules:", rulesResult.message);
                const mainHeader = document.getElementById('main-header-title');
                if (mainHeader) {
                    mainHeader.textContent = 'Error Loading Rules';
                }
                const rulesArea = document.querySelector('#rules-card-container');
                if (rulesArea) {
                    rulesArea.innerHTML = '<p style="text-align: center; color: red; padding: 2rem;">Failed to load rules. Please check server logs.</p>';
                }
                const noRulesMsg = document.getElementById('no-rules-message');
                if (noRulesMsg) noRulesMsg.style.display = 'none';
            }

            // Initialize the sets UI.
            setAssociationsCache.clear();
            await initializeSetsUI();

            // Add event listener for set selection.
            document.addEventListener('set-selected', (e) => {
                renderRulesForSet(e.detail.setId);
            });

            // Restore selected set view after full refresh ---
            const targetSetId = localStorage.getItem('hydrusButler_targetSetId');
            if (targetSetId) {
                localStorage.removeItem('hydrusButler_targetSetId'); // Clean up
                const targetSetCard = document.querySelector(`.set-card[data-set-id="${targetSetId}"]`);
                if (targetSetCard) {
                    console.log(`Restoring view for target set ID: ${targetSetId}`);
                    if (!targetSetCard.classList.contains('active')) {
                        targetSetCard.click();
                    }
                } else {
                    console.warn(`Target set ID "${targetSetId}" from localStorage not found in the DOM after init.`);
                }
            }
            // --- END: Restore selected set view ---

            // Attach event listeners for main page controls.
            const addRuleHandler = () => {
                console.log("Add Rule trigger activated");
                resetForm();
                const ruleCopiesSection = document.getElementById('rule-copies-section');
                if (ruleCopiesSection) {
                    ruleCopiesSection.style.display = 'block'; // Always show for new rules on main page
                }
                if (addConditionRow && conditionsContainer) {
                    addConditionRow(conditionsContainer);
                }
                showModal('rule-modal');
            };
            attachAddRuleListener(addRuleHandler);

            const runAllButton = document.getElementById('run-all-rules-button');
            if (runAllButton) {
                runAllButton.addEventListener('click', () => {
                    handleRunAllClick(runAllRulesManual, selectedSetId);
                });
            } else {
                console.warn("'Run All Rules' button not found in the DOM.");
            }


        } catch (error) {
            console.error("Critical error during initial app load sequence:", error);
            const mainContent = document.querySelector('main');
            if (mainContent) {
                mainContent.innerHTML = '<h2 style="color:red;">Failed to initialize the application. Please try refreshing the page or check server status.</h2>';
            }
            try {
                // Try to show connection error.
                updateUiForHydrusStatus({
                    connection: { status: 'OFFLINE', message: 'App initialization failed.' }
                });
            } catch (e) {
                console.error("Could not update status during critical error.");
            }
        }
    }

    initializeApp();

    // --- START: ADD SET MODAL LOGIC ---

    const addSetButton = document.getElementById('hb-add-set-btn');
    const setModal = document.getElementById('set-modal');
    const setForm = document.getElementById('set-form');

    if (addSetButton) {
        addSetButton.addEventListener('click', () => {
            resetSetForm();
            addRuleToSetRow(document.getElementById('set-rules-container'));
            showModal('set-modal');
        });
    }

    document.getElementById('add-rule-to-set-button')?.addEventListener('click', () => {
        addRuleToSetRow(document.getElementById('set-rules-container'));
    });

    document.getElementById('set-execution-override')?.addEventListener('change', (e) => {
        document.getElementById('set-custom-interval-section').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    setModal?.querySelector('.close-button').addEventListener('click', () => hideModal('set-modal'));
    window.addEventListener('click', (event) => {
        if (event.target === setModal) hideModal('set-modal');
    });

    if (setForm) {
        setForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const saveButton = setForm.querySelector('button[type="submit"]');

            try {
                saveButton.disabled = true;
                saveButton.textContent = 'Saving...';

                const existingConfig = await fetchAllSets();
                if (!existingConfig.success) {
                    alert(`Error: Could not fetch existing sets. ${existingConfig.message}`);
                    return;
                }

                const existingSets = existingConfig.sets.map(set => ({
                    ...set,
                    associations: existingConfig.associations
                        .filter(assoc => assoc.set_id === set.id)
                        .map(assoc => ({ rule_id: assoc.rule_id }))
                }));

                const setName = document.getElementById('set-name').value.trim();
                const executionOverride = document.getElementById('set-execution-override').value;
                const intervalSecondsInput = document.getElementById('set-interval-seconds').value;
                const selectedRuleIds = Array.from(document.querySelectorAll('#set-rules-container select[name="set-rule-id"]'))
                    .map(select => select.value)
                    .filter(id => id);

                if (!setName) {
                    alert("Set Name is required.");
                    return;
                }
                if (executionOverride === 'custom') {
                    const interval = parseInt(intervalSecondsInput, 10);
                    if (isNaN(interval) || interval < 10) {
                        alert("Custom interval must be a valid number of at least 10 seconds.");
                        return;
                    }
                }
                if (new Set(selectedRuleIds).size !== selectedRuleIds.length) {
                    alert("Please select unique rules. Duplicates are not allowed in a set.");
                    return;
                }

                const newSet = {
                    id: `set_${uuidv4()}`,
                    name: setName,
                    execution_override: executionOverride === 'default' ? null : executionOverride,
                    interval_seconds: executionOverride === 'custom' ? parseInt(intervalSecondsInput, 10) : null,
                    associations: selectedRuleIds.map(id => ({ rule_id: id }))
                };

                const payloadForApi = [...existingSets, newSet];

                const saveResult = await saveSetConfiguration(payloadForApi);

                if (saveResult.success) {
                    hideModal('set-modal');
                    resetSetForm();
                    await initializeSetsUI();
                } else {
                    alert(`Failed to save set: ${saveResult.message}`);
                }


            } catch (error) {
                console.error("A critical error occurred during set form submission:", error);
                alert("An unexpected error occurred. Please check the console for details.");
            } finally {
                saveButton.disabled = false;
                saveButton.textContent = 'Save Set';
            }
        });
    }

    // --- END: ADD SET MODAL LOGIC ---

    const retryConnectionLink = document.getElementById('retry-connection-link');
    if (retryConnectionLink) {
        retryConnectionLink.addEventListener('click', (event) => {
            event.preventDefault();
            if (updateServicesButton) {
                console.log("Retry connection link clicked, triggering main button.");
                updateServicesButton.click();
            }
        });
    }

    updateServicesButton.addEventListener('click', async () => {
        console.log("Retry/Refresh button clicked");
        updateServicesButton.disabled = true;
        updateServicesButton.textContent = 'Connecting...';
        document.body.classList.add('loading-cursor');

        try {
            const newStatus = await retryConnectionApi();
            updateUiForHydrusStatus(newStatus);

            if (ruleModal.style.display !== 'none') {
                console.log("Modal is open, refreshing modal UI after connection attempt.");
                refreshModalConditionsUI();

                const actionTypeSelect = document.getElementById('action-type');
                if (actionTypeSelect) {
                    actionTypeSelect.dispatchEvent(new Event('change'));
                }
            }

        } catch (error) {
            console.error("Error during manual connection retry:", error);
            updateUiForHydrusStatus({
                connection: { status: 'OFFLINE', message: `Client-side error: ${error.message}` }
            });
        } finally {
            updateServicesButton.disabled = false;
            document.body.classList.remove('loading-cursor');
        }
    });

    ruleForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        console.log("Rule form submitted on main page.");

        // --- Data Extraction ---
        const ruleId = ruleForm.dataset.editingRuleId || '';
        const originalName = document.getElementById('rule-name').value.trim();
        const rulePriority = parseInt(document.getElementById('rule-priority').value, 10);
        const actionType = document.getElementById('action-type').value;

        const destinationServiceKeys = Array.from(document.querySelectorAll('.destination-service-select')).map(s => s.value).filter(Boolean);
        const tagActionServiceKey = document.getElementById('tag-action-service-select').value;
        const tagsToProcess = document.getElementById('tag-action-tags-input').value.split(',').map(t => t.trim()).filter(Boolean);

        let modifyRatingActionServiceKey = '';
        let modifyRatingActionValue = undefined;
        if (actionType === 'modify_rating') {
            modifyRatingActionServiceKey = document.getElementById('modify-rating-service-select').value;
            const service = availableServices.find(s => s.service_key === modifyRatingActionServiceKey);
            if (service) {
                if (service.type === 7) {
                    const stateSelect = document.querySelector('select[name="modify-rating-action-state"]');
                    if (stateSelect?.value) {
                        if (stateSelect.value === 'liked') modifyRatingActionValue = true;
                        else if (stateSelect.value === 'disliked') modifyRatingActionValue = false;
                        else if (stateSelect.value === 'no_rating') modifyRatingActionValue = null;
                    }
                } else if (service.type === 6 || service.type === 22) {
                    const choiceSelect = document.querySelector('select[name="modify-rating-action-numerical-choice"]');
                    if (choiceSelect?.value) {
                        if (choiceSelect.value === 'set_value') {
                            const valueInput = document.querySelector('input[name="modify-rating-action-value"]');
                            if (valueInput?.value !== '') {
                                modifyRatingActionValue = parseFloat(valueInput.value);
                                if (isNaN(modifyRatingActionValue)) modifyRatingActionValue = undefined;
                            }
                        } else if (choiceSelect.value === 'no_rating') {
                            modifyRatingActionValue = null;
                        }
                    }
                }
            }
        }

        const conditions = [];
        let overallFormIsValid = true;
        let validationMessages = [];
        conditionsContainer.querySelectorAll(':scope > .condition-row').forEach(rowElement => {
            const result = extractConditionData(rowElement);
            if (result.isValid) {
                conditions.push(result.data);
            } else {
                overallFormIsValid = false;
                validationMessages.push(`Condition invalid: ${result.message}`);
            }
        });

        // --- Validation ---
        if (isNaN(rulePriority)) {
            validationMessages.push('Please enter a valid number for Priority.');
            overallFormIsValid = false;
        }
        if (conditions.length === 0 && conditionsContainer.querySelectorAll(':scope > .condition-row').length > 0) {
            validationMessages.push('Rule must contain at least one valid condition.');
            overallFormIsValid = false;
        }
        if (!actionType) {
            validationMessages.push('Please select an Action.');
            overallFormIsValid = false;
        }
        if (['add_to', 'force_in'].includes(actionType)) {
            if (destinationServiceKeys.length === 0) {
                validationMessages.push(`Action type "${actionType}" requires at least one destination file service.`);
                overallFormIsValid = false;
            }
        } else if (['add_tags', 'remove_tags'].includes(actionType)) {
            if (!tagActionServiceKey) {
                validationMessages.push(`Action type "${actionType}" requires a target tag service.`);
                overallFormIsValid = false;
            }
            if (tagsToProcess.length === 0) {
                validationMessages.push(`Action type "${actionType}" requires at least one tag.`);
                overallFormIsValid = false;
            }
        } else if (actionType === 'modify_rating') {
            if (!modifyRatingActionServiceKey) {
                validationMessages.push('Modify Rating action requires a target rating service.');
                overallFormIsValid = false;
            }
            if (modifyRatingActionValue === undefined) {
                validationMessages.push('Modify Rating action requires a rating state/value to be set.');
                overallFormIsValid = false;
            }
        }


        if (!overallFormIsValid) {
            alert('Please correct the following issues:\n\n' + validationMessages.join('\n'));
            return;
        }

        // --- Payload Construction ---
        let actionObject = {};
        if (['add_to', 'force_in'].includes(actionType)) {
            actionObject = { type: actionType, destination_service_keys: destinationServiceKeys };
        } else if (['add_tags', 'remove_tags'].includes(actionType)) {
            actionObject = { type: actionType, tag_service_key: tagActionServiceKey, tags_to_process: tagsToProcess };
        } else if (actionType === 'modify_rating') {
            actionObject = { type: 'modify_rating', rating_service_key: modifyRatingActionServiceKey, rating_value: modifyRatingActionValue };
        }

        const basePayload = {
            id: ruleId,
            priority: rulePriority,
            conditions: conditions,
            action: actionObject
        };

        if (actionType === 'force_in') {
            const deepRunMode = document.getElementById('deep-run-mode').value;
            basePayload.force_in_check_frequency = deepRunMode;

            if (deepRunMode === 'every_x_runs') {
                const interval = parseInt(document.getElementById('deep-run-interval-runs').value, 10);
                basePayload.force_in_check_interval_runs = isNaN(interval) ? null : interval;
            } else {
                basePayload.force_in_check_interval_runs = null;
            }
        }

        const isUpdate = !!ruleId;
        // If creating a new rule and a set is currently selected,
        // automatically associate the new rule with that set.
        if (!isUpdate && selectedSetId) {
            basePayload.set_ids = [selectedSetId];
            console.log(`New rule(s) will be associated with selected set: ${selectedSetId}`);
        }

        // --- Save Logic (with multiple copies support) ---
        let allSucceeded = true;
        const numberOfCopiesInput = document.getElementById('rule-copies');
        const numberOfCopies = isUpdate ? 1 : (parseInt(numberOfCopiesInput.value, 10) || 1);

        for (let i = 0; i < numberOfCopies; i++) {
            const singleRulePayload = JSON.parse(JSON.stringify(basePayload));
            if (!isUpdate && numberOfCopies > 1) {
                singleRulePayload.name = `${originalName} ${i + 1}/${numberOfCopies}`;
            } else {
                singleRulePayload.name = originalName;
            }

            console.log(`Saving rule copy ${i + 1}/${numberOfCopies} with payload:`, singleRulePayload);
            const result = await saveRule(singleRulePayload);

            if (!result.success) {
                allSucceeded = false;
                alert(`Failed to save rule copy #${i + 1}: ${result.message}`);
                break;
            }
        }

        // --- Refresh Logic ---
        if (allSucceeded) {
            hideModal('rule-modal');
            if (selectedSetId) {
                localStorage.setItem('hydrusButler_targetSetId', selectedSetId);
            }
            await initializeApp();
        } else {
            alert("One or more rules failed to save. The UI will now refresh.");
            if (selectedSetId) {
                localStorage.setItem('hydrusButler_targetSetId', selectedSetId);
            }
            await initializeApp();
        }
    });

    document.addEventListener('click', async (event) => {
        const removeFromSetButton = event.target.closest('.remove-from-set-button');
        if (!removeFromSetButton) return;

        const mainContent = document.querySelector('.main-content') || document.querySelector('main');
        if (!mainContent || !mainContent.contains(removeFromSetButton)) {
            return;
        }

        const { ruleId, setId } = removeFromSetButton.dataset;

        const result = await removeRuleFromSet(ruleId, setId);
        if (result.success) {
            if (selectedSetId) {
                localStorage.setItem('hydrusButler_targetSetId', selectedSetId);
            }
            await initializeApp();
        } else {
            alert(`Failed to remove rule from set: ${result.message}`);
        }
    });
});