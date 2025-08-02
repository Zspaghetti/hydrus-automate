import { getServiceName } from './utils.js';
import { availableServices, availableFileServices } from './api.js'; // Import service data

// --- Condition Types Definition ---
// Added 'or_group' as a new type.
// MODIFIED: Removed 'mime' and changed text for 'filetype'
// ADDED: 'paste_search' condition type
// MODIFIED: Removed 'duration', 'num_tags', 'num_views', 'viewtime'
// MODIFIED: Removed 'width', 'height'
export const conditionTypes = [
    { value: 'tags', text: 'system:tags' },
    { value: 'rating', text: 'system:rating' },
    { value: 'file_service', text: 'system:file service' },
    { value: 'filesize', text: 'system:filesize' },
    // { value: 'mime', text: 'system:filetype / mime (basic)' }, // REMOVED: Replaced by comprehensive 'filetype'
    // { value: 'time', text: 'system:time (imported/modified)' }, // Re-add if implementing this type
    // { value: 'hash', text: 'system:hash' }, // Re-add if implementing this type
    { value: 'boolean', text: 'system:inbox / archive / trashed etc.' },
    // { value: 'width', text: 'system:width' }, // REMOVED
    // { value: 'height', text: 'system:height' }, // REMOVED
    // { value: 'duration', text: 'system:duration' }, // REMOVED
    // { value: 'num_tags', text: 'system:number of tags' }, // REMOVED
    // { value: 'num_views', text: 'system:number of views' }, // REMOVED
    // { value: 'viewtime', text: 'system:viewtime' }, // REMOVED
    { value: 'url', text: 'system:url' }, // Keep 'url' as the main type
    { value: 'filetype', text: 'system:filetype' }, // MODIFIED: Simplified text
    { value: 'limit', text: 'system:limit' }, // ADDED: New Limit type
    { value: 'or_group', text: 'OR Group' }, // New OR group type
    { value: 'paste_search', text: 'Paste Search' }, // ADDED: New Paste Search type
];

// Condition types allowed *inside* an OR group (exclude 'or_group' itself)
// MODIFIED: Re-filter based on the new conditionTypes list, ensures 'paste_search' is allowed nested
export const nestedConditionTypes = conditionTypes.filter(type => type.value !== 'or_group' && type.value !== 'limit');


// --- URL Condition Subtypes ---
// Define the different kinds of URL conditions available
export const urlSubtypes = [
    { value: 'specific', text: 'Specific URL / Domain / Regex', inputs: ['specific_type_select', 'operator_select', 'value_text'] }, // Specific type needs its own selector
    { value: 'existence', text: 'Has / No URLs', inputs: ['operator_select'] }, // Operator is 'has'/'has_not'
    { value: 'count', text: 'Number of URLs', inputs: ['operator_select', 'value_number'] }, // Operator is comparison, value is number
];

// Define options for the 'specific' URL subtype selector
export const specificUrlTypes = [
    { value: 'url', text: 'Exact URL' },
    { value: 'domain', text: 'Domain' },
    { value: 'regex', text: 'Regex' },
];


// --- File Type Categories and Extensions Data ---
// Structured data for building the filetype UI and extracting data
// Updated with the comprehensive list provided
export const fileTypeCategories = [
    {
        name: 'Image',
        predicate_value: 'image', // Predicate for category itself
        extensions: ['avif', 'bitmap', 'static gif', 'heic', 'heif', 'jpeg', 'jxl', 'png', 'qoi', 'webp', 'icon', 'tiff']
    },
    {
        name: 'Animation',
        predicate_value: 'animation', // Predicate for category itself
        extensions: ['apng', 'avif sequence', 'animated gif', 'heic sequence', 'heif sequence', 'animated webp', 'ugoira']
    },
    {
        name: 'Video',
        predicate_value: 'video', // Predicate for category itself
        extensions: ['mp4', 'mpeg', 'ogv', 'quicktime', 'realvideo', 'webm', 'flv', 'matroska', 'avi', 'wmv'] // wmv added from list
    },
     {
        name: 'Audio',
        predicate_value: 'audio', // Predicate for category itself
        extensions: ['flac', 'mp3', 'm4a', 'mp4 audio', 'ogg', 'realaudio', 'wavpack', 'matroska audio', 'tta', 'wave', 'wma'] // wma added from list
     },
     {
         name: 'Application',
         predicate_value: 'application', // Predicate for category itself
         extensions: ['epub', 'doc', 'pdf', 'xls', 'ppt', 'pptx', 'xlsx', 'docx', 'flash', 'djvu', 'rtf'] // rtf added from list
     },
    {
        name: 'Image Project File',
        predicate_value: 'image project file', // Predicate for category itself
        extensions: ['clip', 'sai2', 'krita', 'procreate', 'svg', 'psd', 'xcf'] // xcf added from list
    },
    {
        name: 'Archive',
        predicate_value: 'archive', // Predicate for category itself
        extensions: ['gzip', 'cbz', 'rar', '7z', 'zip'] // zip added from list
    }
];

