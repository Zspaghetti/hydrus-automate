import {
    runRule as runRuleApi,
    deleteRule as deleteRuleApi,
    runAllRulesManualApi,
    estimateRuleImpactApi,
    currentlyLoadedRules,
    showNotificationsSetting,
    clientShowRunAllNotificationsSetting,
	clientShowRunSummaryNotificationsSetting,     
    clientShowRunAllSummaryNotificationsSetting
} from './api.js';

import { renderRulesTable } from './rules_ui.js';
import { showModal, hideModal, showRunSummaryModal } from './modal.js'; // Import the new modal function

const STORAGE_KEY = 'hydrusButlerManualRunOptions';

/**
 * Shows the manual run modal, populates it with rules, fetches impact estimates,
 * and returns a promise that resolves with the user's choices.
 * @param {Array<Object>} rules - An array of rule objects to be run.
 * @returns {Promise<Object>} A promise that resolves with { override_bypass_list, deep_run_list }
* or rejects if the user cancels.
 */
export function showManualRunModal(rules) {
    const modal = document.getElementById('manual-run-options-modal');
    const titleEl = document.getElementById('manual-run-modal-title');
    const impactEl = document.getElementById('manual-run-impact-estimate');
    const ruleListEl = document.getElementById('manual-run-rule-list');
    const proceedButton = document.getElementById('manual-run-proceed-button');
    const cancelButton = document.getElementById('manual-run-cancel-button');
    const closeButton = modal.querySelector('.close-button');

    // Make the rule list container scrollable to prevent the modal from becoming too tall.
    // This keeps the header and action buttons always visible.
    ruleListEl.style.overflowY = 'auto';
    ruleListEl.style.maxHeight = '40vh'; // Limit height to 40% of the viewport height.
    ruleListEl.style.padding = '0.5em';
    ruleListEl.style.borderTop = '1px solid #ddd';
    ruleListEl.style.borderBottom = '1px solid #ddd';
    ruleListEl.style.marginTop = '1em';
    ruleListEl.style.marginBottom = '1em';

    return new Promise((resolve, reject) => {
        // Reset modal state
        ruleListEl.innerHTML = '';
        proceedButton.disabled = true;
        titleEl.textContent = rules.length > 1 ? `Manual Run Options for ${rules.length} Rules` : `Manual Run Options for "${rules[0].name}"`;
        impactEl.textContent = 'Estimating impact for all rules...';

        // Load saved options from localStorage
        const savedOptions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};

        // Function to save current checkbox states to localStorage
        const saveOptions = () => {
            const currentOptions = { override_bypass_list: [], deep_run_list: [] };
            ruleListEl.querySelectorAll('.bypass-override-cb:checked').forEach(cb => currentOptions.override_bypass_list.push(cb.dataset.ruleId));
            ruleListEl.querySelectorAll('.deep-run-cb:checked').forEach(cb => currentOptions.deep_run_list.push(cb.dataset.ruleId));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentOptions));
        };

        // Populate the rule list
        rules.forEach(rule => {
            const li = document.createElement('li');
            li.dataset.ruleId = rule.id;

            const isBypassChecked = (savedOptions.override_bypass_list || []).includes(rule.id);
            const isDeepRunChecked = (savedOptions.deep_run_list || []).includes(rule.id);
            const showDeepRun = rule.action.type === 'force_in';

            li.innerHTML = `
                <div class="rule-name" title="${rule.name}">${rule.name}</div>
                <div class="options">
                    <span class="impact-estimate">Estimating...</span>
                    <label title="If checked, this rule will ignore 'Watch and Clear' and 'Priority' override protections from other rules.">
                        <input type="checkbox" class="bypass-override-cb" data-rule-id="${rule.id}" ${isBypassChecked ? 'checked' : ''}>
                        Bypass Overrides
                    </label>
                    <label class="deep-run-label" style="display: ${showDeepRun ? 'inline-block' : 'none'};" title="Search for files already in the destination domain, but not exclusively in it. Useful for adding tags to already-archived files.">
                        <input type="checkbox" class="deep-run-cb" data-rule-id="${rule.id}" ${isDeepRunChecked ? 'checked' : ''}>
                        Deep Run
                    </label>
                </div>
            `;
            ruleListEl.appendChild(li);

            // Add listeners for dynamic re-estimation
            const bypassCheckbox = li.querySelector('.bypass-override-cb');
            const deepRunCheckbox = li.querySelector('.deep-run-cb');

            const reEstimate = () => {
                const estimateSpan = li.querySelector('.impact-estimate');
                const isBypass = bypassCheckbox.checked;
                const isDeepRun = deepRunCheckbox ? deepRunCheckbox.checked : false;

                estimateSpan.textContent = 'Re-estimating...';
                estimateSpan.className = 'impact-estimate';

                estimateRuleImpactApi(rule.id, { isDeepRun: isDeepRun, isBypassOverride: isBypass })
                    .then(result => {
                        if (result.success) {
                            estimateSpan.textContent = generateImpactMessage(rule, result.estimated_actionable_files);
                            estimateSpan.classList.add('success');
                        } else {
                            estimateSpan.textContent = 'Estimation Failed';
                            estimateSpan.classList.add('error');
                            estimateSpan.title = result.message || 'The estimation API call failed.';
                        }
                    });
            };

            bypassCheckbox.addEventListener('change', reEstimate);
            if (deepRunCheckbox) {
                deepRunCheckbox.addEventListener('change', reEstimate);
            }
        });

        // Add event listener for saving options on any change within the list
        ruleListEl.addEventListener('change', saveOptions);

        // Define cleanup and event removal function
        const cleanup = () => {
            hideModal('manual-run-options-modal');
            proceedButton.removeEventListener('click', onProceed);
            cancelButton.removeEventListener('click', onCancel);
            closeButton.removeEventListener('click', onCancel);
            ruleListEl.removeEventListener('change', saveOptions);
        };

        const onProceed = () => {
            saveOptions(); // Ensure options are saved on proceed
            const finalOptions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { override_bypass_list: [], deep_run_list: [] };
            cleanup();
            resolve(finalOptions);
        };

        const onCancel = () => {
            cleanup();
            reject(new Error('User cancelled the operation.'));
        };

        // Attach main modal button event listeners
        proceedButton.addEventListener('click', onProceed);
        cancelButton.addEventListener('click', onCancel);
        closeButton.addEventListener('click', onCancel);

        showModal('manual-run-options-modal');

        // Asynchronously fetch all initial impact estimates
        const estimatePromises = rules.map(rule => {
            const isDeepRunChecked = (savedOptions.deep_run_list || []).includes(rule.id);
            return estimateRuleImpactApi(rule.id, { isDeepRun: rule.action.type === 'force_in' && isDeepRunChecked })
                .then(result => {
                    const li = ruleListEl.querySelector(`li[data-rule-id='${rule.id}']`);
                    const estimateSpan = li.querySelector('.impact-estimate');
                    if (result.success) {
                        estimateSpan.textContent = generateImpactMessage(rule, result.estimated_actionable_files);
                        estimateSpan.classList.add('success');
                    } else {
                        estimateSpan.textContent = 'Estimation Failed';
                        estimateSpan.classList.add('error');
                        estimateSpan.title = result.message || 'The estimation API call failed.';
                    }
                    return result; // IMPORTANT: Return the result for the final count
                });
        });

        // Once all initial estimates are done, enable the proceed button
        Promise.allSettled(estimatePromises).then((promiseResults) => {
            let totalEstimated = 0;
            let anyFailures = false;

            promiseResults.forEach(promiseResult => {
                // promiseResult is an object like {status: 'fulfilled', value: ...}
                if (promiseResult.status === 'fulfilled' && promiseResult.value.success) {
                    totalEstimated += promiseResult.value.estimated_actionable_files;
                } else {
                    anyFailures = true;
                }
            });

            let summaryText = `Total estimated impact: ~${totalEstimated} files.`;
            if (anyFailures) {
                summaryText += " (Some estimations failed)";
            }
            impactEl.textContent = summaryText;
            proceedButton.disabled = false;
        });
    });
}

