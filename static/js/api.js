// State variables to cache data
export let availableServices = [];
export let availableFileServices = [];
export let availableRatingServices = [];
export let availableTagServices = [];
export let currentlyLoadedRules = [];
export let showNotificationsSetting = true;
export let clientShowRunAllNotificationsSetting = true;
export let clientShowRunSummaryNotificationsSetting = true;
export let clientShowRunAllSummaryNotificationsSetting = true;


/**
 * Fetches client-side settings from the backend.
 */
export async function fetchClientSettings() {
    console.log("Fetching client settings...");
    try {
        const response = await fetch('/get_client_settings');
        if (!response.ok) {
            console.warn(`Failed to fetch client settings (HTTP ${response.status}). Using defaults.`);
            showNotificationsSetting = true;
            clientShowRunAllNotificationsSetting = true; // Default on HTTP error
            return;
        }
        const data = await response.json();

        if (data.success && data.settings) {
            showNotificationsSetting = data.settings.show_run_notifications;
            clientShowRunAllNotificationsSetting = typeof data.settings.show_run_all_notifications === 'boolean' ? data.settings.show_run_all_notifications : true;
            clientShowRunSummaryNotificationsSetting = typeof data.settings.show_run_summary_notifications === 'boolean' ? data.settings.show_run_summary_notifications : true;
            clientShowRunAllSummaryNotificationsSetting = typeof data.settings.show_run_all_summary_notifications === 'boolean' ? data.settings.show_run_all_summary_notifications : true;

            console.log("Fetched show_run_notifications setting:", showNotificationsSetting);
            console.log("Fetched show_run_all_notifications setting:", clientShowRunAllNotificationsSetting);
            console.log("Fetched show_run_summary_notifications setting:", clientShowRunSummaryNotificationsSetting);
            console.log("Fetched show_run_all_summary_notifications setting:", clientShowRunAllSummaryNotificationsSetting);
        } else {
            console.warn("Failed to fetch client settings, using defaults:", data.message || "Unknown error");
            showNotificationsSetting = true;
            clientShowRunAllNotificationsSetting = true;
            clientShowRunSummaryNotificationsSetting = true;
            clientShowRunAllSummaryNotificationsSetting = true;
        }
    } catch (error) {
        console.error("Error fetching client settings, using defaults:", error);
        showNotificationsSetting = true;
        clientShowRunAllNotificationsSetting = true;
        clientShowRunSummaryNotificationsSetting = true;
        clientShowRunAllSummaryNotificationsSetting = true;
    }
}

/**
 * Fetches all services from the backend (which caches them from Hydrus API).
 * @param {boolean} [userInitiated=false] - True if triggered by user click.
 * @returns {Promise<Object>} A promise resolving to an object indicating success/failure.
 */
export async function fetchAllServices(userInitiated = false) {
    console.log("Fetching all services...");
    const updateServicesButton = document.getElementById('update-services-button');

    if (userInitiated && updateServicesButton) {
        updateServicesButton.disabled = true;
        updateServicesButton.textContent = 'Updating...';
        document.body.classList.add('loading-cursor');
    }

    try {
        const response = await fetch('/get_all_services');
        let data;
        try {
            data = await response.json();
        } catch (jsonError) {
            console.error("Error parsing JSON response from /get_all_services:", jsonError);
            if (!response.ok) {
                data = { success: false, message: `Failed to fetch services. HTTP Status: ${response.status} ${response.statusText}. Response was not valid JSON.` , services: []};
            } else {
                data = { success: false, message: `Received OK response for /get_all_services, but content was not valid JSON.`, services: [] };
            }
        }


        if (response.ok && data.success) {
            availableServices = data.services || [];
            console.log("Fetched all services:", availableServices);

            availableFileServices = availableServices.filter(service => service.type === 2);
            availableRatingServices = availableServices.filter(service =>
                service.type === 6 || service.type === 7 || service.type === 22
            );
            availableTagServices = availableServices.filter(service => service.type === 5);

            console.log(`Filtered: ${availableFileServices.length} file services, ${availableRatingServices.length} rating services, ${availableTagServices.length} tag services.`);

            if (userInitiated && updateServicesButton) {
                updateServicesButton.textContent = 'Services Updated';
                setTimeout(() => {
                    if (updateServicesButton.textContent === 'Services Updated') {
                        updateServicesButton.textContent = 'Update Services List';
                    }
                }, 2000);
            }
            return { success: true, services: availableServices };
        } else {
            const errorMessage = data.message || `Failed to fetch services. HTTP Status: ${response.status} ${response.statusText}`;
            console.error("Failed to fetch all services:", errorMessage);
            if (userInitiated && updateServicesButton) {
                updateServicesButton.textContent = 'Update Failed';
                 setTimeout(() => {
                     if (updateServicesButton.textContent === 'Update Failed') {
                         updateServicesButton.textContent = 'Update Services List';
                     }
                 }, 3000);
            }
            availableServices = [];
            availableFileServices = [];
            availableRatingServices = [];
            availableTagServices = [];
            return { success: false, message: errorMessage, services: [] };
        }
    } catch (error)
    {
        console.error("Network or other error fetching all services:", error);
        if (userInitiated && updateServicesButton) {
            updateServicesButton.textContent = 'Update Failed (Network)';
             setTimeout(() => {
                 if (updateServicesButton.textContent === 'Update Failed (Network)') {
                    updateServicesButton.textContent = 'Update Services List';
                 }
             }, 3000);
        }
        availableServices = [];
        availableFileServices = [];
        availableRatingServices = [];
        availableTagServices = [];
        return { success: false, message: `Network error or other issue: ${error.message}`, services: [] };
    } finally {
        if (userInitiated && updateServicesButton) {
            updateServicesButton.disabled = false;
            document.body.classList.remove('loading-cursor');
        }
    }
}

