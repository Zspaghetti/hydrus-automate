import { getConditionSummary } from './conditions_data.js';
import { runRule, deleteRule } from './rules_actions.js';
import { editRule } from './edit_rule.js';
import { availableFileServices, availableTagServices, availableRatingServices, availableServices } from './api.js';
import { getServiceName } from './utils.js';


// --- INTERNAL UI LOGIC ---

/**
 * Creates a structured object with details about a rule's action.
 * This is an internal helper consumed by the rendering logic to format the output.
 * @param {object} rule - The rule object.
 * @returns {object} An object containing parsed details like type, text, destination, and icon.
 */
function getActionDetails(rule) {
    const action = rule.action;
    let details = {
        type: 'Unknown',
        text: 'N/A',
        destination: 'N/A',
        destinationTitle: '',
        icon: 'fas fa-question-circle'
    };

    switch (action.type) {
        case 'add_to':
        case 'force_in':
            details.type = action.type === 'add_to' ? 'Add to (File Service)' : 'Force in (File Service)';
            details.icon = action.type === 'add_to' ? 'fas fa-folder-plus' : 'fas fa-file-import';
            if (action.destination_service_keys && Array.isArray(action.destination_service_keys) && action.destination_service_keys.length > 0) {
                const serviceNames = action.destination_service_keys.map(key => getServiceName(key, availableFileServices));
                details.destination = serviceNames.join(', ');
                details.destinationTitle = `File Services: ${serviceNames.join(', ')} (${action.destination_service_keys.join(', ')})`;
            } else if (action.destination_service_key) { // Fallback for single key
                const serviceName = getServiceName(action.destination_service_key, availableFileServices);
                details.destination = serviceName;
                details.destinationTitle = `File Service: ${serviceName} (${action.destination_service_key})`;
            }
            break;
        case 'add_tags':
        case 'remove_tags':
            const verb = action.type === 'add_tags' ? 'Add' : 'Remove';
            details.type = `${verb} Tags`;
            details.icon = action.type === 'add_tags' ? 'fas fa-tags' : 'fas fa-eraser';
            if (Array.isArray(action.tags_to_process) && action.tags_to_process.length > 0) {
                details.text = action.tags_to_process; // Keep as array for flexible rendering
            } else {
                details.text = 'No tags specified';
            }
            if (action.tag_service_key) {
                details.destination = getServiceName(action.tag_service_key, availableTagServices);
                details.destinationTitle = `Target Tag Service: ${details.destination} (${action.tag_service_key})`;
            } else {
                details.destination = "Tag Service (N/A)";
            }
            break;
        case 'modify_rating':
            details.type = 'Modify Rating';
            details.icon = 'fas fa-star-half-alt';
            const ratingValue = action.rating_value;
            const serviceDetails = availableServices.find(s => s.service_key === action.rating_service_key);
            if (ratingValue === true) {
                details.text = "Set to Liked";
            } else if (ratingValue === false) {
                details.text = "Set to Disliked";
            } else if (ratingValue === null && typeof ratingValue === 'object') {
                details.text = "Set to No Rating";
            } else if (typeof ratingValue === 'number') {
                let ratingText = `Set to ${ratingValue}`;
                if (serviceDetails && serviceDetails.type === 6 && serviceDetails.max_stars) { // Numerical (Type 6) with max_stars
                    ratingText += `/${serviceDetails.max_stars}`;
                }
                details.text = ratingText;
            } else {
                 details.text = "Modify Rating (Unknown value)";
            }
            if (action.rating_service_key) {
                details.destination = getServiceName(action.rating_service_key, availableRatingServices);
                details.destinationTitle = `Target Rating Service: ${details.destination} (${action.rating_service_key})`;
            } else {
                details.destination = "Rating Service (N/A)";
            }
            break;
        case 'archive_file':
            details.type = 'Archive File';
            details.icon = 'fas fa-archive';
            details.text = ''; // No extra details for this type
            break;
        default:
            details.type = action.type;
            details.text = '';
            break;
    }
    return details;
}

/**
 * Generates the HTML for a single rule card.
 * @param {Object} rule - The rule object.
 * @param {Object} context - Additional context (e.g., isSetPage).
 * @returns {string} The HTML string for the rule card.
 */
