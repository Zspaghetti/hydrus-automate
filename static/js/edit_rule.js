import { currentlyLoadedRules, availableFileServices, availableTagServices, availableRatingServices, availableServices } from './api.js';
import { showModal, resetForm, addDestinationServiceRowWithSelection, renderModifyRatingInputs } from './modal.js';
import { addConditionRow, refreshModalConditionsUI } from './conditions_ui.js';
import { populateSelectElement } from './utils.js';


const ruleForm = document.getElementById('rule-form');
const conditionsContainer = document.getElementById('conditions-container');
const actionTypeSelect = document.getElementById('action-type');

// File service destination elements
const destinationServicesSection = document.getElementById('destination-services-section');
const firstDestinationSelect = document.getElementById('first-destination-service-select');

// Tag action details elements
const tagActionDetailsSection = document.getElementById('tag-action-details-section');
const tagActionServiceSelect = document.getElementById('tag-action-service-select');
const tagActionTagsInput = document.getElementById('tag-action-tags-input');

const modifyRatingDetailsSection = document.getElementById('modify-rating-details-section');
const modifyRatingServiceSelect = document.getElementById('modify-rating-service-select');
const modifyRatingInputsArea = document.getElementById('modify-rating-inputs-area');


export async function editRule(ruleId) {
    console.log("Editing rule with ID:", ruleId);

    const ruleToEdit = currentlyLoadedRules.find(rule => rule.id === ruleId);

    if (!ruleToEdit) {
        console.error("Rule not found for editing:", ruleId);
        alert("Could not find the rule to edit.");
        return;
    }

    console.log("Found rule to edit:", ruleToEdit);

    resetForm(); // Resets and hides all action-specific sections initially. This *should* clear conditionsContainer.
    // At this point, resetForm also calls addConditionRowFunction(conditionsContainer); which adds ONE empty condition row.

    // to ensure we start with a truly empty slate before populating.
    conditionsContainer.innerHTML = ''; 
    console.log("Conditions container explicitly cleared after resetForm in editRule.");


    document.getElementById('modal-title').textContent = 'Edit Rule';
    ruleForm.dataset.editingRuleId = ruleToEdit.id;

    document.getElementById('rule-name').value = ruleToEdit.name;
    document.getElementById('rule-priority').value = ruleToEdit.priority;

    actionTypeSelect.value = ruleToEdit.action.type;
    // Dispatch change event *after* setting value. This is crucial.
    // This event listener in modal.js will:
    // 1. Show/hide the correct action-specific sections.
    // 2. Populate dropdowns like firstDestinationSelect, tagActionServiceSelect, modifyRatingServiceSelect.
    // 3. For modify_rating, it will call renderModifyRatingInputs with an empty data object initially.
    actionTypeSelect.dispatchEvent(new Event('change'));

    // --- Populate Action Specific Fields AFTER the 'change' event has set up the UI ---
    const action = ruleToEdit.action;

    if (action.type === 'add_to' || action.type === 'force_in') {
        if (firstDestinationSelect) {
            if (action.destination_service_keys && Array.isArray(action.destination_service_keys) && action.destination_service_keys.length > 0) {
                action.destination_service_keys.forEach((key, index) => {
                    if (index === 0) {
                        firstDestinationSelect.value = key;
                    } else {
                        addDestinationServiceRowWithSelection(key);
                    }
                });
            } else if (action.destination_service_key) { // Fallback for old single key
                firstDestinationSelect.value = action.destination_service_key;
            }
        }
    } else if (action.type === 'add_tags' || action.type === 'remove_tags') {
        if (tagActionServiceSelect && action.tag_service_key) {
            tagActionServiceSelect.value = action.tag_service_key;
        }
        if (tagActionTagsInput && Array.isArray(action.tags_to_process)) {
            tagActionTagsInput.value = action.tags_to_process.join(', ');
        }
    } else if (action.type === 'modify_rating') {
        if (modifyRatingServiceSelect && action.rating_service_key) {
            // The dropdown is populated by the 'change' event on actionTypeSelect.
            // We just need to set the value here.
            modifyRatingServiceSelect.value = action.rating_service_key;

            // Now, call renderModifyRatingInputs again, this time with the actual action data
            // to pre-fill the rating value/state inputs.
            // ruleToEdit.action contains { type: 'modify_rating', rating_service_key: '...', rating_value: ... }
            renderModifyRatingInputs(action.rating_service_key, action);
        }
    }


    // Populate conditions
    // This is where ruleToEdit.conditions are added.
    // If conditionsContainer was not truly empty, this adds to existing ones.
    if (ruleToEdit.conditions && Array.isArray(ruleToEdit.conditions)) {
        if (ruleToEdit.conditions.length > 0) {
            console.log("Populating conditions from ruleToEdit:", ruleToEdit.conditions);
            ruleToEdit.conditions.forEach(condition => {
                addConditionRow(conditionsContainer, condition);
            });
        } else {
            if (conditionsContainer.children.length === 0) {
                console.log("Rule has no conditions, adding one empty initial condition row.");
                addConditionRow(conditionsContainer);
            }
        }
    } else {
        if (conditionsContainer.children.length === 0) {
            console.log("Rule.conditions is undefined/not an array, adding one empty initial condition row.");
            addConditionRow(conditionsContainer);
        }
    }

    // Ensure at least one condition row exists visually if the container is empty after processing
    // This check should now be more reliable.
    if (conditionsContainer.children.length === 0) {
         console.log("Conditions container is still empty after populating, adding one final empty condition row.");
         addConditionRow(conditionsContainer);
    }

    // --- Populate new "Force In" details ---
    if (action.type === 'force_in') {
        const deepRunModeSelect = document.getElementById('deep-run-mode');
        const deepRunIntervalInput = document.getElementById('deep-run-interval-runs');

        // The top-level rule object holds this data, not the action object
        if (deepRunModeSelect && ruleToEdit.force_in_check_frequency) {
            deepRunModeSelect.value = ruleToEdit.force_in_check_frequency;
            // Manually trigger change to show/hide the interval input
            deepRunModeSelect.dispatchEvent(new Event('change'));
        }
        if (deepRunIntervalInput && ruleToEdit.force_in_check_interval_runs) {
            deepRunIntervalInput.value = ruleToEdit.force_in_check_interval_runs;
        }
    }

    showModal('rule-modal'); // Show the modal after all fields are populated

    // Refresh UI elements that might depend on dynamically loaded service lists
    // This is a good practice after populating a form for editing.
    try {
        refreshModalConditionsUI(); // This should NOT add new conditions. It refreshes dropdowns.
    } catch (e) {
        console.error("An error occurred during modal UI refresh after populating for edit:", e);
    }
}