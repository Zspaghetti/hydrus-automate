// static/js/rule_intervals.js

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('rule-intervals-form');
    const tableBody = document.querySelector('#rule-intervals-table tbody');
    const statusMessageDiv = document.getElementById('status-message');
    const noRulesMessage = document.getElementById('no-rules-message');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const massIntervalType = document.getElementById('mass-interval-type');
    const massCustomInput = document.getElementById('mass-custom-interval-input');
    const applyMassEditButton = document.getElementById('apply-mass-edit-button');

    if (!form || !tableBody || !statusMessageDiv || !noRulesMessage) {
        console.error('Required page elements not found. Page functionality will be broken.');
        return;
    }

    let serviceNameMap = new Map();
    let isDirty = false; // Flag to track unsaved changes

    /**
     * Sets the form state to "dirty", indicating there are unsaved changes.
     */
    const setDirty = () => {
        isDirty = true;
    };

    /**
     * Helper to safely get a service name from its key.
     * Falls back to showing a truncated key if the name is not found.
     */
    const getServiceName = (key) => {
        if (!key) return 'N/A';
        return serviceNameMap.get(key) || `[${key.substring(0, 8)}...]`;
    };

    /**
     * Renders a human-readable string for a rule's action.
     */
    const renderRuleActionDetails = (action) => {
        if (!action || !action.type) return 'No action';
        
        const type = action.type;
        if (type === 'add_to' || type === 'force_in') {
            const dests = action.destination_service_keys || [];
            return dests.map(getServiceName).join(', ');
        }
        if (type === 'add_tags' || type === 'remove_tags') {
            const tagService = getServiceName(action.tag_service_key);
            const tags = (action.tags_to_process || []).join(', ');
            return `Tags: [${tags}] on ${tagService}`;
        }
        if (type === 'modify_rating') {
            const ratingService = getServiceName(action.rating_service_key);
            return `Set '${action.rating_value}' on ${ratingService}`;
        }
        return 'Unsupported or invalid action';
    };

    /**
     * Renders a human-readable string for a rule's conditions.
     */
    const renderRuleConditions = (conditions) => {
        if (!conditions || conditions.length === 0) return 'Always active';
        return conditions.map(c => c.type.replace(/_/g, ' ')).join(', ');
    };

    /**
     * Fetches rules and services, then populates the table.
     */
    const initializePage = async () => {
        statusMessageDiv.textContent = 'Loading rules...';
        statusMessageDiv.className = 'message info';
        // CHANGED: Use classList to control visibility
        statusMessageDiv.classList.remove('hidden');

        try {
            try {
                const servicesResponse = await fetch('/get_all_services');
                if (servicesResponse.ok) {
                    const servicesData = await servicesResponse.json();
                    if (servicesData.success) {
                        servicesData.services.forEach(service => {
                            serviceNameMap.set(service.service_key, service.name);
                        });
                    }
                } else {
                    console.warn('Could not fetch services. Service names will not be translated.');
                }
            } catch (e) {
                 console.warn('Network error while fetching services. Service names will not be translated.', e);
            }

            const rulesResponse = await fetch('/rules');
            if (!rulesResponse.ok) throw new Error('Failed to fetch rules from server.');
            const rulesData = await rulesResponse.json();
            if (!rulesData.success) throw new Error(rulesData.message || 'Server returned an error for rules.');

            const rules = rulesData.rules;
            tableBody.innerHTML = '';

            if (rules.length === 0) {
                // CHANGED: Use classList to control visibility
                noRulesMessage.classList.remove('hidden');
                statusMessageDiv.classList.add('hidden');
                return;
            }

            rules.sort((a, b) => (parseInt(a.priority, 10) || 999) - (parseInt(b.priority, 10) || 999) || a.name.localeCompare(b.name));

            rules.forEach((rule, index) => {
                const override = rule.execution_override || { type: 'default', value: null };
                const isCustom = override.type === 'custom';
                const conditionsText = renderRuleConditions(rule.conditions);
                const actionDetailsText = renderRuleActionDetails(rule.action);

                const row = tableBody.insertRow();
                row.className = 'rule-interval-row';
                row.dataset.ruleId = rule.id;

                // UPDATED: Added the "col-*" classes to each <td> to match the new HTML structure.
                // This is the most important change.
                row.innerHTML = `
                    <td class="col-select"><input type="checkbox" class="rule-checkbox" title="Select this rule for mass editing"></td>
                    <td class="col-id">${index + 1}</td>
                    <td class="col-priority" title="Priority: ${rule.priority}">${rule.priority}</td>
                    <td class="col-name" title="${rule.name}">${rule.name}</td>
                    <td class="col-conditions" title="${conditionsText}">${conditionsText}</td>
                    <td class="col-action" title="${rule.action.type.replace(/_/g, ' ')}">${rule.action.type.replace(/_/g, ' ')}</td>
                    <td class="col-details" title="${actionDetailsText}">${actionDetailsText}</td>
                    <td class="col-interval">
                        <div class="interval-controls">
                            <select class="interval-type-select" title="Set interval type for this rule">
                                <option value="default" ${override.type === 'default' ? 'selected' : ''}>Default</option>
                                <option value="custom" ${isCustom ? 'selected' : ''}>Custom</option>
                                <option value="none" ${override.type === 'none' ? 'selected' : ''}>None</option>
                            </select>
                            <input type="number" class="custom-interval-input ${isCustom ? '' : 'hidden'}" min="10" step="1"
                                   value="${isCustom && override.value ? override.value : '600'}"
                                   title="Custom interval in seconds"
                                   ${isCustom ? 'required' : ''}>
                            <span class="custom-interval-unit ${isCustom ? '' : 'hidden'}">s</span>
                        </div>
                    </td>
                `;
            });
            // CHANGED: Use classList to control visibility
            statusMessageDiv.classList.add('hidden');
        } catch (error) {
            console.error('Failed to initialize rule intervals page:', error);
            noRulesMessage.classList.remove('hidden');
            noRulesMessage.textContent = 'Error loading rules. See console for details.';
            statusMessageDiv.textContent = `Error: ${error.message}`;
            statusMessageDiv.className = 'message error';
        }
    };

    await initializePage();

    form.addEventListener('change', setDirty);

    /**
     * Handles changes to the interval type dropdown.
     */
    const handleIntervalTypeChange = (event) => {
        if (event.target.classList.contains('interval-type-select')) {
            const row = event.target.closest('.rule-interval-row');
            if (!row) return;
            const customInput = row.querySelector('.custom-interval-input');
            const customUnit = row.querySelector('.custom-interval-unit');
            
            const showCustom = event.target.value === 'custom';

            // CHANGED: Use classList.toggle for cleaner show/hide logic
            customInput.classList.toggle('hidden', !showCustom);
            customUnit.classList.toggle('hidden', !showCustom);
            customInput.required = showCustom;
        }
    };

    tableBody.addEventListener('change', handleIntervalTypeChange);

    /**
     * Handles the form submission.
     */
    const handleFormSubmit = async (event) => {
        event.preventDefault();
        statusMessageDiv.textContent = 'Saving...';
        statusMessageDiv.className = 'message info';
        // CHANGED: Use classList to control visibility
        statusMessageDiv.classList.remove('hidden');

        const ruleRows = form.querySelectorAll('.rule-interval-row');
        const intervalsData = [];

        ruleRows.forEach(row => {
            const ruleId = row.dataset.ruleId;
            const typeSelect = row.querySelector('.interval-type-select');
            const customInput = row.querySelector('.custom-interval-input');
            if (!ruleId || !typeSelect || !customInput) return;

            const type = typeSelect.value;
            let value = null;
            if (type === 'custom') {
                const parsedValue = parseInt(customInput.value, 10);
                value = isNaN(parsedValue) || parsedValue < 10 ? 10 : parsedValue;
                customInput.value = value;
            }
            intervalsData.push({ rule_id: ruleId, type, value });
        });

        try {
            const response = await fetch('/save_rule_intervals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(intervalsData)
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'An unknown error occurred.');
            
            statusMessageDiv.textContent = result.message || 'Interval settings saved successfully!';
            statusMessageDiv.className = 'message success';
            isDirty = false;
        } catch (error) {
            console.error('Error saving rule intervals:', error);
            statusMessageDiv.textContent = `Error: ${error.message}`;
            statusMessageDiv.className = 'message error';
        }
    };

    form.addEventListener('submit', handleFormSubmit);

    // --- Mass Edit Logic ---
    selectAllCheckbox.addEventListener('change', () => {
        tableBody.querySelectorAll('.rule-checkbox').forEach(cb => cb.checked = selectAllCheckbox.checked);
    });
    
    massIntervalType.addEventListener('change', () => {
        // CHANGED: Use classList.toggle for cleaner show/hide logic
        const showCustom = massIntervalType.value === 'custom';
        massCustomInput.classList.toggle('hidden', !showCustom);
    });
    
    applyMassEditButton.addEventListener('click', () => {
        const newType = massIntervalType.value;
        const newCustomValue = massCustomInput.value;
        if (newType === 'custom' && (!newCustomValue || parseInt(newCustomValue) < 10)) {
            alert('Please enter a custom interval of 10 seconds or more.');
            massCustomInput.focus();
            return;
        }

        const selectedRows = tableBody.querySelectorAll('.rule-checkbox:checked');
        if (selectedRows.length === 0) {
            alert('Please select at least one rule to apply changes to.');
            return;
        }

        selectedRows.forEach(checkbox => {
            const row = checkbox.closest('.rule-interval-row');
            const typeSelect = row.querySelector('.interval-type-select');
            if (newType === 'custom') {
                row.querySelector('.custom-interval-input').value = newCustomValue;
            }
            typeSelect.value = newType;
            typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        statusMessageDiv.textContent = `Applied changes to ${selectedRows.length} rules. Don't forget to save.`;
        statusMessageDiv.className = 'message info';
        // CHANGED: Use classList to control visibility
        statusMessageDiv.classList.remove('hidden');
    });

    window.addEventListener('beforeunload', (event) => {
        if (isDirty) {
            event.preventDefault();
            event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
});