/**
 * Creates a user-friendly string for the impact estimate.
 * @param {Object} rule - The rule object (not strictly needed but good for context).
 * @param {number} count - The estimated number of files to be affected.
 * @returns {string} - The formatted message.
 */
function generateImpactMessage(rule, count) {
    if (typeof count !== 'number' || count < 0) {
        return 'Invalid Count';
    }
    return `Affects ~${count} file${count !== 1 ? 's' : ''}`;
}

/**
 * Shows the manual run modal, populates it with rules, fetches impact estimates,
 * and returns a promise that resolves with the user's choices.

/**
 * Executes a rule manually after user confirmation via the new modal.
 * @param {string} ruleId - The ID of the rule to run.
 * @param {string} ruleName - The name of the rule (for notifications).
 */
export async function runRule(ruleId, ruleName) {
    console.log("Attempting to run rule:", ruleName);
    const rule = currentlyLoadedRules.find(r => r.id === ruleId);
    if (!rule) {
        alert(`Error: Rule "${ruleName}" not found.`);
        return;
    }

    // This helper function contains the logic to execute the rule and show the summary.
    // It's defined here to avoid code duplication in the if/else block below.
    const executeAndSummarize = async (options) => {
        try {
            const result = await runRuleApi(ruleId, options);
            console.log("Rule execution finished, API result:", result);

            // Check the specific setting for showing the post-run summary modal
            if (clientShowRunSummaryNotificationsSetting) {
                if (result.success) {
                    let summary_lines;

                    if (result.files_matched_by_search === 0) {
                        summary_lines = ['Completed. No files matched the search criteria.'];
                    } else {
                        summary_lines = [
                            result.message,
                            '',
                            `• 🔍 Matched: ${result.files_matched_by_search ?? 0}`,
                            `• 🎯 Candidates: ${result.files_action_attempted_on ?? 0}`,
                            `• 🛡️ Skipped (Override): ${result.files_skipped_due_to_override ?? 0}`,
                            `• ✅ Succeeded: ${result.files_succeeded_count ?? 0}`
                        ];
                        const failed_count = (result.files_action_attempted_on ?? 0) - (result.files_succeeded_count ?? 0);
                        if (failed_count > 0) {
                            summary_lines.push(`• ❌ Failed: ${failed_count}`);
                        }
                    }

                    const criticalWarnings = (result.details?.translation_warnings ?? []).filter(w => w.level === 'critical');
                    if (criticalWarnings.length > 0) {
                        const criticalMessages = criticalWarnings.map(w => w.message);
                        summary_lines.push('');
                        summary_lines.push('--- ⚠️ Critical Warnings ---');
                        summary_lines.push(...criticalMessages.map(msg => `• ${msg}`));
                    }

                    summary_lines.push(`\n(Run ID: ${result.rule_execution_id_for_log?.substring(0, 8) ?? 'N/A'})`);
                    
                    const informationalNotes = (result.details?.translation_warnings ?? [])
                        .filter(w => w.level === 'info')
                        .map(w => w.message);
                    const modalTitle = `Execution Summary for "${ruleName}"`;
                    showRunSummaryModal(modalTitle, summary_lines.join('\n'), informationalNotes);
                } else {
                    console.error("Failed to execute rule:", result.message);
                    showRunSummaryModal(
                        `Execution Failed for "${ruleName}"`,
                        result.message || "An unknown error occurred.",
                        []
                    );
                }
            }
        } catch (apiError) {
            console.error("API error during rule execution:", apiError);
            // Check the specific setting for showing the post-run summary modal
            if (clientShowRunSummaryNotificationsSetting) {
                showRunSummaryModal(
                    `Execution Failed for "${ruleName}"`,
                    `An API error occurred: ${apiError.message || 'Unknown API Error'}`,
                    []
                );
            }
        }
    };

    // Check the setting for showing the PRE-RUN options modal
    if (showNotificationsSetting) {
        try {
            const options = await showManualRunModal([rule]);
            await executeAndSummarize(options);
        } catch (error) {
            console.log("Rule run cancelled by user from modal.", error.message);
        }
    } else {
        console.log("Bypassing manual run modal due to user settings. Running with default options.");
        await executeAndSummarize({});
    }
}