/**
 * Fetches the application's connection status from the backend.
 * @returns {Promise<Object>} An object containing connection status and available services.
 */
export async function getStatusApi() {
    try {
        const response = await fetch('/api/v1/status');
        return await response.json();
    } catch (error) {
        // This catch handles a complete backend failure (it's not even running)
        console.error("API Error: The backend server is unreachable.", error);
        return {
            success: false,
            connection: { status: 'OFFLINE', message: 'The backend server is unreachable.' },
            services: []
        };
    }
}

/**
 * Asks the backend to attempt to reconnect to Hydrus.
 * @returns {Promise<Object>} An object containing the new connection status.
 */
export async function retryConnectionApi() {
    try {
        const response = await fetch('/api/v1/connect', { method: 'POST' });
        return await response.json();
    } catch (error) {
        console.error("API Error: The backend server is unreachable during connection retry.", error);
        return {
            success: false,
            connection: { status: 'OFFLINE', message: 'The backend server is unreachable.' },
            services: []
        };
    }
}

/**
 * Updates the globally cached list of services from outside this module.
 * This is called after a successful status or connect API call.
 * @param {Array<Object>} services - The new list of services.
 */
export function updateAvailableServices(services) {
    availableServices = services || [];
    availableFileServices = availableServices.filter(service => service.type === 2);
    availableRatingServices = availableServices.filter(service =>
        service.type === 6 || service.type === 7 || service.type === 22
    );
    availableTagServices = availableServices.filter(service => service.type === 5);
    console.log(`Updated services cache: ${availableFileServices.length} file, ${availableRatingServices.length} rating, ${availableTagServices.length} tag.`);
}

/**
 * Loads rules from the backend.
 * @returns {Promise<Object>} A promise resolving to an object with success status and rules array.
 */
