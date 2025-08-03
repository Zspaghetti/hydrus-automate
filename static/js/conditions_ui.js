import { populateSelectElement } from './utils.js';
// Import all data definitions from conditions_data.js
// NOTE: conditionTypes and nestedConditionTypes will need 'paste_search' added
import { conditionTypes, nestedConditionTypes, fileTypeCategories, fileTypeCategoriesMap, extensionToCategoryMap, extractConditionData, urlSubtypes, specificUrlTypes } from './conditions_data.js';
import { availableServices, availableFileServices, availableRatingServices, availableTagServices } from './api.js'; // Import service data
import { setAddConditionRowFunction } from './modal.js'; // Import function to link addConditionRow

const addConditionButton = document.getElementById('add-condition-button'); // Button to add top-level conditions
const conditionsContainer = document.getElementById('conditions-container'); // Main container for top-level conditions


/**
 * Adds a new condition row to a specified parent container.
 * @param {HTMLElement} parentContainer - The DOM element to append the condition row to (e.g., conditionsContainer or an OR group container).
 * @param {object} [conditionData={}] - Optional data to pre-populate the row (used for editing).
 */
export function addConditionRow(parentContainer, conditionData = {}) {
    console.log("Adding a new condition row to", parentContainer.id || parentContainer.className, "with data:", conditionData);

    const conditionRow = document.createElement('div');
    conditionRow.classList.add('condition-row');
    // Add a class to indicate nesting level for styling
    if (parentContainer !== conditionsContainer) {
        conditionRow.classList.add('nested-condition-row');
    }

    // Store the original condition data on the row element for potential re-rendering or extraction
    conditionRow.__conditionData = conditionData;


    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.classList.add('remove-condition-button');
    removeButton.textContent = 'X';
	removeButton.title = 'Remove condition';
    removeButton.addEventListener('click', () => {
        console.log("Removing condition row");
        conditionRow.remove();
        // If this was the last condition in an OR group, add a new empty one to prevent empty OR group.
        if (parentContainer.children.length === 0 && parentContainer !== conditionsContainer && parentContainer.classList.contains('or-group-conditions-container')) {
             addConditionRow(parentContainer); // Add a new placeholder condition to the OR group
        } else if (parentContainer === conditionsContainer && parentContainer.children.length === 0) {
            // If the main conditions container becomes empty, the form validation will catch it.
            // No need to automatically add a row here, as the user might want an empty set of conditions
            // which is invalid and should be caught by form submission validation.
            // However, if the UI requires at least one condition always present even during editing,
            // you might add one back: addConditionRow(conditionsContainer);
        }
    });
    conditionRow.appendChild(removeButton);


    const typeSelect = document.createElement('select');
    typeSelect.name = 'condition-type';
    const typesList = (parentContainer === conditionsContainer || !parentContainer.classList.contains('or-group-conditions-container')) ? conditionTypes : nestedConditionTypes;
    populateSelectElement(typeSelect, typesList, '-- Select Condition Type --', conditionData.type);
    conditionRow.appendChild(typeSelect);

    const optionsArea = document.createElement('span');
    optionsArea.classList.add('options-area');
    conditionRow.appendChild(optionsArea);


    // Function to render options based on selected type
    function renderOptions(selectedType, data = {}) {
        console.log(`Rendering options for type: ${selectedType}`, 'with data:', data);
        optionsArea.innerHTML = ''; // Clear previous options

        if (selectedType === 'tags') {
            const tagInput = document.createElement('input');
            tagInput.type = 'text';
            tagInput.name = 'tags-value';
            tagInput.placeholder = 'tag1, namespace:tag2, -excluded_tag';
            if (Array.isArray(data.value)) {
                tagInput.value = data.value.join(', ');
            } else if (typeof data.value === 'string') {
                 tagInput.value = data.value; // Handles pre-fill if data.value was a string
            }
            optionsArea.appendChild(tagInput);
            tagInput.setAttribute('required', 'required');

        } else if (selectedType === 'rating') {
            const ratingServiceSelect = document.createElement('select');
            ratingServiceSelect.name = 'rating-service';
            populateSelectElement(ratingServiceSelect, availableRatingServices, "-- Select Rating Service --", data.service_key);
            optionsArea.appendChild(ratingServiceSelect);
            ratingServiceSelect.setAttribute('required', 'required');

            const ratingInputsArea = document.createElement('span');
            ratingInputsArea.classList.add('rating-inputs-area'); // For specific input controls
            optionsArea.appendChild(ratingInputsArea);

            // Nested function to render specific inputs based on selected rating service
            function renderRatingInputs(selectedServiceKey, conditionData = {}) {
                ratingInputsArea.innerHTML = ''; // Clear previous rating inputs

                if (!selectedServiceKey || !availableServices) {
                    // console.warn("renderRatingInputs: No service key or availableServices list.");
                    return; // Do nothing if no service selected or services not loaded
                }
                const selectedService = availableServices.find(service => service.service_key === selectedServiceKey);

                if (!selectedService) {
                    console.warn("Selected rating service not found:", selectedServiceKey);
                    return;
                }

                const serviceType = selectedService.type;
                const minStars = selectedService.min_stars; // For numerical ratings
                const maxStars = selectedService.max_stars; // For numerical ratings

                if (serviceType === 7) { // Like/Dislike
                    const likeDislikeSelect = document.createElement('select');
                    likeDislikeSelect.name = 'rating-operator'; // Used for unified extraction later
                    const options = [
                        { value: 'is_true', text: 'has rating (Liked)' }, // Maps to operator: 'is', value: true
                        { value: 'is_false', text: 'has rating (Disliked)' }, // Maps to operator: 'is', value: false
                        { value: 'no_rating', text: 'no rating' } // Maps to operator: 'no_rating'
                    ];
                    let selectedStateValue = ''; // Determine pre-selection
                    if (conditionData.operator === 'is' && conditionData.value === true) selectedStateValue = 'is_true';
                    else if (conditionData.operator === 'is' && conditionData.value === false) selectedStateValue = 'is_false';
                    else if (conditionData.operator === 'no_rating') selectedStateValue = 'no_rating';

                    populateSelectElement(likeDislikeSelect, options, '-- Select State --', selectedStateValue);
                    ratingInputsArea.appendChild(likeDislikeSelect);
                    likeDislikeSelect.setAttribute('required', 'required');

                } else if (serviceType === 6 || serviceType === 22) { // Numerical / Inc/Dec
                    const operatorSelect = document.createElement('select');
                    operatorSelect.name = 'rating-operator';
                    const ratingOperators = [
                        { value: 'is', text: 'is' },
                        { value: 'more_than', text: 'more than (>)' },
                        { value: 'less_than', text: 'less than (<)' },
                        { value: '!=', text: 'is not (≠)' },
                        { value: 'has_rating', text: 'has rating' }, // Does not require a value
                        { value: 'no_rating', text: 'no rating' }   // Does not require a value
                    ];
                    populateSelectElement(operatorSelect, ratingOperators, '-- Select Operator --', conditionData.operator);
                    ratingInputsArea.appendChild(operatorSelect);
                    operatorSelect.setAttribute('required', 'required');

                    const valueInput = document.createElement('input');
                    valueInput.type = 'number';
                    valueInput.name = 'rating-value';
                    valueInput.step = 'any'; // Allow decimals if needed, Hydrus might coerce
                    if (conditionData.value !== undefined && conditionData.value !== null) valueInput.value = conditionData.value;
                    else valueInput.value = ''; // Default to empty if no pre-fill value

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
                    ratingInputsArea.appendChild(valueInput);

                    // Show/hide value input based on operator
                    const updateValueInputVisibility = () => {
                        const selectedOperator = operatorSelect.value;
                        const requiresValue = !['has_rating', 'no_rating'].includes(selectedOperator);
                        valueInput.style.display = requiresValue ? 'inline-block' : 'none';
                        if (requiresValue) valueInput.setAttribute('required', 'required');
                        else valueInput.removeAttribute('required');
                    };

                    operatorSelect.addEventListener('change', updateValueInputVisibility);
                    updateValueInputVisibility(); // Initial call to set visibility

                } else {
                    const messageSpan = document.createElement('span');
                    messageSpan.textContent = `Unsupported rating service type: ${serviceType}`;
                    ratingInputsArea.appendChild(messageSpan);
                }
            }
            ratingServiceSelect.addEventListener('change', () => renderRatingInputs(ratingServiceSelect.value, data));
            if (data.service_key) renderRatingInputs(data.service_key, data); // Pre-fill if editing

        } else if (selectedType === 'file_service') {
            const operatorSelect = document.createElement('select');
            operatorSelect.name = 'file-service-operator';
            const fsOperators = [
                { value: 'is_in', text: 'is currently in' },
                { value: 'is_not_in', text: 'is not currently in' },
            ];
            populateSelectElement(operatorSelect, fsOperators, '-- Select Operator --', data.operator);
            optionsArea.appendChild(operatorSelect);
            operatorSelect.setAttribute('required', 'required');

            const serviceSelect = document.createElement('select');
            serviceSelect.name = 'file-service-service'; // Unique name for extraction
            populateSelectElement(serviceSelect, availableFileServices, "-- Select Service --", data.value); // data.value stores the service key here
            optionsArea.appendChild(serviceSelect);
            serviceSelect.setAttribute('required', 'required');

        } else if (selectedType === 'filesize') {
            const operatorSelect = document.createElement('select');
            operatorSelect.name = 'filesize-operator';
            const sizeOperators = [ { value: '>', text: '>' }, { value: '<', text: '<' }, { value: '=', text: '=' }, { value: '!=', text: '≠' }];
            populateSelectElement(operatorSelect, sizeOperators, '-- Select Operator --', data.operator);
            optionsArea.appendChild(operatorSelect);
            operatorSelect.setAttribute('required', 'required');

            const sizeInput = document.createElement('input');
            sizeInput.type = 'number';
            sizeInput.name = 'filesize-value';
            sizeInput.step = 'any';
            sizeInput.placeholder = 'Size value';
            if (data.value !== undefined && data.value !== null) sizeInput.value = data.value; else sizeInput.value = '';
            sizeInput.setAttribute('required', 'required');
            optionsArea.appendChild(sizeInput);

            const unitSelect = document.createElement('select');
            unitSelect.name = 'filesize-unit';
            const sizeUnits = ['bytes', 'KB', 'MB', 'GB'];
            populateSelectElement(unitSelect, sizeUnits.map(unit => ({ value: unit, text: unit })), '-- Select Unit --', data.unit);
            optionsArea.appendChild(unitSelect);
            unitSelect.setAttribute('required', 'required');

        } else if (selectedType === 'boolean') {
            const operatorSelect = document.createElement('select');
            operatorSelect.name = 'boolean-operator'; // This will hold 'inbox', 'archive', etc.

            const booleanOperators = [
                { value: 'inbox', text: 'Is in Inbox' },
                { value: 'archive', text: 'Is Archived' },
                { value: 'local', text: 'Is Local' },
                { value: 'trashed', text: 'Is Trashed' },
                { value: 'deleted', text: 'Is Deleted (from all local services)' },
                { value: 'has_audio', text: 'Has Audio' },
                { value: 'has_exif', text: 'Has EXIF' },
                { value: 'has_embedded_metadata', text: 'Has Embedded Metadata' },
                { value: 'has_icc_profile', text: 'Has ICC Profile' },
                { value: 'has_notes', text: 'Has Notes' },
                { value: 'has_tags', text: 'Has Tags' },
                { value: 'has_transparency', text: 'Has Transparency' },
                { value: 'has_duration', text: 'Has Duration' },
                { value: 'is_the_best_quality_file_of_its_duplicate_group', text: 'Is Best Quality Duplicate' }, // Note: long value
            ];
            populateSelectElement(operatorSelect, booleanOperators, '-- Select Flag --', data.operator);
            optionsArea.appendChild(operatorSelect);
            operatorSelect.setAttribute('required', 'required');

            const valueSelect = document.createElement('select');
            valueSelect.name = 'boolean-value'; // Will hold 'true' or 'false' as strings
            const booleanValues = [
                { value: 'true', text: 'is true' },
                { value: 'false', text: 'is false' }
            ];
            // If editing, data.value (which is a boolean true/false) needs to be converted to string 'true'/'false' for populateSelectElement
            const initialValueString = (typeof data.value === 'boolean') ? String(data.value) : 'true'; // Default to 'true' if not set or invalid
            populateSelectElement(valueSelect, booleanValues, '-- Select State --', initialValueString);
            optionsArea.appendChild(valueSelect);
            valueSelect.setAttribute('required', 'required');

            function updateBooleanValueSelectState() {
                const selectedOp = operatorSelect.value;
                const nonNegatableOps = ['inbox', 'archive', 'deleted'];
                const isFalseOption = valueSelect.querySelector('option[value="false"]');

                if (nonNegatableOps.includes(selectedOp)) {
                    isFalseOption.disabled = true;
                    if (valueSelect.value === 'false') {
                        valueSelect.value = 'true';
                    }
                } else {
                    isFalseOption.disabled = false;
                }
            }

            operatorSelect.addEventListener('change', updateBooleanValueSelectState);
            updateBooleanValueSelectState(); // Initial call to set state on render

        } else if (selectedType === 'url') {
            const subtypeSelect = document.createElement('select');
            subtypeSelect.name = 'url-subtype';
            populateSelectElement(subtypeSelect, urlSubtypes, '-- Select URL Type --', data.url_subtype);
            optionsArea.appendChild(subtypeSelect);
            subtypeSelect.setAttribute('required', 'required');

            const subtypeOptionsContainer = document.createElement('span');
            subtypeOptionsContainer.classList.add('url-subtype-options-container');
            optionsArea.appendChild(subtypeOptionsContainer);

            // Nested function to render inputs based on URL subtype
            function renderUrlSubtypeInputs(selectedSubtype, conditionData = {}) {
                subtypeOptionsContainer.innerHTML = ''; // Clear previous subtype inputs
                if (!selectedSubtype) return;

                if (selectedSubtype === 'specific') {
                    const specificTypeSelect = document.createElement('select');
                    specificTypeSelect.name = 'url-specific-type';
                    populateSelectElement(specificTypeSelect, specificUrlTypes, '-- Select Specific Type --', conditionData.specific_type);
                    subtypeOptionsContainer.appendChild(specificTypeSelect);
                    specificTypeSelect.setAttribute('required', 'required');

                    const operatorSelect = document.createElement('select');
                    operatorSelect.name = 'url-operator'; // For 'is'/'is_not'
                    const specificUrlOperators = [ { value: 'is', text: 'is' }, { value: 'is_not', text: 'is not' }];
                    populateSelectElement(operatorSelect, specificUrlOperators, '-- Select Operator --', conditionData.operator || 'is');
                    subtypeOptionsContainer.appendChild(operatorSelect);
                    operatorSelect.setAttribute('required', 'required');

                    const valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.name = 'url-value';
                    valueInput.placeholder = 'Enter URL, Domain, or Regex';
                    if (conditionData.value !== undefined && conditionData.value !== null) valueInput.value = conditionData.value; else valueInput.value = '';
                    valueInput.setAttribute('required', 'required');
                    subtypeOptionsContainer.appendChild(valueInput);

                } else if (selectedSubtype === 'existence') {
                    const operatorSelect = document.createElement('select');
                    operatorSelect.name = 'url-operator'; // For 'has'/'has_not'
                    const existenceOperators = [ { value: 'has', text: 'Has URLs' }, { value: 'has_not', text: 'Has no URLs' }];
                    populateSelectElement(operatorSelect, existenceOperators, '-- Select Existence --', conditionData.operator);
                    subtypeOptionsContainer.appendChild(operatorSelect);
                    operatorSelect.setAttribute('required', 'required');
                    // No value input for existence

                } else if (selectedSubtype === 'count') {
                    const operatorSelect = document.createElement('select');
                    operatorSelect.name = 'url-operator'; // For comparison operators
                    const countOperators = [ { value: '>', text: '>' }, { value: '<', text: '<' }, { value: '=', text: '=' }, { value: '!=', text: '≠' }];
                    populateSelectElement(operatorSelect, countOperators, '-- Select Operator --', conditionData.operator);
                    subtypeOptionsContainer.appendChild(operatorSelect);
                    operatorSelect.setAttribute('required', 'required');

                    const valueInput = document.createElement('input');
                    valueInput.type = 'number';
                    valueInput.name = 'url-value';
                    valueInput.step = '1'; valueInput.min = '0'; // Sensible defaults for count
                    valueInput.placeholder = 'Number of URLs';
                    if (conditionData.value !== undefined && conditionData.value !== null) valueInput.value = conditionData.value; else valueInput.value = '';
                    valueInput.setAttribute('required', 'required');
                    subtypeOptionsContainer.appendChild(valueInput);
                } else {
                    subtypeOptionsContainer.textContent = 'Select a URL type.';
                }
            }

            subtypeSelect.addEventListener('change', () => renderUrlSubtypeInputs(subtypeSelect.value, data));
            // Pre-fill if editing or set a default
            if (data.url_subtype) renderUrlSubtypeInputs(data.url_subtype, data);
            else { subtypeSelect.value = 'specific'; renderUrlSubtypeInputs('specific', {});} // Default to specific if new

        } else if (selectedType === 'filetype') {
            const operatorSelect = document.createElement('select');
            operatorSelect.name = 'filetype-operator';
            const filetypeOperators = [ { value: 'is', text: 'is' }, { value: 'is_not', text: 'is not' }];
            populateSelectElement(operatorSelect, filetypeOperators, '-- Select Operator --', data.operator || 'is');
            optionsArea.appendChild(operatorSelect);
            operatorSelect.setAttribute('required', 'required');

            const filetypeOptionsContainer = document.createElement('div');
            filetypeOptionsContainer.classList.add('filetype-options-container');
            optionsArea.appendChild(filetypeOptionsContainer);

            const selectedValues = Array.isArray(data.value) ? data.value : [];

            fileTypeCategories.forEach(category => {
                const categoryRow = document.createElement('div');
                categoryRow.classList.add('filetype-category-row');

                const categoryHeader = document.createElement('div');
                categoryHeader.classList.add('filetype-category-header');
                categoryHeader.style.display = 'flex'; categoryHeader.style.alignItems = 'center';

                const categoryCheckbox = document.createElement('input');
                categoryCheckbox.type = 'checkbox';
                categoryCheckbox.classList.add('filetype-category-checkbox');
                categoryCheckbox.name = `filetype-category-${category.predicate_value}`; // Unique name
                categoryCheckbox.value = category.predicate_value; // e.g., "image"
                categoryHeader.appendChild(categoryCheckbox);

                const categoryLabel = document.createElement('label');
                categoryLabel.textContent = category.name; // e.g., "Image"
                categoryLabel.style.flexGrow = '1'; categoryLabel.style.marginLeft = '5px';
                categoryHeader.appendChild(categoryLabel);

                const toggleButton = document.createElement('button');
                toggleButton.type = 'button';
                toggleButton.classList.add('filetype-toggle-extensions');
                toggleButton.textContent = '▼'; // Down arrow
                toggleButton.style.marginLeft = 'auto'; // Push to the right
                toggleButton.style.background = 'none'; toggleButton.style.border = 'none';
                toggleButton.style.color = 'inherit'; toggleButton.style.cursor = 'pointer';
                toggleButton.style.fontSize = '0.9em'; toggleButton.style.padding = '0 5px';
                categoryHeader.appendChild(toggleButton);
                categoryRow.appendChild(categoryHeader);

                const extensionsContainer = document.createElement('div');
                extensionsContainer.classList.add('filetype-extensions-container');
                extensionsContainer.style.display = 'none'; // Hidden by default
                extensionsContainer.style.paddingLeft = '20px'; extensionsContainer.style.marginTop = '5px';

                if (Array.isArray(category.extensions)) {
                    category.extensions.forEach(extValue => { // e.g., "jpeg"
                        const extensionRow = document.createElement('div');
                        extensionRow.classList.add('filetype-extension-row');
                        extensionRow.style.display = 'flex'; extensionRow.style.alignItems = 'center'; extensionRow.style.gap = '5px';

                        const extensionCheckbox = document.createElement('input');
                        extensionCheckbox.type = 'checkbox';
                        extensionCheckbox.classList.add('filetype-extension-checkbox');
                        extensionCheckbox.name = `filetype-extension-${extValue}`; // Unique name
                        extensionCheckbox.value = extValue;
                        extensionRow.appendChild(extensionCheckbox);

                        const extensionLabel = document.createElement('label');
                        extensionLabel.textContent = extValue;
                        extensionRow.appendChild(extensionLabel);
                        extensionsContainer.appendChild(extensionRow);

                        // Pre-check if editing and this extension was selected
                        if (selectedValues.includes(extValue)) extensionCheckbox.checked = true;
                    });
                }
                categoryRow.appendChild(extensionsContainer);
                filetypeOptionsContainer.appendChild(categoryRow);

                // Event listeners for category checkbox and toggle button
                const extensionCheckboxes = extensionsContainer.querySelectorAll('.filetype-extension-checkbox');
                categoryCheckbox.addEventListener('change', () => {
                    extensionCheckboxes.forEach(extCb => extCb.checked = categoryCheckbox.checked);
                });
                extensionCheckboxes.forEach(extCb => {
                    extCb.addEventListener('change', () => {
                        categoryCheckbox.checked = Array.from(extensionCheckboxes).every(cb => cb.checked);
                    });
                });
                toggleButton.addEventListener('click', () => {
                    const isHidden = extensionsContainer.style.display === 'none';
                    extensionsContainer.style.display = isHidden ? 'block' : 'none';
                    toggleButton.textContent = isHidden ? '▲' : '▼'; // Up/Down arrow
                });
                // Category header click also toggles
                categoryHeader.addEventListener('click', (e) => {
                     if (e.target !== categoryCheckbox && e.target !== toggleButton) { // Don't interfere with direct clicks on checkbox/button
                         toggleButton.click();
                     }
                });


                // Initial state for category checkbox and expansion based on selectedValues
                const allExtsChecked = Array.from(extensionCheckboxes).length > 0 && Array.from(extensionCheckboxes).every(extCb => selectedValues.includes(extCb.value));
                const categoryPredicateSelected = selectedValues.includes(category.predicate_value);

                if (allExtsChecked || categoryPredicateSelected) {
                    categoryCheckbox.checked = true;
                    // If only the category predicate was selected, check all its extensions for UI consistency
                    if (categoryPredicateSelected && !allExtsChecked && Array.from(extensionCheckboxes).length > 0) {
                        extensionCheckboxes.forEach(extCb => extCb.checked = true);
                    }
                }
                // Expand if category or any child is checked
                if (categoryCheckbox.checked || Array.from(extensionCheckboxes).some(cb => cb.checked)) {
                    extensionsContainer.style.display = 'block';
                    toggleButton.textContent = '▲';
                }
            });

        } else if (selectedType === 'or_group') {
            const orGroupContainer = document.createElement('div');
            orGroupContainer.classList.add('or-group-conditions-container');
            optionsArea.appendChild(orGroupContainer);

            const addNestedConditionButton = document.createElement('button');
            addNestedConditionButton.type = 'button';
            addNestedConditionButton.classList.add('add-condition-button'); // Use same class for styling
            addNestedConditionButton.textContent = 'Add OR Condition';
            addNestedConditionButton.addEventListener('click', () => addConditionRow(orGroupContainer)); // Pass the OR group's container
            optionsArea.appendChild(addNestedConditionButton);

            // Populate with existing nested conditions if editing
            if (data.conditions && Array.isArray(data.conditions)) {
                data.conditions.forEach(nestedData => addConditionRow(orGroupContainer, nestedData));
            } else {
                addConditionRow(orGroupContainer); // Add one by default if new
            }
        } else if (selectedType === 'paste_search') {
            const pasteAreaElement = document.createElement('textarea');
            pasteAreaElement.name = 'paste-search-value';
            pasteAreaElement.placeholder = 'Paste Hydrus search text here...\nOne tag/predicate per line.\nCopy with OR predicates collapsed for OR groups.';
            pasteAreaElement.rows = 10; // Good default size
            pasteAreaElement.cols = 50; // Good default size
            pasteAreaElement.classList.add('paste-search-textarea'); // For specific styling if needed
            if (data.value !== undefined && data.value !== null) pasteAreaElement.value = data.value;
            else pasteAreaElement.value = '';
            pasteAreaElement.setAttribute('required', 'required');
            optionsArea.appendChild(pasteAreaElement);
        } else if (selectedType === 'limit') {
            const limitInput = document.createElement('input');
            limitInput.type = 'number';
            limitInput.name = 'limit-value';
            limitInput.placeholder = 'e.g., 100';
            limitInput.min = '1';
            limitInput.step = '1';
            if (data.value !== undefined && data.value !== null) {
                limitInput.value = data.value;
            } else {
                limitInput.value = '';
            }
            limitInput.setAttribute('required', 'required');
            optionsArea.appendChild(limitInput);

            const textSpan = document.createElement('span');
            textSpan.textContent = ' files';
            optionsArea.appendChild(textSpan);
        } else {
            // Fallback for unhandled or empty types
            // optionsArea.textContent = 'No options for this type.';
        }
    }

    typeSelect.addEventListener('change', () => {
        console.log(`Condition type changed to: ${typeSelect.value}`);
        renderOptions(typeSelect.value, {}); // Pass empty data for new selection
    });

    // Initial render of options based on pre-selected type (if any, e.g., during edit)
    if (conditionData.type) {
        renderOptions(conditionData.type, conditionData);
    } else {
        renderOptions(typeSelect.value, {}); // Render based on default selected type, if any, or empty options
    }

    parentContainer.appendChild(conditionRow);
}