/**
 * Manually triggers the execution of all rules. If notifications are enabled for this
 * action, it shows a confirmation modal. Otherwise, it runs them immediately.
 */
export async function runAllRulesManual() {
    console.log("Attempting to 'Run All Rules' manually.");
    if (!currentlyLoadedRules || currentlyLoadedRules.length === 0) {
        alert("No rules are loaded to run.");
        return;
    }

    const execute = async (options) => {
        try {
            const result = await runAllRulesManualApi(options);
            console.log("'Run All Rules' finished, API result:", result);

            // Check the specific setting for showing the 'Run All' post-run summary modal
            if (clientShowRunAllSummaryNotificationsSetting) {
                let summaryMessage = result.message || `'Run All Rules' process completed.`;
                let allInformationalNotes = [];

                if (result.results_per_rule && result.results_per_rule.length > 0) {
                    const rulesWithIssues = result.results_per_rule.filter(r => !r.success);
                    if (rulesWithIssues.length > 0) {
                        summaryMessage += `\n\n--- Rules with Issues ---`;
                        rulesWithIssues.forEach(r => {
                            summaryMessage += `\n- ${r.rule_name || r.rule_id}: ${r.message || 'Failed'}`;
                        });
                    }

                    result.results_per_rule.forEach(r => {
                        if (r.success && r.details?.translation_warnings) {
                            const notes = r.details.translation_warnings
                                .filter(w => w.level === 'info')
                                .map(w => w.message);
                            if (notes.length > 0) {
                                allInformationalNotes.push(`--- Notes for ${r.rule_name} ---`);
                                allInformationalNotes.push(...notes);
                            }
                        }
                    });
                }
                
                showRunSummaryModal('Run All Rules Complete', summaryMessage, allInformationalNotes);
            }
        } catch (apiError) {
            console.error("API error during 'Run All Rules':", apiError);
            // Check the specific setting for showing the 'Run All' post-run summary modal
            if (clientShowRunAllSummaryNotificationsSetting) {
                showRunSummaryModal(
                    'Run All Rules Failed',
                    `An API error occurred: ${apiError.message || 'Unknown API Error'}`,
                    []
                );
            }
        }
    };

    // Check the setting for showing the PRE-RUN options modal for 'Run All'
    if (clientShowRunAllNotificationsSetting) {
        try {
            const options = await showManualRunModal(currentlyLoadedRules);
            await execute(options);
        } catch (error) {
            console.log("'Run All Rules' manually cancelled by user.", error.message);
        }
    } else {
        console.log("Bypassing 'Run All' modal due to user settings. Running with default options.");
        await execute({});
    }
}
/**
 * Deletes a rule after user confirmation.
 * This function no longer handles UI updates; it only performs the delete action
 * and returns the result, letting the calling module refresh the UI.
 * @param {string} ruleId - The ID of the rule to delete.
 * @returns {Promise<object>} A promise that resolves with the result object from the API call, or a "cancelled" status.
 */
export async function deleteRule(ruleId) {
    console.log("Attempting to delete rule with ID:", ruleId);
    const ruleToDelete = currentlyLoadedRules.find(rule => rule.id === ruleId);
    // Use a generic but clear name for the confirmation dialog
    const ruleName = ruleToDelete ? `"${ruleToDelete.name}"` : `this rule`;

    if (confirm(`Are you sure you want to permanently delete the rule ${ruleName}? This cannot be undone.`)) {
        try {
            const result = await deleteRuleApi(ruleId);
            if (result.success) {
                console.log("Rule deleted successfully via API:", result);
            } else {
                console.error("Failed to delete rule:", result.message);
                alert(`Failed to delete rule: ${result.message || "An unknown error occurred."}`);
            }
            return result; // Return the API result to the caller
        } catch (error) {
            console.error("A critical error occurred while trying to delete a rule:", error);
            alert(`An unexpected error occurred: ${error.message}`);
            return { success: false, message: "A client-side error occurred." };
        }
    } else {
        console.log("Rule deletion cancelled by user.");
        return { success: false, message: "Deletion cancelled by user." };
    }
}