export async function loadRules() {
    console.log("Loading rules...");
    try {
        const response = await fetch('/rules', { cache: 'no-store' });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to load rules (HTTP ${response.status}):`, errorText);
            currentlyLoadedRules = [];
            return { success: false, message: `Failed to load rules: HTTP ${response.status} ${response.statusText}`, rules: [] };
        }
        const data = await response.json();

        if (data.success) {
            currentlyLoadedRules = data.rules || [];
            console.log("Loaded rules:", currentlyLoadedRules);
            return { success: true, rules: currentlyLoadedRules };
        } else {
            console.error("Failed to load rules (backend error):", data.message);
            currentlyLoadedRules = [];
             return { success: false, message: data.message, rules: [] };
        }
    } catch (error) {
        console.error("Error fetching rules (network/JS error):", error);
        currentlyLoadedRules = [];
         return { success: false, message: `Error fetching rules: ${error.message}`, rules: [] };
    }
}
 
/**
 * Deletes a rule by its ID via the backend.
 * @param {string} ruleId - The ID of the rule to delete.
 * @returns {Promise<Object>} An object indicating success/failure and a message.
 */
export async function deleteRule(ruleId) {
    console.log("Deleting rule via API with ID:", ruleId);
    try {
        const response = await fetch(`/rules/${ruleId}`, {
            method: 'DELETE',
        });
        const result = await response.json();

        if (response.ok && result.success) {
            console.log("Rule deleted successfully via API:", result);
            await loadRules();
            return { success: true, message: result.message };
        } else {
            const errorMessage = result.message || (response.ok ? "Backend reported failure but HTTP status was OK." : `HTTP Error: ${response.status} ${response.statusText}`);
            console.error("Failed to delete rule via API:", errorMessage);
             return { success: false, message: errorMessage };
        }
    } catch (error) {
        console.error("Error deleting rule via API:", error);
        return { success: false, message: `An error occurred while deleting the rule: ${error.message}` };
    }
}
 
 /**
 * Saves a rule (adds or updates) to the backend.
 * @param {object} ruleData - The rule object to save.
 * @returns {Promise<Object>} An object indicating success/failure and a message.
 */
export async function saveRule(ruleData) {
    console.log("Attempting to save rule via API:", ruleData);
    try {
        const response = await fetch('/add_rule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ruleData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            console.log("Rule saved successfully via API:", result);
            await loadRules();
            return { success: true, message: result.message, rule_id: result.rule_id, rule_name: result.rule_name };
        } else {
            const errorMessage = result.message || (response.ok ? "Backend reported failure but HTTP status was OK." : `HTTP Error: ${response.status} ${response.statusText}`);
            console.error("Failed to save rule via API:", errorMessage);
             return { success: false, message: errorMessage };
        }
    } catch (error) {
        console.error("Error sending rule data to backend API:", error);
         return { success: false, message: `An error occurred while saving the rule: ${error.message}` };
    }
}


/**
 * Runs a rule by its ID via the backend.
 * @param {string} ruleId - The ID of the rule to run.
 * @param {object} [options={}] - Optional settings for the run, like override_bypass_list.
 * @returns {Promise<Object>} An object indicating success/failure and a message.
 */
export async function runRule(ruleId, options = {}) {
    console.log("Running rule via API with ID:", ruleId);
    try {
        document.body.classList.add('loading-cursor');
        const response = await fetch(`/run_rule/${ruleId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options)
        });
        const result = await response.json();
        document.body.classList.remove('loading-cursor');

        if (response.ok) {
            console.log("Rule execution request processed by API:", result);
            return { ...result };
        } else {
            const errorMessage = result.message || `Rule execution failed with HTTP Error: ${response.status} ${response.statusText}`;
            console.error("Failed to execute rule via API (HTTP error):", errorMessage);
            return { success: false, message: errorMessage, ...result };
        }
    } catch (error) {
        document.body.classList.remove('loading-cursor');
        console.error("Error executing rule via API (network/JS error):", error);
         return { success: false, message: `An error occurred while executing rule: ${error.message}` };
    }
}


/**
 * Fetches the first-run status for a list of rule IDs.
 * @param {string[]} ruleIds - Array of rule IDs to check.
 * @returns {Promise<Object>} Object with { success: Boolean, statuses: {id: boolean}, message?: String }. 'true' in statuses means it IS a first run.
 */
export async function fetchFirstRunStatusApi(ruleIds) {
    console.log("Fetching first run status for rules:", ruleIds);
     // Avoid API call if no rules are provided
     if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
        console.log("No rule IDs provided for first run status check.");
         return { success: true, statuses: {} };
     }
    try {
        const response = await fetch('/rules/first_run_status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
             // match backend expected key 'rule_ids'
            body: JSON.stringify({ rule_ids: ruleIds })
        });
        const result = await response.json();

         if (response.ok && result.success) {
            console.log("Successfully fetched first run statuses:", result.statuses);
            return result; // { success: true, statuses: {...} }
         } else {
             const errorMessage = result.message || `HTTP Error: ${response.status} ${response.statusText}`;
            console.error("Failed to fetch first run status:", errorMessage);
            return { success: false, message: errorMessage, statuses: {} };
        }
    } catch (error) {
        console.error("Error fetching first run status (network/JS):", error);
        return { success: false, message: `Network/JS error: ${error.message}`, statuses: {} };
    }
}

/**
 * Estimates the number of files a rule would affect.
 * @param {string} ruleId - The ID of the rule to estimate.
 * @param {object} [options={}] - Optional settings for the estimation.
 * @param {boolean} [options.isDeepRun=false] - If true, performs a deep run estimation for 'force_in' rules.
 * @returns {Promise<Object>} Object with { success: Boolean, estimated_file_count?: Number, message?: String }.
 */
