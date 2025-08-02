import { populateSelectElement } from './utils.js';
import { availableFileServices, availableTagServices, availableRatingServices, availableServices, currentlyLoadedRules } from './api.js';

const ruleModal = document.getElementById('rule-modal');
const ruleForm = document.getElementById('rule-form');
const conditionsContainer = document.getElementById('conditions-container');
const actionTypeSelect = document.getElementById('action-type');
const ruleNameInput = document.getElementById('rule-name');

const destinationServicesSection = document.getElementById('destination-services-section');
const additionalDestinationsContainer = document.getElementById('additional-destination-services-container');
const addDestinationButton = document.getElementById('add-destination-service-button');

const tagActionDetailsSection = document.getElementById('tag-action-details-section');
const tagActionServiceSelect = document.getElementById('tag-action-service-select');
const tagActionTagsInput = document.getElementById('tag-action-tags-input');

const modifyRatingDetailsSection = document.getElementById('modify-rating-details-section');
const modifyRatingServiceSelect = document.getElementById('modify-rating-service-select');
const modifyRatingInputsArea = document.getElementById('modify-rating-inputs-area');


let addConditionRowFunction = null;

export function setAddConditionRowFunction(func) {
     addConditionRowFunction = func;
     console.log("addConditionRowFunction set in modal.js");
}

function addDestinationServiceRow() {
    console.log("Adding new destination service row.");
    const newRow = document.createElement('div');
    newRow.classList.add('destination-service-row');

    const newSelect = document.createElement('select');
    newSelect.name = 'destination-service';
    newSelect.classList.add('destination-service-select');
    populateSelectElement(newSelect, availableFileServices, '-- Select Service --');

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.classList.add('remove-destination-button', 'secondary-button');
    removeButton.addEventListener('click', () => {
        newRow.remove();
        console.log("Destination service row removed.");
    });

    newRow.appendChild(newSelect);
    newRow.appendChild(removeButton);
    additionalDestinationsContainer.appendChild(newRow);
}

export function addDestinationServiceRowWithSelection(serviceKeyToSelect) {
    console.log(`Adding new destination service row with selection: ${serviceKeyToSelect}`);
    const newRow = document.createElement('div');
    newRow.classList.add('destination-service-row');

    const newSelect = document.createElement('select');
    newSelect.name = 'destination-service';
    newSelect.classList.add('destination-service-select');
    populateSelectElement(newSelect, availableFileServices, '-- Select Service --', serviceKeyToSelect);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.classList.add('remove-destination-button', 'secondary-button');
    removeButton.addEventListener('click', () => {
        newRow.remove();
        console.log("Destination service row removed.");
    });

    newRow.appendChild(newSelect);
    newRow.appendChild(removeButton);
    additionalDestinationsContainer.appendChild(newRow);
}

export function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
    } else {
        console.error(`Modal with ID '${modalId}' not found.`);
    }
}

export function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        // Reset the appropriate form based on which modal is being closed
        if (modalId === 'rule-modal') {
            resetForm();
        } else if (modalId === 'set-modal') {
            resetSetForm();
        }
    } else {
        console.error(`Modal with ID '${modalId}' not found.`);
    }
}

/**
 * Populates and shows a summary modal after a rule run.
 * @param {string} title - The title for the modal.
 * @param {string} summaryMessage - The main summary text.
 * @param {string[]} notes - An array of informational note strings.
 */
export function showRunSummaryModal(title, summaryMessage, notes) {
    const modal = document.getElementById('run-summary-modal');
    if (!modal) {
        console.error("Run summary modal not found!");
        // Fallback to alert if modal is missing for some reason
        alert(`${title}\n\n${summaryMessage}\n\nNotes:\n${(notes || []).join('\n')}`);
        return;
    }

    document.getElementById('run-summary-modal-title').textContent = title;
    document.getElementById('run-summary-message').textContent = summaryMessage;
    const notesList = document.getElementById('run-summary-notes-list');
    const notesContainer = modal.querySelector('.informational-notes-container');
    const detailsElement = notesContainer.querySelector('details');

    notesList.innerHTML = ''; // Clear previous notes

    if (notes && notes.length > 0) {
        notes.forEach(note => {
            // We only want the message part of the note, not the 'Note:' prefix if it exists
            const noteText = note.startsWith('Note: ') ? note.substring(6) : note;
            const li = document.createElement('li');
            li.textContent = noteText;
            notesList.appendChild(li);
        });
        notesContainer.style.display = 'block';
        detailsElement.removeAttribute('open'); // Ensure it's closed by default
    } else {
        // If there are no notes, hide the whole container
        notesContainer.style.display = 'none';
    }

    showModal('run-summary-modal');
}
/**
 * Adds a new row with a rule selector to the set modal.
 * @param {HTMLElement} container - The container to append the new row to.
 * @param {string|null} [selectedRuleId=null] - A rule ID to pre-select.
 */
