// --- IMPORTS ---
import {
    fetchAllServices,
    fetchAllSets,
    loadRules,
    saveRule,
    deleteRule,
    availableServices,
    currentlyLoadedRules,
    removeRuleFromSet,
    deleteSet,
    saveSetConfiguration,
    runSet, // Import the correct API function for running a set
    clientShowRunAllNotificationsSetting, // Import notification setting
	fetchClientSettings,
    getStatusApi,
    retryConnectionApi,
    updateAvailableServices
} from './api.js';
import {
    renderRulesTable
} from './rules_ui.js';
import {
    resetForm,
    showModal,
    hideModal,
    setAddConditionRowFunction,
    resetSetForm,
    addRuleToSetRow,
    showRunSummaryModal // Import the summary modal function
} from './modal.js';
import {
    addConditionRow
} from './conditions_ui.js';
import {
    extractConditionData
} from './conditions_data.js';
import {
    populateSelectElement,
    setHydrusRelatedElementsDisabled
} from './utils.js';
import {
    showManualRunModal
} from './rules_actions.js';



// --- STATE ---
let currentSetId = null;
let allSetsData = { sets: [], associations: [] };
let allRules = [];

// --- DOM ELEMENTS ---
const setSelector = document.getElementById('set-selector');
const currentSetNameDisplay = document.getElementById('current-set-name-display');
const updateServicesButton = document.getElementById('update-services-button');
const addRuleToSetBtn = document.getElementById('add-rule-to-set-btn');
const addMultipleRulesBtn = document.getElementById('add-multiple-rules-btn');
const editCurrentSetBtn = document.getElementById('edit-current-set-btn');
const deleteCurrentSetBtn = document.getElementById('delete-current-set-btn');
const runAllRulesButton = document.getElementById('run-all-rules-button');
const ruleForm = document.getElementById('rule-form');
const conditionsContainer = document.getElementById('conditions-container');
const ruleCopiesSection = document.getElementById('rule-copies-section');
const ruleCopiesInput = document.getElementById('rule-copies');
const rulesTableBody = document.querySelector('#rules-table tbody');
const setForm = document.getElementById('set-form');
const addRuleToSetModalBtn = document.getElementById('add-rule-to-set-button');
const setRulesContainer = document.getElementById('set-rules-container');
const addNewSetBtn = document.getElementById('add-new-set-btn');
const sideMenuAddSetBtn = document.getElementById('hb-add-set-btn');

// --- FUNCTIONS ---

/**
 * Updates the UI based on the Hydrus connection status.
 * @param {object} statusData - The status object from the API.
 */