export async function estimateRuleImpactApi(ruleId, options = {}) {
     console.log(`Estimating impact for rule ID: ${ruleId} with options:`, options);
     document.body.classList.add('loading-cursor');

    const fetchOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            deep_run: !!options.isDeepRun, // Ensure it's a boolean
            bypass_override: !!options.isBypassOverride // Ensure it's a boolean
        })
    };

    try {
        const response = await fetch(`/rules/estimate_impact/${ruleId}`, fetchOptions);
        const result = await response.json();

        // The backend response already contains { success: boolean, ...} even if the estimation itself failed.
        // We only treat HTTP or network errors as a failure of *this function*.
        if (response.ok) {
             console.log(`Estimation for ${ruleId} result:`, result);
             // Return the backend result directly which contains success status and count or message
             return result;
        } else {
             const errorMessage = result.message || `HTTP Error: ${response.status} ${response.statusText}`;
             console.error("Failed to estimate rule impact (HTTP error):", errorMessage);
             // Provide a consistent shape on client-side error
             return { success: false, message: errorMessage, estimated_actionable_files: -1 };

        }

    } catch (error) {
         console.error("Error estimating rule impact (network/JS):", error);
          // Provide a consistent shape on client-side error
         return { success: false, message: `Network/JS error: ${error.message}`, estimated_actionable_files: -1 };
    } finally {
         document.body.classList.remove('loading-cursor');
    }
}

/**
 * Runs all rules manually via the backend, respecting conflict overrides.
 * @param {object} [options={}] - Optional settings for the run, like override_bypass_list.
 * @returns {Promise<Object>} An object indicating success/failure and a comprehensive summary.
 */
export async function runAllRulesManualApi(options = {}) {
    console.log("Running all rules manually via API...");
    try {
        document.body.classList.add('loading-cursor');
        const response = await fetch(`/run_all_rules_manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options)
        });
        const result = await response.json();
        document.body.classList.remove('loading-cursor');

        if (response.ok) {
            console.log("Manual 'Run All Rules' request processed by API:", result);
            return { ...result };
        } else {
            const errorMessage = result.message || `Manual 'Run All Rules' failed with HTTP Error: ${response.status} ${response.statusText}`;
            console.error("Failed to execute 'Run All Rules' via API (HTTP error):", errorMessage);
            return { success: false, message: errorMessage, results_per_rule: [], summary_totals: {}, ...result };
        }
    } catch (error) {
        document.body.classList.remove('loading-cursor');
        console.error("Error executing 'Run All Rules' via API (network/JS error):", error);
        return {
            success: false,
            message: `An error occurred while executing 'Run All Rules': ${error.message}`,
            results_per_rule: [],
            summary_totals: {}
        };
    }
}

// --- RULE SETS API ---

/**
 * Fetches all rule sets and their associations from the backend.
 * @returns {Promise<Object>} Object with { success: Boolean, sets?: Array, associations?: Array, message?: String }.
 */
export async function fetchAllSets() {
    console.log("Fetching all rule sets...");
    try {
        const response = await fetch('/api/v1/sets', { cache: 'no-store' });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to load sets (HTTP ${response.status}):`, errorText);
            return { success: false, message: `Failed to load sets: HTTP ${response.status} ${response.statusText}`, sets: [] };
        }
        const result = await response.json();

        if (result.success) {
            console.log("Successfully fetched sets data:", result.data);
            // The backend returns { success: true, data: { sets: [], associations: [] } }
            // The UI expects `result.sets`. We provide both sets and associations for flexibility.
            return { success: true, sets: result.data.sets || [], associations: result.data.associations || [] };
        } else {
            console.error("Failed to load sets (backend error):", result.message);
            return { success: false, message: result.message, sets: [] };
        }
    } catch (error) {
        console.error("Error fetching sets (network/JS error):", error);
        return { success: false, message: `Error fetching sets: ${error.message}`, sets: [] };
    }
}
/**
 * Saves the entire set configuration to the backend.
 * @param {Array<Object>} setConfigurationList - An array of set objects, where each contains its details and associations.
 * @returns {Promise<Object>} An object indicating success/failure and a message.
 */