// Map file type category predicate_value to the category object for easy lookup
export const fileTypeCategoriesMap = fileTypeCategories.reduce((map, category) => {
     map[category.predicate_value] = category;
     return map;
}, {});

// Create a reverse map from extension to its category name(s)
export const extensionToCategoryMap = {};
fileTypeCategories.forEach(category => {
    category.extensions.forEach(ext => {
        if (!extensionToCategoryMap[ext]) {
            extensionToCategoryMap[ext] = [];
        }
        extensionToCategoryMap[ext].push(category.name);
    });
});


/**
 * Helper function to extract condition data from a single condition row element.
 * This function is recursive to handle nested OR groups.
 * @param {HTMLElement} conditionRowElement - The DOM element representing the condition row.
 * @returns {{isValid: boolean, data?: object, message?: string}} - An object containing validity, extracted data, and a message if invalid.
 */
export function extractConditionData(conditionRowElement) {
    const typeSelect = conditionRowElement.querySelector('select[name="condition-type"]');
    const optionsArea = conditionRowElement.querySelector('.options-area');
    const selectedType = typeSelect ? typeSelect.value : '';

    if (!selectedType) {
        return { isValid: false, message: "Condition type not selected." };
    }

    let conditionData = { type: selectedType };
    let isValid = true;
    let validationMessage = "";

    try {
        if (selectedType === 'tags') {
            const tagInput = optionsArea.querySelector('input[type="text"][name="tags-value"]');
            if (tagInput) {
                const tags = tagInput.value.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
                if (tags.length > 0) {
                    conditionData.value = tags;
                    conditionData.operator = 'search_terms';
                } else {
                    isValid = false; validationMessage = "Tags condition is empty.";
                }
            } else { isValid = false; validationMessage = "Tags input missing."; }

        } else if (selectedType === 'rating') {
            const ratingServiceSelect = optionsArea.querySelector('select[name="rating-service"]');
            const ratingInputsArea = optionsArea.querySelector('.rating-inputs-area');

            if (ratingServiceSelect) {
                const serviceKey = ratingServiceSelect.value;
                if (!serviceKey) {
                    isValid = false; validationMessage = "Rating condition missing service key.";
                }
                conditionData.service_key = serviceKey;

                const selectedService = availableServices.find(service => service.service_key === serviceKey);
                const serviceType = selectedService ? selectedService.type : NaN;

                if (serviceType === 7) { // Like/Dislike
                    const likeDislikeSelect = ratingInputsArea.querySelector('select[name="rating-operator"]');
                    if (likeDislikeSelect) {
                        const selectedState = likeDislikeSelect.value;
                        if (selectedState === 'is_true') { conditionData.operator = 'is'; conditionData.value = true; }
                        else if (selectedState === 'is_false') { conditionData.operator = 'is'; conditionData.value = false; }
                        else if (selectedState === 'no_rating') { conditionData.operator = 'no_rating'; conditionData.value = null; }
                        else { isValid = false; validationMessage = "Rating condition (Like/Dislike) missing state selection."; }
                    } else { isValid = false; validationMessage = "Rating condition (Like/Dislike) missing select element."; }
                } else if (serviceType === 6 || serviceType === 22) { // Numerical
                    const operatorSelect = ratingInputsArea.querySelector('select[name="rating-operator"]');
                    const valueInput = ratingInputsArea.querySelector('input[type="number"][name="rating-value"]');
                    if (operatorSelect) {
                        const operator = operatorSelect.value;
                        if (!operator) { isValid = false; validationMessage = "Rating condition (Numerical) missing operator."; }
                        conditionData.operator = operator;
                        if (operator !== 'has_rating' && operator !== 'no_rating') {
                            if (valueInput) {
                                const value = parseFloat(valueInput.value);
                                if (!isNaN(value)) { conditionData.value = value; }
                                else { isValid = false; validationMessage = "Rating condition (Numerical) missing or invalid value."; }
                            } else { isValid = false; validationMessage = "Rating condition (Numerical) missing value input."; }
                        } else { conditionData.value = null; }
                    } else { isValid = false; validationMessage = "Rating condition (Numerical) missing operator select."; }
                } else { isValid = false; validationMessage = "Rating condition has unsupported service type."; }
            } else { isValid = false; validationMessage = "Rating condition missing service select."; }

        } else if (selectedType === 'file_service') {
            const operatorSelect = optionsArea.querySelector('select[name="file-service-operator"]');
            const serviceSelect = optionsArea.querySelector('select[name="file-service-service"]');
            if (operatorSelect && serviceSelect) {
                const operator = operatorSelect.value;
                const serviceKey = serviceSelect.value;
                if (!operator || !serviceKey) { isValid = false; validationMessage = "File Service condition missing operator or service key."; }
                conditionData.operator = operator;
                conditionData.value = serviceKey;
            } else { isValid = false; validationMessage = "File Service condition missing selects."; }

        } else if (selectedType === 'filesize') {
            const operatorSelect = optionsArea.querySelector('select[name="filesize-operator"]');
            const sizeInput = optionsArea.querySelector('input[type="number"][name="filesize-value"]');
            const unitSelect = optionsArea.querySelector('select[name="filesize-unit"]');
            if (operatorSelect && sizeInput && unitSelect) {
                const operator = operatorSelect.value;
                const value = parseFloat(sizeInput.value);
                const unit = unitSelect.value;
                if (!operator) { isValid = false; validationMessage = "Filesize condition missing operator."; }
                else if (isNaN(value)) { isValid = false; validationMessage = "Filesize condition missing or invalid value."; }
                else if (!unit) { isValid = false; validationMessage = "Filesize condition missing unit."; }
                else { conditionData.operator = operator; conditionData.value = value; conditionData.unit = unit; }
            } else { isValid = false; validationMessage = "Filesize condition missing inputs/selects."; }

        } else if (selectedType === 'boolean') {
            const operatorSelect = optionsArea.querySelector('select[name="boolean-operator"]');
            const valueSelect = optionsArea.querySelector('select[name="boolean-value"]');
            if (operatorSelect && valueSelect) {
                const operator = operatorSelect.value; // This is now 'inbox', 'archive', 'has_audio', etc.
                const value = valueSelect.value === 'true'; // Converts "true"/"false" string to boolean
                if (!operator) {
                    isValid = false; validationMessage = "Boolean condition missing flag selection.";
                } else {
                    conditionData.operator = operator; // Store the direct stem, e.g., 'inbox'
                    conditionData.value = value;    // Store boolean true/false
                }
            } else { isValid = false; validationMessage = "Boolean condition missing selects."; }

        } else if (selectedType === 'url') {
            const subtypeSelect = optionsArea.querySelector('select[name="url-subtype"]');
            const selectedSubtype = subtypeSelect ? subtypeSelect.value : '';
            conditionData.url_subtype = selectedSubtype;
            if (!selectedSubtype) { isValid = false; validationMessage = `URL condition missing subtype selection.`; }
            else if (selectedSubtype === 'specific') {
                const specificTypeSelect = optionsArea.querySelector('select[name="url-specific-type"]');
                const operatorSelect = optionsArea.querySelector('select[name="url-operator"]');
                const valueInput = optionsArea.querySelector('input[type="text"][name="url-value"]');
                if (!specificTypeSelect || !specificTypeSelect.value) { isValid = false; validationMessage = `URL (Specific) condition missing specific type.`; }
                else if (!operatorSelect || !operatorSelect.value) { isValid = false; validationMessage = `URL (Specific) condition missing operator.`; }
                else if (!valueInput || valueInput.value.trim() === '') { isValid = false; validationMessage = `URL (Specific) condition missing value.`; }
                else { conditionData.specific_type = specificTypeSelect.value; conditionData.operator = operatorSelect.value; conditionData.value = valueInput.value.trim(); }
            } else if (selectedSubtype === 'existence') {
                 const operatorSelect = optionsArea.querySelector('select[name="url-operator"]');
                 if (!operatorSelect || !operatorSelect.value) { isValid = false; validationMessage = `URL (Existence) condition missing operator.`; }
                 else { conditionData.operator = operatorSelect.value; delete conditionData.value; }
            } else if (selectedSubtype === 'count') {
                const operatorSelect = optionsArea.querySelector('select[name="url-operator"]');
                const valueInput = optionsArea.querySelector('input[type="number"][name="url-value"]');
                if (!operatorSelect || !operatorSelect.value) { isValid = false; validationMessage = `URL (Count) condition missing operator.`; }
                else if (!valueInput || isNaN(parseInt(valueInput.value, 10))) { isValid = false; validationMessage = `URL (Count) condition missing or invalid number.`; }
                else { conditionData.operator = operatorSelect.value; conditionData.value = parseInt(valueInput.value, 10); }
            } else { isValid = false; validationMessage = `Unknown URL subtype '${selectedSubtype}'.`; }

        } else if (selectedType === 'filetype') {
             const operatorSelect = optionsArea.querySelector('select[name="filetype-operator"]');
             const checkedValues = [];
             optionsArea.querySelectorAll('.filetype-category-checkbox:checked').forEach(cb => checkedValues.push(cb.value));
             optionsArea.querySelectorAll('.filetype-extension-checkbox:checked').forEach(cb => checkedValues.push(cb.value));
             const uniqueCheckedValues = [...new Set(checkedValues)];
             if (!operatorSelect || !operatorSelect.value) { isValid = false; validationMessage = "Filetype condition missing operator."; }
             else if (uniqueCheckedValues.length === 0) { isValid = false; validationMessage = "Filetype condition requires selecting at least one item."; }
             else { conditionData.operator = operatorSelect.value; conditionData.value = uniqueCheckedValues; }

        } else if (selectedType === 'or_group') {
            const orGroupContainer = optionsArea.querySelector('.or-group-conditions-container');
            if (orGroupContainer) {
                const nestedConditions = [];
                let allNestedValid = true;
                let nestedValidationMessages = [];
                orGroupContainer.querySelectorAll('.condition-row').forEach(nestedRow => {
                    const nestedResult = extractConditionData(nestedRow);
                    if (nestedResult.isValid) { nestedConditions.push(nestedResult.data); }
                    else { allNestedValid = false; nestedValidationMessages.push(nestedResult.message); }
                });
                if (nestedConditions.length === 0) { isValid = false; validationMessage = "OR group must contain at least one condition."; }
                else if (!allNestedValid) { isValid = false; validationMessage = "Invalid condition(s) within OR group: " + nestedValidationMessages.join(", "); }
                else { conditionData.conditions = nestedConditions; }
            } else { isValid = false; validationMessage = "Internal Error: OR group container not found."; }

        } else if (selectedType === 'limit') {
            const limitInput = optionsArea.querySelector('input[type="number"][name="limit-value"]');
            if (limitInput) {
                const value = parseInt(limitInput.value, 10);
                if (!isNaN(value) && value > 0) {
                    conditionData.value = value;
                } else {
                    isValid = false;
                    validationMessage = "Limit condition requires a positive number.";
                }
            } else {
                isValid = false;
                validationMessage = "Limit input missing.";
            }
        } else if (selectedType === 'paste_search') {
            const pasteArea = optionsArea.querySelector('textarea[name="paste-search-value"]');
            if (pasteArea) {
                 const rawText = pasteArea.value.trim();
                 if (rawText) { conditionData.value = rawText; }
                 else { isValid = false; validationMessage = "Paste Search condition is empty."; }
            } else { isValid = false; validationMessage = "Paste Search textarea missing."; }
        } else if (selectedType) {
             isValid = false; validationMessage = `Unknown condition type '${selectedType}'.`;
        }

        if (!isValid && validationMessage === "") {
             validationMessage = `Invalid configuration for condition type '${selectedType}'.`;
        }

    } catch (e) {
        isValid = false;
        validationMessage = `Error extracting data for '${selectedType}': ${e.message}`;
        console.error(validationMessage, e);
    }

    return { isValid: isValid, data: conditionData, message: validationMessage };
}