function renderRuleCard(rule, context) {
    const actionDetails = getActionDetails(rule);
    const ruleNameForNotif = rule.name || `Rule #${rule.id}`;

    // Conditions List
    const conditionsHtml = (rule.conditions && Array.isArray(rule.conditions) && rule.conditions.length > 0)
        ? rule.conditions.map(c => `<li>${getConditionSummary(c)}</li>`).join('')
        : '<li>No conditions defined.</li>';

    // Action Pane Details
    let actionDetailsHtml = '';
    if (Array.isArray(actionDetails.text) && actionDetails.text !== 'No tags specified') { // For add_tags/remove_tags
        actionDetailsHtml = `<ul class="action-details-list">${actionDetails.text.map(t => `<li>${t}</li>`).join('')}</ul>`;
    } else if (typeof actionDetails.text === 'string' && actionDetails.text && actionDetails.text !== 'N/A') {
        let text = actionDetails.text;
        if (actionDetails.destination !== 'N/A' && actionDetails.destination !== 'Tag Service (N/A)' && actionDetails.destination !== 'Rating Service (N/A)') {
            text += ` on '${actionDetails.destination}'`;
        }
        actionDetailsHtml = `<div class="action-details">${text}</div>`;
    } else if (actionDetails.destination !== 'N/A') {
        // For add_to / force_in where text is N/A but destination is important
        actionDetailsHtml = `<div class="action-details">${actionDetails.destination}</div>`;
    }

    // Control buttons
    let controlButtonsHtml = `
        <button class="control-btn run-button" title="Run Rule" data-rule-id="${rule.id}" data-rule-name="${ruleNameForNotif.replace(/"/g, '"')}"><i class="fas fa-play"></i></button>
        <button class="control-btn edit-button" title="Edit Rule" data-rule-id="${rule.id}"><i class="fas fa-edit"></i></button>
    `;

    if (context.isSetPage) {
        // Using a different icon for remove from set to distinguish from delete
        controlButtonsHtml += `
            <button class="control-btn remove-from-set-button" title="Remove from Set" data-rule-id="${rule.id}" data-set-id="${context.setId || ''}"><i class="fas fa-minus-circle"></i></button>
        `;
    }

    controlButtonsHtml += `
         <button class="control-btn delete-button delete" title="Delete Rule" data-rule-id="${rule.id}"><i class="fas fa-trash"></i></button>
    `;

    return `
        <div class="rule-card collapsible-rule" data-rule-id="${rule.id}">
            <div class="rule-card-header">
                <div class="rule-header-info">
                    <div class="rule-name">${rule.name || `Rule #${rule.id}`}</div>
                    <div class="rule-priority">Priority: ${rule.priority}</div>
                </div>
                <button class="run-btn-collapsed run-button" title="Run Rule" data-rule-id="${rule.id}" data-rule-name="${ruleNameForNotif.replace(/"/g, '"')}"><i class="${actionDetails.icon}"></i></button>
            </div>
            <div class="rule-card-body">
                <div class="rule-conditions-pane edit-trigger" title="Click to edit rule">
                    <div class="pane-title">Conditions</div>
                    <ul class="conditions-list">
                        ${conditionsHtml}
                    </ul>
                </div>
                <div class="rule-action-pane">
                    <i class="action-icon ${actionDetails.icon}"></i>
                    <div class="action-type">${actionDetails.type}</div>
                    ${actionDetailsHtml}
                </div>
                <div class="rule-controls-pane">
                    ${controlButtonsHtml}
                </div>
            </div>
        </div>
    `;
}

/**
 * Executes post-render logic, like adding the 'Add Rule' card and attaching event listeners.
 * @param {HTMLElement} container - The HTML element containing the rule cards.
 */
function postRenderSetup(container) {
    // The "Add New Rule" card is a feature of the main page (`/`).
    // It is not needed on the sets page (`/sets`), which has dedicated `+` and `++` buttons.
    const isMainPage = window.location.pathname === '/';

    // Append the "Add New Rule" card if it doesn't exist and we are on the main page.
    if (isMainPage && !container.querySelector('#add-new-rule-card')) {
        const addRuleCardHtml = `
            <div class="rule-card add-rule-card" id="add-new-rule-card">
                <div class="add-rule-content">
                    <i class="fas fa-plus-circle"></i>
                    <span>Add New Rule</span>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', addRuleCardHtml);
    }

    // Attach event listeners for expand/collapse behavior
    const collapsibleCards = container.querySelectorAll('.collapsible-rule');
    collapsibleCards.forEach(card => {
        // Use a data attribute to ensure listener is only added once
        if (card.dataset.listenerAttached) return;

        card.addEventListener('click', (event) => {
            // Only toggle the card if the click is not on a button or the clickable conditions pane.
            if (event.target.closest('button') || event.target.closest('.rule-conditions-pane.edit-trigger')) {
                return;
            }
            card.classList.toggle('expanded');
        });
        card.dataset.listenerAttached = 'true';
    });
}