export async function saveSetConfiguration(setConfigurationList) {
    console.log("Saving entire set configuration via API:", setConfigurationList);
    try {
        const response = await fetch('/api/v1/sets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(setConfigurationList)
        });

        const result = await response.json();

        // Handle non-OK responses (e.g., 400, 500)
        if (!response.ok) {
            const errorMessage = result.message || `An unknown backend error occurred (HTTP ${response.status}).`;
            console.error("Failed to save set configuration:", errorMessage);
            return { success: false, message: `Save Failed: ${errorMessage}` };
        }

        // Handle OK responses where the backend operation might have still failed
        if (result.success) {
            console.log("Set configuration saved successfully.");
            return { success: true, message: result.message };
        } else {
            return { success: false, message: result.message || "An unknown error occurred." };
        }
    } catch (error) {
        console.error("Network/JS error saving set configuration:", error);
        return { success: false, message: `A client-side error occurred: ${error.message}` };
    }
}

/**
 * Deletes a set by its ID via the backend.
 * @param {string} setId - The ID of the set to delete.
 * @returns {Promise<Object>} An object indicating success/failure and a message.
 */
export async function deleteSet(setId) {
    console.log(`Deleting set ${setId} via API.`);
    try {
        const response = await fetch(`/api/v1/sets/${setId}`, {
            method: 'DELETE',
        });
        const result = await response.json();

        if (response.ok && result.success) {
            return { success: true, message: result.message };
        } else {
            const errorMessage = result.message || `An unknown error occurred (HTTP ${response.status}).`;
            console.error(`Failed to delete set: ${errorMessage}`);
            return { success: false, message: errorMessage };
        }
    } catch (error) {
        console.error(`Network or JS error while deleting set:`, error);
        return { success: false, message: `A client-side error occurred: ${error.message}` };
    }
}



/**
 * Removes a rule's association from a specific set.
 * @param {string} ruleId - The ID of the rule to disassociate.
 * @param {string} setId - The ID of the set from which to remove the rule.
 * @returns {Promise<Object>} An object indicating success/failure and a message.
 */
export async function removeRuleFromSet(ruleId, setId) {
    console.log(`Attempting to remove rule ${ruleId} from set ${setId} via API.`);
    try {
        const response = await fetch(`/api/v1/sets/${setId}/rules/${ruleId}`, {
            method: 'DELETE',
        });

        // Try to parse JSON, but handle non-JSON responses gracefully
        let result;
        try {
            result = await response.json();
        } catch (e) {
            // If response was OK but not JSON (like a 204 No Content), create a success object
            if (response.ok) {
                return { success: true, message: "Rule successfully removed from set." };
            }
            // If response was not OK and not JSON, create an error object
            result = { success: false, message: `Server returned non-JSON response with status ${response.status} ${response.statusText}` };
        }

        if (response.ok && result.success) {
            console.log(`Rule ${ruleId} successfully removed from set ${setId}.`);
            return { success: true, message: result.message };
        } else {
            const errorMessage = result.message || `An unknown error occurred (HTTP ${response.status}).`;
            console.error(`Failed to remove rule from set: ${errorMessage}`);
            return { success: false, message: errorMessage };
        }

    } catch (error) {
        console.error(`Network or JS error while removing rule from set:`, error);
        return { success: false, message: `A client-side error occurred: ${error.message}` };
    }
}

/**
 * Runs a set by its ID via the backend.
 * @param {string} setId - The ID of the set to run.
 * @param {object} [options={}] - Optional settings for the run, like override_bypass_list.
 * @returns {Promise<Object>} An object indicating success/failure and a summary message.
 */