// This function is crucial for modal.js to be able to call addConditionRow
setAddConditionRowFunction(addConditionRow);

if (addConditionButton && conditionsContainer) {
    addConditionButton.addEventListener('click', () => {
        console.log("Main Add Condition button clicked via conditions_ui.js listener.");
        addConditionRow(conditionsContainer); // Add a new top-level condition
    });
} else {
    console.warn("Could not find main 'Add Condition' button or its container. Top-level add condition functionality might be broken.");
}


/**
 * Refreshes service-dependent dropdowns within the modal's conditions UI.
 * This is typically called after services are updated.
 */
export function refreshModalConditionsUI() {
    const ruleModalElement = document.getElementById('rule-modal');
    if (!ruleModalElement || ruleModalElement.style.display === 'none') {
        return; // Modal not visible, no need to refresh
    }

    console.log("Refreshing modal condition UI after service update.");

    // Refresh destination service selects in the action part of the form
    const firstDestSelect = document.getElementById('first-destination-service-select');
    if (firstDestSelect) {
        populateSelectElement(firstDestSelect, availableFileServices, '-- Select Service --', firstDestSelect.value);
    }
    ruleModalElement.querySelectorAll('.destination-service-select').forEach(selectEl => {
         if (selectEl !== firstDestSelect) { // Avoid re-populating the first one if already handled
            populateSelectElement(selectEl, availableFileServices, '-- Select Service --', selectEl.value);
         }
    });
    // Also refresh tag action service select
    const tagActionServiceSel = document.getElementById('tag-action-service-select');
    if (tagActionServiceSel) {
        populateSelectElement(tagActionServiceSel, availableTagServices, '-- Select Tag Service --', tagActionServiceSel.value);
    }


    // Refresh condition rows
    ruleModalElement.querySelectorAll('.condition-row').forEach(rowEl => {
        const typeSel = rowEl.querySelector('select[name="condition-type"]');
        const selectedType = typeSel ? typeSel.value : '';
        const optionsArea = rowEl.querySelector('.options-area');
        // __conditionData should hold the state of the row as it was when loaded or last rendered
        const originalData = rowEl.__conditionData || {};

        if (!optionsArea) return;

        if (selectedType === 'rating') {
            const ratingServiceSel = optionsArea.querySelector('select[name="rating-service"]');
            if (ratingServiceSel) {
                populateSelectElement(ratingServiceSel, availableRatingServices, '-- Select Rating Service --', ratingServiceSel.value);
                // The specific inputs for rating (like/dislike or numerical) depend on the selected rating service.
                // Triggering a 'change' event on ratingServiceSel will re-render these inputs
                // by calling renderRatingInputs, which is defined inside renderOptions.
                // This ensures the sub-inputs adapt if the service list or their properties changed.
                ratingServiceSel.dispatchEvent(new Event('change'));
            }
        } else if (selectedType === 'file_service') {
            const serviceSel = optionsArea.querySelector('select[name="file-service-service"]');
            if (serviceSel) {
                populateSelectElement(serviceSel, availableFileServices, '-- Select Service --', serviceSel.value);
            }
        } else if (selectedType === 'url') {
            // URL conditions don't directly depend on the service list being refreshed,
            // but if urlSubtypes or specificUrlTypes were dynamic, they'd be handled here.
            // For now, no action needed beyond what renderOptions initially sets up.
        }
        // Add other condition types here if they depend on dynamic service lists and need UI refresh.
    });
}