// --- EXPORTED RENDER FUNCTION ---

/**
 * Renders a list of rules into the main rule container.
 * @param {Array<Object>} rules - The array of rule objects to render.
 * @param {Object} [context={}] - Additional context to pass to the rendering logic.
 */
export function renderRulesTable(rules, context = {}) {
    const containerSelector = '#rules-card-container';
    const rulesContainerElement = document.querySelector(containerSelector.split(' ')[0]);
    const noRulesMessage = document.getElementById('no-rules-message');
    const contentTarget = document.querySelector(containerSelector);

    if (!rulesContainerElement || !noRulesMessage || !contentTarget) {
        console.error("Essential UI elements for rendering rules are missing from the DOM.");
        return;
    }

    // Clone and replace the content container to clear old event listeners
    const newContentTarget = contentTarget.cloneNode(false);
    contentTarget.parentNode.replaceChild(newContentTarget, contentTarget);

    // Always show the main container. CSS will handle specifics (e.g., 'flex').
    // This ensures that even if there are no rules, the container for the "Add Rule" card is visible.
    rulesContainerElement.style.display = 'block';

    if (!rules || rules.length === 0) {
        newContentTarget.innerHTML = '';
        noRulesMessage.style.display = 'block';
    } else {
        noRulesMessage.style.display = 'none';

        // Generate and insert the HTML for all rule items
        newContentTarget.innerHTML = rules.map((rule, index) => {
            const itemContext = { ...context, index };
            return renderRuleCard(rule, itemContext);
        }).join('');
    }

    // Attach a single, consolidated delegated event listener to the container.
    newContentTarget.addEventListener('click', async (event) => {
        // Handle rule action buttons (Run, Edit, Delete, etc.)
        const button = event.target.closest('button[data-rule-id]');
        if (button) {
            const ruleId = button.dataset.ruleId;
            if (button.classList.contains('run-button')) {
                const ruleName = button.dataset.ruleName || `Rule with ID ${ruleId}`;
                runRule(ruleId, ruleName);
            } else if (button.classList.contains('edit-button')) {
                editRule(ruleId);
            } else if (button.classList.contains('delete-button')) {
                const result = await deleteRule(ruleId);
                if (result.success) {
                    // Make the state-saving logic context-aware based on the current page.
                    if (window.location.pathname.includes('/sets')) {
                        // On the sets page, get the ID from the dropdown selector.
                        const setSelector = document.getElementById('set-selector');
                        if (setSelector && setSelector.value) {
                            localStorage.setItem('hydrusButler_targetSetId', setSelector.value);
                        }
                    } else {
                        // On the main page, get the ID from the active set card in the sidebar.
                        const currentSetCard = document.querySelector('.set-card.active[data-set-id]');
                        if (currentSetCard) {
                            localStorage.setItem('hydrusButler_targetSetId', currentSetCard.dataset.setId);
                        }
                    }
                    window.location.reload();
                }
            }
            return; // Action handled
        }

        // Handle clicking the conditions pane to edit the rule.
        const conditionsPane = event.target.closest('.rule-conditions-pane.edit-trigger');
        if (conditionsPane) {
            const ruleCard = conditionsPane.closest('.rule-card[data-rule-id]');
            if (ruleCard) {
                const ruleId = ruleCard.dataset.ruleId;
                editRule(ruleId);
            }
            return; // Action handled
        }

        // The "Add New Rule" card click is handled by the page-specific scripts (e.g., main.js),
        // not by this shared UI component. This prevents incorrect behavior.
    });

    // Execute post-render logic (e.g., adding the 'Add Rule' card).
    // This must run even if there are no rules.
    postRenderSetup(newContentTarget);
}