export async function runSet(setId, options = {}) {
    console.log(`Running set via API with ID: ${setId}`);
    try {
        document.body.classList.add('loading-cursor');
        const response = await fetch(`/api/v1/run_set/${setId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options)
        });
        const result = await response.json();
        document.body.classList.remove('loading-cursor');

        if (response.ok) {
            console.log("Set execution request processed by API:", result);
            return result; // The result already has success, message, etc.
        } else {
            const errorMessage = result.message || `Set execution failed with HTTP Error: ${response.status} ${response.statusText}`;
            console.error("Failed to execute set via API (HTTP error):", errorMessage);
            return { success: false, message: errorMessage, ...result };
        }
    } catch (error) {
        document.body.classList.remove('loading-cursor');
        console.error("Error executing set via API (network/JS error):", error);
        return { success: false, message: `An error occurred while executing set: ${error.message}` };
    }
}


/**
 * Fetches statistics for files processed per rule within a given time frame.
 * @param {string} timeFrame - Predefined time frame (e.g., '24h', '1w', 'custom').
 * @param {string} [startDate] - ISO date string for custom start date (YYYY-MM-DD or full ISO).
 * @param {string} [endDate] - ISO date string for custom end date (YYYY-MM-DD or full ISO).
 * @returns {Promise<Object>} Object with { success: Boolean, data: Array, message?: String, time_frame_used?: String, start_date_used?: String, end_date_used?: String }.
 */
export async function getLogStats(timeFrame, startDate, endDate) {
    console.log(`Fetching log stats. TimeFrame: ${timeFrame}, Start: ${startDate}, End: ${endDate}`);
    const params = new URLSearchParams();
    params.append('time_frame', timeFrame);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    try {
        // Use the new API endpoint
        const response = await fetch(`/api/v1/logs/stats?${params.toString()}`);
        const result = await response.json();

        if (response.ok && result.success) {
            console.log("Successfully fetched log stats:", result);
            return result;
        } else {
            const errorMessage = result.message || `HTTP Error: ${response.status} ${response.statusText}`;
            console.error("Failed to fetch log stats:", errorMessage);
            return { success: false, message: errorMessage, data: [] };
        }
    } catch (error) {
        console.error("Error fetching log stats (network/JS):", error);
        return { success: false, message: `Network/JS error: ${error.message}`, data: [] };
    }
}

/**
 * Searches detailed logs based on various parameters.
 * @param {Object} searchParams - An object containing search parameters.
 *   Expected keys: file_hash, rule_id, run_id, rule_execution_id, status_filter,
 *                  time_frame, start_date, end_date, limit, offset, sort_by.
 * @returns {Promise<Object>} Object with { success: Boolean, logs: Array, total_records: Number, message?: String, ...other_meta }.
 */
export async function searchRuns(searchParams) {
    console.log("Searching run logs with params:", searchParams);
    const params = new URLSearchParams();
    for (const key in searchParams) {
        if (searchParams[key] !== undefined && searchParams[key] !== null && searchParams[key] !== '') {
            params.append(key, searchParams[key]);
        }
    }

    try {
        // Use the new API endpoint
        const response = await fetch(`/api/v1/logs/search_runs?${params.toString()}`);
        const result = await response.json();

        if (response.ok && result.success) {
            console.log("Successfully searched run logs:", result);
            return result;
        } else {
            const errorMessage = result.message || `HTTP Error: ${response.status} ${response.statusText}`;
            console.error("Failed to search run logs:", errorMessage);
            return { success: false, message: errorMessage, logs: [], total_records: 0 };
        }
    } catch (error) {
        console.error("Error searching run logs (network/JS):", error);
        return { success: false, message: `Network/JS error: ${error.message}`, logs: [], total_records: 0 };
    }
}

/**
 * Fetches comprehensive information for a single rule.
 * @param {string} ruleId - The UUID of the rule to look up.
 * @returns {Promise<Object>} Object with { success: Boolean, data?: Object, message?: String }.
 */
export async function lookupRuleInfo(ruleId) {
    console.log(`Looking up info for rule ID: ${ruleId}`);
    try {
        const response = await fetch(`/api/v1/logs/lookup/rule/${encodeURIComponent(ruleId)}`);
        const result = await response.json();

        if (response.ok && result.success) {
            return result;
        } else {
            const errorMessage = result.message || `HTTP Error: ${response.status} ${response.statusText}`;
            console.error(`Failed to lookup rule info for ${ruleId}:`, errorMessage);
            return { success: false, message: errorMessage };
        }
    } catch (error) {
        console.error(`Error during rule info lookup for ${ruleId} (network/JS):`, error);
        return { success: false, message: `Network/JS error: ${error.message}` };
    }
}

/**
 * Fetches the state and event history for a single file.
 * @param {string} fileHash - The SHA256 hash of the file to look up.
 * @returns {Promise<Object>} Object with { success: Boolean, data?: Object, message?: String }.
 */
export async function lookupFileInfo(fileHash) {
    console.log(`Looking up info for file hash: ${fileHash}`);
    try {
        const response = await fetch(`/api/v1/logs/lookup/file/${encodeURIComponent(fileHash)}`);
        const result = await response.json();

        if (response.ok && result.success) {
            return result;
        } else {
            const errorMessage = result.message || `HTTP Error: ${response.status} ${response.statusText}`;
            console.error(`Failed to lookup file info for ${fileHash}:`, errorMessage);
            return { success: false, message: errorMessage };
        }
    } catch (error) {
        console.error(`Error during file info lookup for ${fileHash} (network/JS):`, error);
        return { success: false, message: `Network/JS error: ${error.message}` };
    }
}