/**
 * Helper to generate summary text for a single condition or a nested group.
 * This function is recursive for OR groups.
 * @param {object} condition - The condition data object.
 * @returns {string} A human-readable summary string.
 */
export function getConditionSummary(condition) {
    if (!condition || !condition.type) {
        return "Invalid Condition";
    }

    let summary = condition.type;

    if (condition.type === 'tags' && Array.isArray(condition.value)) {
        const tagLabel = condition.value.length === 1 ? 'Tag' : 'Tags';
        summary = `${tagLabel}: "${condition.value.join(', ')}"`;
    } else if (condition.type === 'file_service' && condition.operator && condition.value) {
        const serviceName = getServiceName(condition.value, availableFileServices);
        let operatorText = "";
        if (condition.operator === 'is_in') operatorText = "Is in";
        else if (condition.operator === 'is_not_in') operatorText = "Is not in";
        else operatorText = condition.operator;
        summary = `${operatorText} "${serviceName}"`;

    } else if (condition.type === 'rating' && condition.service_key && condition.operator) {
        const ratingService = availableServices.find(s => s.service_key === condition.service_key);
        const ratingServiceName = ratingService ? ratingService.name : condition.service_key;
        const serviceType = ratingService ? ratingService.type : NaN;
        summary = `Rating: "${ratingServiceName}"`;
        if (serviceType === 7) { // Like/Dislike
            if (condition.operator === 'is') summary += ` is ${condition.value ? 'Liked' : 'Disliked'}`;
            else if (condition.operator === 'no_rating') summary += ` has no rating`;
            else summary += ` (${condition.operator})`;
        } else if (serviceType === 6 || serviceType === 22) { // Numerical
            const opTextMap = { '>': '>', '<': '<', '=': '=', '!=': '≠', 'is': 'is', 'more_than': 'more than', 'less_than': 'less than', 'has_rating': 'has rating', 'no_rating': 'no rating' };
            const operatorText = opTextMap[condition.operator] || condition.operator;
            summary += ` (${operatorText})`;
            if (!['has_rating', 'no_rating'].includes(condition.operator) && condition.value !== undefined && condition.value !== null) {
                summary += ` ${condition.value}`;
            }
        } else {
            summary += ` (${condition.operator || 'N/A'})`;
            if (condition.value !== undefined && condition.value !== null) summary += ` ${condition.value}`;
        }
    } else if (condition.type === 'filesize' && condition.operator && condition.value !== undefined && condition.unit) {
        const operatorText = { '>': '>', '<': '<', '=': '=', '!=': '≠' }[condition.operator] || condition.operator;
        summary = `Filesize: ${operatorText} ${condition.value} ${condition.unit}`;
    } else if (condition.type === 'boolean' && typeof condition.operator === 'string' && typeof condition.value === 'boolean') {
        let concept = condition.operator.replace(/_/g, ' ');
        let mainVerb = "";
        let stateAdjective = "";
        let fullConceptPhrase = "";

        switch (condition.operator) {
            case 'inbox':
                stateAdjective = "In Inbox"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'archive':
                stateAdjective = "Archived"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'local':
                stateAdjective = "Local"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'trashed':
                stateAdjective = "Trashed"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'deleted':
                stateAdjective = "Deleted (from local services)"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'has_audio':
                concept = "Audio"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_exif':
                concept = "EXIF"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_embedded_metadata':
                concept = "Embedded Metadata"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_icc_profile':
                concept = "an ICC Profile"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_notes':
                concept = "Notes"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_tags':
                concept = "Tags"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_transparency':
                concept = "Transparency"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'has_duration':
                concept = "Duration"; mainVerb = condition.value ? "has" : "does not have"; break;
            case 'is_best_quality_duplicate': // Corrected value from form
                fullConceptPhrase = "Best Quality Duplicate"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'is_the_best_quality_file_of_its_duplicate_group': // Existing summary value
                fullConceptPhrase = "Best Quality Duplicate"; mainVerb = condition.value ? "is" : "is not"; break;
            case 'filetype_forced':
                summary = `File Filetype ${condition.value ? "is" : "is not"} Forced`;
                return summary;
            default:
                concept = concept.charAt(0).toUpperCase() + concept.slice(1);
                mainVerb = condition.value ? "is" : "is not";
                stateAdjective = concept;
                break;
        }

        if (fullConceptPhrase) {
             summary = `File ${mainVerb} ${fullConceptPhrase}`;
        } else if (stateAdjective) {
            summary = `File ${mainVerb} ${stateAdjective}`;
        } else {
            summary = `File ${mainVerb} ${concept}`;
        }

    } else if (condition.type === 'url' && condition.url_subtype) {
        if (condition.url_subtype === 'specific' && condition.specific_type && condition.operator && condition.value) {
            const subtypeText = { 'url': 'URL is', 'domain': 'domain is', 'regex': 'matches regex' }[condition.specific_type] || condition.specific_type;
            const operatorText = { 'is': '', 'is_not': 'not ' }[condition.operator] || condition.operator + ' ';
            summary = `URL (${subtypeText}): ${operatorText}"${condition.value}"`;
        } else if (condition.url_subtype === 'existence' && condition.operator) {
            const operatorText = { 'has': 'Has URLs', 'has_not': 'Has no URLs' }[condition.operator] || condition.operator;
            summary = `URL: ${operatorText}`;
        } else if (condition.url_subtype === 'count' && condition.operator && condition.value !== undefined) {
             const operatorText = { '>': '>', '<': '<', '=': '=', '!=': '≠' }[condition.operator] || condition.operator;
             summary = `URL Count: ${operatorText} ${condition.value}`;
        } else {
            summary = `URL (${condition.url_subtype}): (Not configured)`;
        }
    } else if (condition.type === 'filetype' && condition.operator && Array.isArray(condition.value) && condition.value.length > 0) {
         const operatorText = { 'is': 'is', 'is_not': 'is not' }[condition.operator] || condition.operator;
         summary = `Filetype: ${operatorText} ${condition.value.join(', ')}`;
    } else if (condition.type === 'limit' && condition.value) {
        summary = `Limit to ${condition.value} files`;
    } else if (condition.type === 'or_group' && condition.conditions && Array.isArray(condition.conditions)) {
        const nestedSummaries = condition.conditions.map(nestedC => getConditionSummary(nestedC)).join(' or ');
        summary = nestedSummaries ? nestedSummaries : `(Empty OR Group)`; // No "OR (...)" wrapper.
    } else if (condition.type === 'paste_search' && typeof condition.value === 'string') {
        const truncatedText = condition.value.length > 50 ? condition.value.substring(0, 47) + '...' : condition.value;
        // Remove "Paste Search: " prefix
        summary = `"${truncatedText.replace(/\n/g, ' ')}"`;
    } else if (condition.operator || (condition.value !== undefined && condition.value !== null) || condition.service_key || condition.unit || (condition.conditions && Array.isArray(condition.conditions)) || condition.url_subtype) {
         // Exclude types that form their own complete summaries without needing a type prefix
         if (!['boolean', 'file_service', 'paste_search'].includes(condition.type)) {
             summary = `${condition.type}: (Partially configured)`;
         }
    } else {
        // Exclude types that form their own complete summaries
        if (!['boolean', 'file_service', 'paste_search'].includes(condition.type)) {
            summary = `${condition.type}: (Not configured)`;
        }
    }
    return summary;
}