function updateUiForHydrusStatus(statusData) {
    const indicator = document.querySelector('.status-indicator');
    const statusText = indicator?.querySelector('.status-text');
    const retryBtn = document.getElementById('update-services-button');
    const offlineMessage = document.getElementById('offline-message');
    const noRulesMessage = document.getElementById('no-rules-message');

    if (!indicator || !statusText || !retryBtn || !offlineMessage || !noRulesMessage) {
        console.error("Could not find all required status UI elements.");
        return;
    }

    indicator.classList.remove('status-online', 'status-offline');
    const status = statusData.connection.status;
    const message = statusData.connection.message;

    if (status === 'ONLINE') {
        indicator.classList.add('status-online');
        statusText.textContent = 'Connected';
        retryBtn.textContent = 'Refresh Services';
        offlineMessage.style.display = 'none';
    } else { // OFFLINE or UNKNOWN
        indicator.classList.add('status-offline');
        statusText.textContent = status === 'OFFLINE' ? 'Offline' : 'Unknown';
        retryBtn.textContent = 'Retry Connection';
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

/**
 * Renders the view for the currently selected set.
 * Updates the header and filters the rules table.
 */
function renderCurrentSet() {
    if (!currentSetId || !allSetsData.sets.length) {
        console.warn("Cannot render, no currentSetId or no sets loaded.");
        currentSetNameDisplay.textContent = 'No Set Selected';
        // Pass an empty context object.
        renderRulesTable([], { isSetPage: true }); 
        return;
    }

    const currentSet = allSetsData.sets.find(s => s.id === currentSetId);
    if (!currentSet) {
        console.error(`Could not find set with ID: ${currentSetId}`);
        currentSetNameDisplay.textContent = 'Error: Set not found';
        // Pass the context object.
        renderRulesTable([], { isSetPage: true, setId: currentSetId });
        return;
    }

    // Update the main heading
    currentSetNameDisplay.textContent = currentSet.name;

    // Get the IDs of rules associated with this set
    const associatedRuleIds = allSetsData.associations
        .filter(assoc => assoc.set_id === currentSetId)
        .map(assoc => assoc.rule_id);

    // Filter the global list of rules to get just the ones for this set
    const rulesForThisSet = allRules.filter(rule => associatedRuleIds.includes(rule.id));

    // Render the table with the filtered rules
    renderRulesTable(rulesForThisSet, { isSetPage: true, setId: currentSetId });
}

/**
 * Opens the set modal in "create new" mode.
 */
function openNewSetModal() {
    resetSetForm(); // Resets title, fields, etc.
    setForm.removeAttribute('data-editing-set-id'); // IMPORTANT: Ensure it's in "new" mode
    document.getElementById('set-modal-title').textContent = 'Add New Set';
    
    // Add one empty rule selector to start
    const rulesContainer = document.getElementById('set-rules-container');
    rulesContainer.innerHTML = ''; // Clear any previous rows from editing
    addRuleToSetRow(rulesContainer);
    
    showModal('set-modal');
}


/**
 * Initializes the Set Management page.
 * Fetches all necessary data and sets up initial view and event listeners.
 */
async function initializeApp() {
    console.log("Initializing Set Management page...");

    // Set up the modal to know how to add condition rows
    setAddConditionRowFunction(addConditionRow);

    try {
        // Fetch client settings and check connection status in parallel.
        const settingsPromise = fetchClientSettings();
        const statusPromise = getStatusApi();
        const [_, initialStatus] = await Promise.all([settingsPromise, statusPromise]);
        
        // Update the UI based on the initial connection status.
        updateUiForHydrusStatus(initialStatus);

        // Fetch all data in parallel for speed
        const [servicesResult, setsResult, rulesResult] = await Promise.all([
            fetchAllServices(),
            fetchAllSets(),
            loadRules(),
        ]);

        if (!servicesResult.success) {
            console.warn("Failed to fetch services. Some modal features might be limited.");
        }

        if (setsResult.success) {
            allSetsData = {
                sets: setsResult.sets || [],
                associations: setsResult.associations || []
            };
        } else {
            console.error("Failed to load sets data:", setsResult.message);
            alert("Error: Could not load set information. Page may not function correctly.");
            return;
        }

        if (rulesResult.success) {
            allRules = rulesResult.rules || [];
        } else {
            console.error("Failed to load rules data:", rulesResult.message);
            alert("Error: Could not load rule information. Page may not function correctly.");
            return;
        }

        // Populate the set selector dropdown
        const setOptions = allSetsData.sets.map(s => ({ value: s.id, text: s.name }));
        populateSelectElement(setSelector, setOptions, 'Select a Set...');

        // Set the initial state if sets exist
        if (allSetsData.sets.length > 0) {
            let initialSetId = allSetsData.sets[0].id; // Default to the first set

            const targetSetId = localStorage.getItem('hydrusButler_targetSetId');
            if (targetSetId) {
                localStorage.removeItem('hydrusButler_targetSetId'); // Clean up
                // Check if the target set exists in our data
                if (allSetsData.sets.some(s => s.id === targetSetId)) {
                    initialSetId = targetSetId; // Override default if valid
                } else {
                    console.warn(`Target set ID "${targetSetId}" from localStorage not found in loaded sets.`);
                }
            }

            currentSetId = initialSetId;
            setSelector.value = currentSetId;
            renderCurrentSet();
        } else {
            currentSetNameDisplay.textContent = 'No Sets Created Yet';
            renderRulesTable([]);
        }

	
    } catch (error) {
        console.error("A critical error occurred during app initialization:", error);
        document.querySelector('main').innerHTML = '<h2 style="color:red;">Failed to initialize the page. Please try refreshing.</h2>';
    }
}

// --- EVENT LISTENERS ---

document.addEventListener('DOMContentLoaded', initializeApp);

updateServicesButton.addEventListener('click', async () => {
    console.log("Retry/Refresh button clicked on sets page");
    updateServicesButton.disabled = true;
    updateServicesButton.textContent = 'Connecting...';
    document.body.classList.add('loading-cursor');

    try {
        const newStatus = await retryConnectionApi();
        updateUiForHydrusStatus(newStatus);
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

document.addEventListener('click', (event) => {
    const retryLink = event.target.closest('#retry-connection-link');
    if (retryLink) {
        event.preventDefault();
        updateServicesButton.click();
    }
});

runAllRulesButton.addEventListener('click', async () => {
    if (!currentSetId) {
        alert("Please select a set to run.");
        return;
    }

    const currentSet = allSetsData.sets.find(s => s.id === currentSetId);
    const setName = currentSet ? currentSet.name : "Unknown Set";

    const associatedRuleIds = allSetsData.associations
        .filter(assoc => assoc.set_id === currentSetId)
        .map(assoc => assoc.rule_id);
    const rulesForThisSet = allRules.filter(rule => associatedRuleIds.includes(rule.id));

    if (rulesForThisSet.length === 0) {
        alert("This set has no rules to run.");
        return;
    }

    // --- Shared Execution and Summary Logic ---
    const executeAndShowSummary = async (options) => {
        const result = await runSet(currentSetId, options);
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
    };

    // --- Modal flow based on user settings ---
    if (clientShowRunAllNotificationsSetting) {
        try {
            const options = await showManualRunModal(rulesForThisSet);
            await executeAndShowSummary(options);
        } catch (error) {
            console.log("Set run cancelled by user.", error.message);
        }
    } else {
        console.log(`Bypassing 'Run Set' modal for "${setName}" due to user settings.`);
        await executeAndShowSummary({});
    }
});

setSelector.addEventListener('change', (event) => {
    currentSetId = event.target.value;
    renderCurrentSet();
});

addRuleToSetBtn.addEventListener('click', () => {
    resetForm();
    if (ruleCopiesSection) {
        ruleCopiesSection.style.display = 'none';
        ruleCopiesInput.value = 1;
    }
    addConditionRow(conditionsContainer);
    showModal('rule-modal');
});

addMultipleRulesBtn.addEventListener('click', () => {
    resetForm();
    if (ruleCopiesSection) {
        ruleCopiesSection.style.display = 'block';
    }
    addConditionRow(conditionsContainer);
    showModal('rule-modal');
});

addNewSetBtn.addEventListener('click', openNewSetModal);
if (sideMenuAddSetBtn) {
    sideMenuAddSetBtn.addEventListener('click', openNewSetModal);
}


editCurrentSetBtn.addEventListener('click', () => {
    if (!currentSetId) {
        alert("Please select a set to edit.");
        return;
    }
    const setToEdit = allSetsData.sets.find(s => s.id === currentSetId);
    if (!setToEdit) {
        alert("Error: Could not find the selected set data.");
        return;
    }

    resetSetForm(); // Reset form to a clean state

    // Populate the form with the existing set's data
    document.getElementById('set-modal-title').textContent = `Edit Set: ${setToEdit.name}`;
    document.getElementById('set-name').value = setToEdit.name;
    setForm.dataset.editingSetId = setToEdit.id;

    const overrideSelect = document.getElementById('set-execution-override');
    
    // Set the value based on the set's data
    if (setToEdit.execution_override) {
        overrideSelect.value = setToEdit.execution_override;
        if (setToEdit.execution_override === 'custom') {
            document.getElementById('set-interval-seconds').value = setToEdit.interval_seconds || '';
        }
    } else {
        overrideSelect.value = 'default';
    }

    // Manually trigger the 'change' event to update the UI visibility.
    overrideSelect.dispatchEvent(new Event('change'));

    // Populate rule associations
    const rulesContainer = document.getElementById('set-rules-container');
    rulesContainer.innerHTML = ''; // Clear any existing rows
    const associatedRuleIds = allSetsData.associations
        .filter(assoc => assoc.set_id === currentSetId)
        .map(assoc => assoc.rule_id);

    if (associatedRuleIds.length > 0) {
        associatedRuleIds.forEach(ruleId => {
            addRuleToSetRow(rulesContainer, ruleId);
        });
    } else {
        addRuleToSetRow(rulesContainer); // Add one empty row if no rules
    }

    showModal('set-modal');
});

deleteCurrentSetBtn.addEventListener('click', async () => {
    if (!currentSetId) {
        alert("Please select a set to delete.");
        return;
    }
    const setToDelete = allSetsData.sets.find(s => s.id === currentSetId);
    if (!setToDelete) {
        alert("Error: Could not find the selected set to delete.");
        return;
    }

    if (confirm(`Are you sure you want to permanently delete the set "${setToDelete.name}"? This cannot be undone.`)) {
        const result = await deleteSet(currentSetId);
        if (result.success) {
            alert("Set deleted successfully.");
            window.location.href = '/'; // Redirect to the main page
        } else {
            alert(`Failed to delete set: ${result.message}`);
        }
    }
});

/**
 * Generates a a pseudo-random v4 UUID to ensure consistency with the main page.
 * @returns {string} A new UUID.
 */
function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

setForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveButton = setForm.querySelector('button[type="submit"]');

    try {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';

        const editingSetId = setForm.dataset.editingSetId;
        const isEditing = !!editingSetId;

        // Fetch the latest full configuration to avoid race conditions.
        const existingConfigResult = await fetchAllSets();
        if (!existingConfigResult.success) {
            alert(`Error: Could not fetch existing set configuration. ${existingConfigResult.message}`);
            return;
        }

        let setsToSave = existingConfigResult.sets;
        let associationsToSave = existingConfigResult.associations;

        // Get form data
        const setName = document.getElementById('set-name').value.trim();
        const executionOverride = document.getElementById('set-execution-override').value;
        const intervalSecondsInput = document.getElementById('set-interval-seconds').value;
        const selectedRuleIds = Array.from(document.querySelectorAll('#set-rules-container select[name="set-rule-id"]'))
            .map(select => select.value)
            .filter(id => id);

        // Validation
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

        // Apply changes
        if (isEditing) {
            const setToUpdate = setsToSave.find(s => s.id === editingSetId);
            if (!setToUpdate) {
                alert("Error: The set you are trying to edit could not be found.");
                return;
            }
            setToUpdate.name = setName;
            setToUpdate.execution_override = executionOverride === 'default' ? null : executionOverride;
            setToUpdate.interval_seconds = executionOverride === 'custom' ? parseInt(intervalSecondsInput, 10) : null;

            associationsToSave = associationsToSave.filter(assoc => assoc.set_id !== editingSetId);
            selectedRuleIds.forEach(ruleId => {
                associationsToSave.push({ set_id: editingSetId, rule_id: ruleId });
            });
        } else { // Creating a new set
            const newSet = {
                id: `set_${uuidv4()}`,
                name: setName,
                execution_override: executionOverride === 'default' ? null : executionOverride,
                interval_seconds: executionOverride === 'custom' ? parseInt(intervalSecondsInput, 10) : null
            };
            setsToSave.push(newSet);
            selectedRuleIds.forEach(ruleId => {
                associationsToSave.push({ set_id: newSet.id, rule_id: ruleId });
            });
        }

        const finalPayload = setsToSave.map(set => ({
            ...set,
            associations: associationsToSave
                .filter(assoc => assoc.set_id === set.id)
                .map(assoc => ({ rule_id: assoc.rule_id }))
        }));

        const saveResult = await saveSetConfiguration(finalPayload);

        if (saveResult.success) {
            hideModal('set-modal');
            if (isEditing) {
                localStorage.setItem('hydrusButler_targetSetId', editingSetId);
            }
            await initializeApp();
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

document.getElementById('set-execution-override')?.addEventListener('change', (e) => {
    const customIntervalSection = document.getElementById('set-custom-interval-section');
    if (customIntervalSection) {
        customIntervalSection.style.display = e.target.value === 'custom' ? 'block' : 'none';
    }
});

// Attach listener to the static parent container for rules to handle clicks on dynamically added rule cards.
document.querySelector('#rules-table-container').addEventListener('click', async (event) => {
    // This listener ONLY handles removing a rule from a set, which is specific to this page.
    // Generic actions like 'edit' or 'delete' are handled by the listener in rules_ui.js.
    const removeFromSetButton = event.target.closest('.remove-from-set-button');

    if (removeFromSetButton) {
        const { ruleId, setId } = removeFromSetButton.dataset;

        // Get the rule name from the new card structure, not an old table row.
        const ruleCard = removeFromSetButton.closest('.rule-card');
        const ruleName = ruleCard ? ruleCard.querySelector('.rule-name').textContent : 'this rule';

        if (confirm(`Are you sure you want to remove the rule "${ruleName}" from this set? The rule itself will not be deleted.`)) {
            const result = await removeRuleFromSet(ruleId, setId);
            if (result.success) {
                console.log("Rule removed from set successfully. Refreshing view.");
                // Update local state and re-render to reflect the removal immediately.
                allSetsData.associations = allSetsData.associations.filter(
                    assoc => !(assoc.rule_id === ruleId && assoc.set_id === setId)
                );
                renderCurrentSet();
            } else {
                alert(`Failed to remove rule from set: ${result.message}`);
            }
        }
    }
});


addRuleToSetModalBtn.addEventListener('click', () => {
    // Call the imported function to add a new rule selector row
    // to the correct container inside the set modal.
    addRuleToSetRow(setRulesContainer);
});

ruleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    console.log("Rule form submitted on sets page.");

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
    // If creating a new rule, automatically associate it with the currently selected set.
    if (!isUpdate && currentSetId) {
        basePayload.set_ids = [currentSetId];
        console.log(`New rule(s) will be associated with selected set: ${currentSetId}`);
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
        // Remember the current set so the page reloads to the same view
        if (currentSetId) {
            localStorage.setItem('hydrusButler_targetSetId', currentSetId);
        }
        await initializeApp();
    } else {
        alert("One or more rules failed to save. The UI will now refresh.");
        if (currentSetId) {
            localStorage.setItem('hydrusButler_targetSetId', currentSetId);
        }
        await initializeApp();
    }
});