export function addRuleToSetRow(container, selectedRuleId = null) {
    const newRow = document.createElement('div');
    newRow.classList.add('set-rule-row');

    const newSelect = document.createElement('select');
    newSelect.name = 'set-rule-id';
    
    // Populate with rule names and IDs
    const ruleOptions = currentlyLoadedRules.map(rule => ({
        value: rule.id,
        text: rule.name
    }));
    populateSelectElement(newSelect, ruleOptions, '-- Select a Rule --', selectedRuleId);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.classList.add('remove-destination-button', 'secondary-button');
    removeButton.addEventListener('click', () => newRow.remove());

    newRow.appendChild(newSelect);
    newRow.appendChild(removeButton);
    container.appendChild(newRow);
}

/**
 * Resets the set form to its default state.
 */
export function resetSetForm() {
    const setForm = document.getElementById('set-form');
    if (!setForm) return;

    setForm.reset();
    document.getElementById('set-modal-title').textContent = 'Add New Set';
    setForm.dataset.editingSetId = '';
    document.getElementById('set-rules-container').innerHTML = '';
    
    // Hide the custom interval section on reset
    document.getElementById('set-custom-interval-section').style.display = 'none';
}

export function resetForm() {
    console.log("Resetting rule form.");
    ruleForm.reset();

    if (ruleNameInput) {
        ruleNameInput.placeholder = 'Rule #';
        ruleNameInput.value = '';
        ruleNameInput.removeAttribute('required');
    } else {
         console.error("Could not find the rule name input element (#rule-name) for reset.");
    }

    conditionsContainer.innerHTML = ''; // Clear conditions
    document.getElementById('modal-title').textContent = 'Add New Rule';
    ruleForm.dataset.editingRuleId = '';

    // Reset file service destinations
    additionalDestinationsContainer.innerHTML = '';
    const firstDestinationSelect = document.getElementById('first-destination-service-select');
    if (firstDestinationSelect) {
        populateSelectElement(firstDestinationSelect, availableFileServices, '-- Select Service --');
        firstDestinationSelect.value = "";
        firstDestinationSelect.removeAttribute('required');
    }
    destinationServicesSection.style.display = 'none';

    // Reset tag action details
    if (tagActionDetailsSection) {
        tagActionDetailsSection.style.display = 'none';
    }
    if (tagActionServiceSelect) {
        populateSelectElement(tagActionServiceSelect, availableTagServices, '-- Select Tag Service --');
        tagActionServiceSelect.value = '';
        tagActionServiceSelect.removeAttribute('required');
    }
    if (tagActionTagsInput) {
        tagActionTagsInput.value = '';
        tagActionTagsInput.removeAttribute('required');
    }

    if (modifyRatingDetailsSection) {
        modifyRatingDetailsSection.style.display = 'none';
    }
    if (modifyRatingServiceSelect) {
        populateSelectElement(modifyRatingServiceSelect, availableRatingServices, '-- Select Rating Service --');
        modifyRatingServiceSelect.value = '';
        modifyRatingServiceSelect.removeAttribute('required');
    }
    if (modifyRatingInputsArea) {
        modifyRatingInputsArea.innerHTML = ''; // Clear any dynamic inputs
    }

    // Reset new "Force In" details section
    const forceInSection = document.getElementById('force-in-details-section');
    const deepRunModeSelect = document.getElementById('deep-run-mode');
    const deepRunIntervalSection = document.getElementById('deep-run-interval-section');
    const deepRunIntervalInput = document.getElementById('deep-run-interval-runs');

    if (forceInSection) forceInSection.style.display = 'none';
    if (deepRunIntervalSection) deepRunIntervalSection.style.display = 'none';
    if (deepRunModeSelect) deepRunModeSelect.value = 'never'; // Default to 'Never'
    if (deepRunIntervalInput) deepRunIntervalInput.value = '5'; // Reset to default
	
    // Should now be handled by the calling context (main.js for new, edit_rule.js for edit).
    // if (addConditionRowFunction) {
    //      console.log("Adding initial condition row via injected function."); // This line will be removed
    //      addConditionRowFunction(conditionsContainer); // This line will be removed
    // } else {
    //      console.error("addConditionRowFunction not set! Cannot add initial condition row."); // This line will be removed
    // }
    console.log("Initial condition row NOT added by resetForm anymore.");


    actionTypeSelect.dispatchEvent(new Event('change')); // Trigger change to set initial visibility of action sections
}


// Add listener for the new summary modal's OK button
document.getElementById('run-summary-ok-button')?.addEventListener('click', () => {
    hideModal('run-summary-modal');
});

export function renderModifyRatingInputs(selectedServiceKey, currentActionData = {}) {
    if (!modifyRatingInputsArea) return;
    modifyRatingInputsArea.innerHTML = ''; // Clear previous inputs

    if (!selectedServiceKey || !availableServices) {
        return;
    }
    const selectedService = availableServices.find(service => service.service_key === selectedServiceKey);
    if (!selectedService) {
        console.warn("Modify Rating Action: Selected rating service not found:", selectedServiceKey);
        return;
    }

    const serviceType = selectedService.type;
    const minStars = selectedService.min_stars;
    const maxStars = selectedService.max_stars;

    // Name for inputs in this section to distinguish from condition inputs during form extraction
    const inputNamePrefix = 'modify-rating-action';

    if (serviceType === 7) { // Like/Dislike
        const stateSelect = document.createElement('select');
        stateSelect.name = `${inputNamePrefix}-state`; // e.g., modify-rating-action-state
        // Options: Like, Dislike, No Rating (null)
        const options = [
            { value: 'liked', text: 'Set to Liked' },       // Will map to true
            { value: 'disliked', text: 'Set to Disliked' }, // Will map to false
            { value: 'no_rating', text: 'Set to No Rating' } // Will map to null
        ];
        let selectedStateValue = '';
        // Pre-selection logic based on currentActionData.rating_value
        if (currentActionData.rating_value === true) selectedStateValue = 'liked';
        else if (currentActionData.rating_value === false) selectedStateValue = 'disliked';
        else if (currentActionData.rating_value === null && typeof currentActionData.rating_value === 'object') selectedStateValue = 'no_rating'; // Check for explicit null

        populateSelectElement(stateSelect, options, '-- Select State --', selectedStateValue);
        modifyRatingInputsArea.appendChild(stateSelect);
        stateSelect.required = true;

    } else if (serviceType === 6 || serviceType === 22) { // Numerical / Inc/Dec
        // For actions, we typically don't have operators like '>', '<'.
        // We either set a specific value or "no rating".
        const valueOrStateSelect = document.createElement('select');
        valueOrStateSelect.name = `${inputNamePrefix}-numerical-choice`;
        const numericalOptions = [
            { value: 'set_value', text: 'Set to Value' },
            { value: 'no_rating', text: 'Set to No Rating' }
        ];
        
        let preSelectedChoice = 'set_value'; // Default to setting a value
        if (currentActionData.rating_value === null && typeof currentActionData.rating_value === 'object') {
            preSelectedChoice = 'no_rating';
        }
        populateSelectElement(valueOrStateSelect, numericalOptions, '-- Choose Action --', preSelectedChoice);
        modifyRatingInputsArea.appendChild(valueOrStateSelect);
        valueOrStateSelect.required = true;

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.name = `${inputNamePrefix}-value`;
        valueInput.step = 'any'; // Hydrus usually deals with integers for stars

        if (currentActionData.rating_value !== null && typeof currentActionData.rating_value === 'number') {
            valueInput.value = currentActionData.rating_value;
        } else {
            valueInput.value = '';
        }

        if (minStars !== undefined && maxStars !== undefined) {
            valueInput.min = minStars; valueInput.max = maxStars;
            valueInput.placeholder = `Value (${minStars}-${maxStars})`;
        } else if (minStars !== undefined) {
            valueInput.min = minStars; valueInput.placeholder = `Value (>= ${minStars})`;
        } else if (maxStars !== undefined) {
            valueInput.max = maxStars; valueInput.placeholder = `Value (<= ${maxStars})`;
        } else {
            valueInput.placeholder = 'Value';
        }
        modifyRatingInputsArea.appendChild(valueInput);

        const updateNumericalInputs = () => {
            if (valueOrStateSelect.value === 'set_value') {
                valueInput.style.display = 'inline-block';
                valueInput.required = true;
            } else { // 'no_rating'
                valueInput.style.display = 'none';
                valueInput.required = false;
                valueInput.value = ''; // Clear value if "no rating"
            }
        };
        valueOrStateSelect.addEventListener('change', updateNumericalInputs);
        updateNumericalInputs(); // Initial call

    } else {
        const messageSpan = document.createElement('span');
        messageSpan.textContent = `Unsupported rating service type for action: ${serviceType}`;
        modifyRatingInputsArea.appendChild(messageSpan);
    }
}


actionTypeSelect.addEventListener('change', () => {
    const selectedAction = actionTypeSelect.value;
    const firstDestinationSelect = document.getElementById('first-destination-service-select');

    const forceInSection = document.getElementById('force-in-details-section');

    // --- Handle File Service Destinations ---
    const fileDestinationsNeeded = (selectedAction === 'add_to' || selectedAction === 'force_in');
    destinationServicesSection.style.display = fileDestinationsNeeded ? 'block' : 'none';
    addDestinationButton.style.display = fileDestinationsNeeded ? 'block' : 'none';
    
    // Show our new "Force In" options only for that action type
    if (forceInSection) {
        forceInSection.style.display = (selectedAction === 'force_in') ? 'block' : 'none';
    }

    if (firstDestinationSelect) {
        if (fileDestinationsNeeded) {
            populateSelectElement(firstDestinationSelect, availableFileServices, '-- Select Service --', firstDestinationSelect.value);
            firstDestinationSelect.required = true;
        } else {
            firstDestinationSelect.required = false;
            firstDestinationSelect.value = "";
        }
    }

    // --- Handle Tag Action Details ---
    const tagsActionNeeded = (selectedAction === 'add_tags' || selectedAction === 'remove_tags');
    if (tagActionDetailsSection) {
        tagActionDetailsSection.style.display = tagsActionNeeded ? 'block' : 'none';
    }
    if (tagActionServiceSelect) {
        if (tagsActionNeeded) {
            populateSelectElement(tagActionServiceSelect, availableTagServices, '-- Select Tag Service --', tagActionServiceSelect.value);
            tagActionServiceSelect.required = true;
        } else {
            tagActionServiceSelect.required = false;
            tagActionServiceSelect.value = "";
        }
    }
    if (tagActionTagsInput) {
        tagActionTagsInput.required = tagsActionNeeded;
        if (!tagsActionNeeded) tagActionTagsInput.value = "";
    }

    const modifyRatingActionNeeded = (selectedAction === 'modify_rating');
    if (modifyRatingDetailsSection) {
        modifyRatingDetailsSection.style.display = modifyRatingActionNeeded ? 'block' : 'none';
    }
    if (modifyRatingServiceSelect) {
        if (modifyRatingActionNeeded) {
            populateSelectElement(modifyRatingServiceSelect, availableRatingServices, '-- Select Rating Service --', modifyRatingServiceSelect.value);
            modifyRatingServiceSelect.required = true;
            // Initial render of inputs based on potentially pre-selected service (e.g., if form was re-shown with error)
            renderModifyRatingInputs(modifyRatingServiceSelect.value, {}); // Pass empty data for initial render
        } else {
            modifyRatingServiceSelect.required = false;
            modifyRatingServiceSelect.value = "";
            if (modifyRatingInputsArea) modifyRatingInputsArea.innerHTML = ''; // Clear inputs if not needed
        }
    }

    console.log(`Action type changed to: ${selectedAction}. File Dest: ${destinationServicesSection.style.display}, Tag Act: ${tagActionDetailsSection ? tagActionDetailsSection.style.display : 'N/A'}, Mod Rate: ${modifyRatingDetailsSection ? modifyRatingDetailsSection.style.display : 'N/A'}`);
});

if (modifyRatingServiceSelect) {
    modifyRatingServiceSelect.addEventListener('change', () => {
        renderModifyRatingInputs(modifyRatingServiceSelect.value, {}); // Pass empty data on change
    });
}

addDestinationButton.addEventListener('click', addDestinationServiceRow);

// Add a listener for our new Deep Run mode select
    const deepRunModeSelect = document.getElementById('deep-run-mode');
    if (deepRunModeSelect) {
        deepRunModeSelect.addEventListener('change', () => {
            const intervalSection = document.getElementById('deep-run-interval-section');
            if (intervalSection) {
                intervalSection.style.display = (deepRunModeSelect.value === 'every_x_runs') ? 'block' : 'none';
            }
        });
    }
	
// This flag will track if a mousedown event started on an overlay's background.
let isMouseDownOnOverlay = false;

// We need to apply this logic to every modal on the page.
document.querySelectorAll('.modal-overlay').forEach(modal => {
    
    // Listener for the close button (top right '×')
    const closeButton = modal.querySelector('.close-button');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            hideModal(modal.id);
        });
    }

    // Listener for when the mouse button is PRESSED DOWN on a modal.
    modal.addEventListener('mousedown', (event) => {
        // If the mousedown event's target is the overlay itself (the background),
        // then we set our flag to true.
        if (event.target === modal) {
            isMouseDownOnOverlay = true;
        }
    });

    // Listener for when the mouse button is RELEASED on a modal.
    modal.addEventListener('mouseup', (event) => {
        // If our flag is true (meaning the click started on the background)
        // AND the mouse is also released on the background...
        if (isMouseDownOnOverlay && event.target === modal) {
            // ...then it's a valid "click outside" and we can close the modal.
            hideModal(modal.id);
        }
        
        // No matter what, we reset the flag after the mouseup is complete.
        isMouseDownOnOverlay = false;
    });
});