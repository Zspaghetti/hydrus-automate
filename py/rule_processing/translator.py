# rule_processing/translator.py
"""
Handles the translation of Butler rule conditions into Hydrus API search predicates.

This module is responsible for interpreting the structured rule object and converting
it into the specific list of strings and lists-of-strings (for OR groups) that the
Hydrus client API expects for file searches. It also generates warnings for any
misconfigurations or ambiguities found during the translation process.
"""

import logging
from typing import List, Tuple, Dict, Any, Union

# Since this module will be part of a package, we use a relative import
from .context import RuleExecutionContext

logger = logging.getLogger(__name__)


def is_critical_warning(warning_message: str) -> bool:
    """Determines if a translation warning is critical, meaning it would make a rule unsafe to run."""
    msg_lower = warning_message.lower()
    if "note:" in msg_lower and not "critical note:" in msg_lower: # Allow "Critical Note:"
        return False
    # Check for explicit "CRITICAL Warning:" or "CRITICAL:" prefix first
    if msg_lower.startswith("critical warning:") or msg_lower.startswith("critical:"):
        return True
    critical_phrases = [
        "skipping condition", "unhandled condition", "invalid value", "malformed 'file_service' condition",
        "not found for condition", "missing", "error translating", "unsupported operator for", "unknown specific url type",
        "target all files" # Added for empty predicate checks
    ]
    return any(phrase in msg_lower for phrase in critical_phrases)


def prepare_sequential_searches_if_needed(hydrus_predicates: list, min_to_split: int = 3) -> List[list]:
    """
    Identifies an OR-group with many file service conditions and prepares it for sequential searching.

    If an OR-group contains `min_to_split` or more file service predicates, this
    function will deconstruct the query. It creates a separate, complete search query
    for each of those file service predicates, combining it with all other static and
    common conditions. This turns one large, inefficient OR search into multiple
    smaller, efficient AND searches.

    Args:
        hydrus_predicates (list): The list of predicates from the translator.
        min_to_split (int): The minimum number of file service predicates required to trigger sequential searches.

    Returns:
        list: A list of predicate sets. If splitting occurs, it will contain multiple
              predicate sets, each for a separate API call. If not, it will contain
              a single list with the original predicates.
    """
    def is_file_service_predicate(p):
        return isinstance(p, str) and (
            p.startswith("system:file service currently in ") or
            p.startswith("system:file service is not currently in ")
        )

    candidate_group_info = None

    # 1. Find a single, valid candidate OR-group for sequential processing
    for i, pred_group in enumerate(hydrus_predicates):
        if isinstance(pred_group, list):
            file_service_pred_count = sum(1 for p in pred_group if is_file_service_predicate(p))

            if file_service_pred_count >= min_to_split:
                if candidate_group_info is not None:
                    # Found a second splittable group, which is too complex. Abort.
                    return [hydrus_predicates] # Return original predicates wrapped in a list
                candidate_group_info = {'group': pred_group, 'index': i}

    if candidate_group_info is None:
        # No group found that meets the criteria. Return the original single query.
        return [hydrus_predicates]

    splittable_group = candidate_group_info['group']
    splittable_group_index = candidate_group_info['index']

    # 2. Separate all predicates
    static_preds_outside_or_group = [p for i, p in enumerate(hydrus_predicates) if i != splittable_group_index]
    
    common_preds_in_or_group = []
    file_service_preds_for_sequencing = []
    for p in splittable_group:
        if is_file_service_predicate(p):
            file_service_preds_for_sequencing.append(p)
        else:
            common_preds_in_or_group.append(p)
    
    # 3. Reconstruct a list of full, sequential search queries
    list_of_sequential_searches = []
    base_predicates = static_preds_outside_or_group + common_preds_in_or_group

    for file_service_pred in file_service_preds_for_sequencing:
        # Each new search is the base query PLUS one of the file service predicates
        new_search_query = base_predicates + [file_service_pred]
        list_of_sequential_searches.append(new_search_query)

    return list_of_sequential_searches


def translate_rule_to_hydrus_predicates(
    ctx: RuleExecutionContext,
    force_in_special_check: bool = False
) -> Tuple[List[Union[str, List[str]]], List[Dict[str, str]]]:
    """
    Translates rule conditions into Hydrus API search predicates.

    This is the main translation function. It processes conditions from the rule,
    including implicit predicates derived from the rule's action, and converts them
    into a format suitable for the Hydrus API file search endpoint.

    Args:
        ctx: The RuleExecutionContext containing the rule, services, and config.
        force_in_special_check: A flag for a special 'force_in' mode used by the
                                override system to find all files to be deleted.

    Returns:
        A tuple containing:
        - A list of Hydrus search predicates.
        - A list of translation warning objects, each with 'level' and 'message' keys.
    """
    rule_conditions_list = ctx.rule.get('conditions', [])
    rule_action_obj = ctx.action
    available_services_list = ctx.available_services
    rule_name_for_log = ctx.rule_name

    string_predicates = []
    translation_warnings = []
    limit_predicate_to_add = None # Variable to store the single valid limit predicate

    def get_service_details(service_key):
        if not isinstance(available_services_list, list):
            logger.critical(f"Rule '{rule_name_for_log}': available_services_list not a list in get_service_details. This is a program flow error.")
            return None
        return next((s for s in available_services_list if isinstance(s, dict) and s.get('service_key') == service_key), None)

    def translate_single_condition_inner(condition, warnings_list_ref):
        # Translates individual conditions (tags, rating, file_service, etc.)
        # into Hydrus predicate strings.
        condition_type = condition.get('type')
        url_subtype = condition.get('url_subtype')
        specific_url_type = condition.get('specific_type')
        operator = condition.get('operator')
        value = condition.get('value')
        condition_service_key = condition.get('service_key') # This is for 'rating' type
        unit = condition.get('unit')

        predicate_string = None
        warning_msg = None

        try:
            if condition_type == 'tags' and operator == 'search_terms' and isinstance(value, list):
                if value:
                    return value # Returns a list of tags, not a single predicate string
                else:
                    warning_msg = f"Warning: Empty tags list in condition. Skipping condition."

            elif condition_type == 'rating' and condition_service_key and operator:
                service_info = get_service_details(condition_service_key)
                if not service_info:
                    warning_msg = f"Warning: Rating service with key {condition_service_key} not found. Skipping condition."
                else:
                    service_name = service_info['name']
                    service_type = service_info.get('type')
                    max_stars = service_info.get('max_stars')

                    if operator == 'no_rating' and value is None:
                        predicate_string = f"system:does not have a rating for {service_name}"
                    elif operator == 'has_rating' and value is None:
                        predicate_string = f"system:has a rating for {service_name}"
                    elif service_type == 7: # Like/Dislike
                        predicate_base_for_rating = f"system:rating for {service_name}"
                        if operator == 'is':
                            if isinstance(value, bool):
                                keyword = 'like' if value is True else 'dislike'
                                predicate_string = f"{predicate_base_for_rating} is {keyword}"
                            else:
                                warning_msg = f"Warning: Unsupported value type '{type(value).__name__}' for 'is' on like/dislike rating '{service_name}'. Expected boolean. Skipping condition."
                        else:
                            warning_msg = f"Warning: Unsupported operator '{operator}' for like/dislike rating '{service_name}' (excluding 'no_rating', 'has_rating'). Skipping condition."
                    elif service_type == 6: # Numerical Stars
                        predicate_base_for_rating = f"system:rating for {service_name}"
                        if isinstance(value, (int, float)):
                            numeric_value = int(value)
                            if operator == 'is':
                                predicate_string = f"{predicate_base_for_rating} = {numeric_value}"
                                if max_stars is not None and max_stars > 0: predicate_string += f"/{max_stars}"
                                else:
                                    message = f"Note: 'is {numeric_value}' for numerical rating '{service_name}' without max_stars. Standard numerical equality assumed."
                                    level = 'critical' if is_critical_warning(message) else 'info'
                                    warnings_list_ref.append({'level': level, 'message': message})
                            elif operator == 'more_than':
                                predicate_string = f"{predicate_base_for_rating} > {numeric_value}"
                                if max_stars is not None and max_stars > 0: predicate_string += f"/{max_stars}"
                            elif operator == 'less_than':
                                predicate_string = f"{predicate_base_for_rating} < {numeric_value}"
                                if max_stars is not None and max_stars > 0: predicate_string += f"/{max_stars}"
                            elif operator == '!=':
                                less_than_pred = f"{predicate_base_for_rating} < {numeric_value}"
                                more_than_pred = f"{predicate_base_for_rating} > {numeric_value}"
                                if max_stars is not None and max_stars > 0:
                                    less_than_pred += f"/{max_stars}"
                                    more_than_pred += f"/{max_stars}"
                                predicate_string = [less_than_pred, more_than_pred]
                                message = f"Note: Numerical rating '!=' for '{service_name}' translated to OR group: [{less_than_pred}, {more_than_pred}]."
                                level = 'critical' if is_critical_warning(message) else 'info'
                                warnings_list_ref.append({'level': level, 'message': message})
                            else:
                                warning_msg = f"Warning: Unsupported operator '{operator}' for numerical rating '{service_name}'. Skipping condition."
                        else:
                            warning_msg = f"Warning: Invalid value '{value}' for numerical rating '{service_name}'. Expected number. Skipping condition."
                    elif service_type == 22: # Increment/Decrement
                        predicate_base_for_rating = f"system:rating for {service_name}"
                        if isinstance(value, (int, float)):
                            numeric_value = int(value)
                            if operator == 'is': predicate_string = f"{predicate_base_for_rating} = {numeric_value}"
                            elif operator == 'more_than': predicate_string = f"{predicate_base_for_rating} > {numeric_value}"
                            elif operator == 'less_than': predicate_string = f"{predicate_base_for_rating} < {numeric_value}"
                            elif operator == '!=':
                                less_than_pred = f"{predicate_base_for_rating} < {numeric_value}"
                                more_than_pred = f"{predicate_base_for_rating} > {numeric_value}"
                                predicate_string = [less_than_pred, more_than_pred]
                                message = f"Note: Inc/dec rating '!=' for '{service_name}' translated to OR group: [{less_than_pred}, {more_than_pred}]."
                                level = 'critical' if is_critical_warning(message) else 'info'
                                warnings_list_ref.append({'level': level, 'message': message})
                            else: warning_msg = f"Warning: Unsupported operator '{operator}' for inc/dec rating '{service_name}'. Skipping condition."
                        else: warning_msg = f"Warning: Invalid value '{value}' for inc/dec rating '{service_name}'. Expected number. Skipping condition."
            elif condition_type == 'file_service':
                if value and operator in ['is_in', 'is_not_in']:
                    service_info = get_service_details(value)
                    if not service_info:
                        warning_msg = f"Warning: File service key '{value}' (from 'value' field) not found for 'file_service' condition. Skipping condition."
                    else:
                        service_name_for_predicate = service_info['name']
                        if operator == 'is_in':
                            predicate_string = f"system:file service currently in {service_name_for_predicate}"
                        else: # is_not_in
                            predicate_string = f"system:file service is not currently in {service_name_for_predicate}"
                else:
                    details_for_log = []
                    if not value: details_for_log.append("missing service key (expected in 'value' field)")
                    if operator not in ['is_in', 'is_not_in']:
                        details_for_log.append(f"unexpected operator '{operator}' (expected 'is_in' or 'is_not_in')")
                    if details_for_log:
                        warning_msg = f"Warning: Malformed 'file_service' condition ({', '.join(details_for_log)}). Skipping condition."
                    else:
                        warning_msg = f"Warning: Unhandled 'file_service' condition variant. Skipping condition."

            elif condition_type == 'filesize' and operator and value is not None and unit:
                 hydrus_operator_map = { '=': '~=', '>': '>', '<': '<', '!=': '≠' }
                 hydrus_op = hydrus_operator_map.get(operator)
                 if not hydrus_op:
                     warning_msg = f"Warning: Unsupported filesize operator '{operator}'. Using direct symbol. Skipping condition."
                 hydrus_unit_map = { 'bytes': 'B', 'KB': 'kilobytes', 'MB': 'megabytes', 'GB': 'GB'}
                 hydrus_unit_str = hydrus_unit_map.get(unit)
                 if not hydrus_unit_str:
                     warning_msg = f"Warning: Invalid filesize unit '{unit}'. Skipping condition."
                 elif warning_msg:
                     pass
                 else:
                    try:
                        size_val = float(value)
                        formatted_size_val = int(size_val) if size_val == int(size_val) else size_val
                        predicate_string = f"system:filesize {hydrus_op} {formatted_size_val} {hydrus_unit_str}"
                        if operator == '!=':
                             message = f"Note: Filesize '!=' translated to Hydrus '≠'."
                             level = 'critical' if is_critical_warning(message) else 'info'
                             warnings_list_ref.append({'level': level, 'message': message})
                    except (ValueError, TypeError) as e:
                        warning_msg = f"Warning: Invalid filesize value '{value}': {e}. Skipping condition."

            elif condition_type == 'boolean' and operator and isinstance(value, bool):
                positive_forms = {
                    'inbox': 'system:inbox', 'archive': 'system:archive',
                    'local': 'system:file service currently in all local files',
                    'trashed': 'system:file service currently in trash',
                    'deleted': 'system:is deleted',
                    'has_duration': 'system:has duration',
                    'is_the_best_quality_file_of_its_duplicate_group': 'system:is the best quality file of its duplicate group',
                    'has_audio': 'system:has audio', 'has_exif': 'system:has exif',
                    'has_embedded_metadata': 'system:has embedded metadata',
                    'has_icc_profile': 'system:has icc profile',
                    'has_tags': 'system:has tags',
                    'has_notes': 'system:has notes',
                    'has_transparency': 'system:has transparency',
                }
                negative_forms = {
                    'inbox': '-system:inbox', 'archive': '-system:archive',
                    'local': 'system:file service is not currently in all local files',
                    'trashed': 'system:file service is not currently in trash',
                    'deleted': '-system:is deleted',
                    'has_duration': 'system:no duration',
                    'is_the_best_quality_file_of_its_duplicate_group': 'system:is not the best quality file of its duplicate group',
                    'has_audio': 'system:no audio', 'has_exif': 'system:no exif',
                    'has_embedded_metadata': 'system:no embedded metadata',
                    'has_icc_profile': 'system:no icc profile',
                    'has_tags': 'system:no tags', # Hydrus synonym for 'system:untagged'
                    'has_notes': 'system:does not have notes', # Hydrus synonym for 'system:no notes'
                    'has_transparency': '-system:has transparency',
                }
                if value is True:
                    if operator in positive_forms: predicate_string = positive_forms[operator]
                    else: warning_msg = f"Warning: Boolean operator '{operator}' (for TRUE) has no direct positive mapping. Skipping."
                else: # value is False
                    if operator in negative_forms:
                        predicate_string = negative_forms[operator]
                        if operator == 'has_tags':
                            message = "Note: 'has_tags is false' mapped to 'system:no tags'. 'system:untagged' is an equivalent option."
                            level = 'critical' if is_critical_warning(message) else 'info'
                            warnings_list_ref.append({'level': level, 'message': message})
                        if operator == 'has_notes':
                             message = "Note: 'has_notes is false' mapped to 'system:does not have notes'. 'system:no notes' is an equivalent option."
                             level = 'critical' if is_critical_warning(message) else 'info'
                             warnings_list_ref.append({'level': level, 'message': message})
                    elif operator in positive_forms:
                        predicate_string = f"-{positive_forms[operator]}"
                        message = f"Note: Boolean operator '{operator}' (for FALSE) negated generically as '{predicate_string}'."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        warnings_list_ref.append({'level': level, 'message': message})
                    else: warning_msg = f"Warning: Boolean operator '{operator}' (for FALSE) has no mapping. Skipping."

            elif condition_type == 'filetype' and operator in ['is', 'is_not'] and isinstance(value, list) and value:
                 processed_values = [str(v).strip().lower() for v in value]
                 values_string = ", ".join(processed_values)
                 if operator == 'is': predicate_string = f"system:filetype = {values_string}"
                 elif operator == 'is_not':
                     predicate_string = f"system:filetype is not {values_string}"
                     if len(processed_values) > 1:
                         message = f"Note: 'filetype is not {values_string}'. Check Hydrus behavior for multiple types with 'is not'."
                         level = 'critical' if is_critical_warning(message) else 'info'
                         warnings_list_ref.append({'level': level, 'message': message})
                 else: warning_msg = f"Warning: Unexpected operator '{operator}' for filetype. Skipping."
            elif condition_type == 'filetype' and (not isinstance(value, list) or not value):
                 warning_msg = f"Warning: 'filetype' condition requires a non-empty list of values. Skipping."

            elif condition_type == 'url' and url_subtype:
                url_value_str = str(value).strip() if value is not None else None
                if url_subtype == 'specific' and specific_url_type and operator in ['is', 'is_not'] and url_value_str:
                    negation_prefix = "does not have "
                    if specific_url_type == 'regex' and operator == 'is_not': negation_prefix = "does not have a "
                    positive_verb = "has "
                    verb = positive_verb if operator == 'is' else negation_prefix
                    if specific_url_type == 'url': predicate_string = f"system:{verb}url {url_value_str}"
                    elif specific_url_type == 'domain': predicate_string = f"system:{verb}domain {url_value_str}"
                    elif specific_url_type == 'regex': predicate_string = f"system:{verb}url matching regex {url_value_str}"
                    else: warning_msg = f"Warning: Unknown specific URL type '{specific_url_type}'. Skipping."
                elif url_subtype == 'existence' and operator in ['has', 'has_not'] and value is None:
                    if operator == 'has': predicate_string = "system:has urls"
                    elif operator == 'has_not': predicate_string = "system:no urls"
                elif url_subtype == 'count' and operator and isinstance(value, int):
                    if operator == '=': predicate_string = f"system:number of urls = {value}"
                    elif operator == '>': predicate_string = f"system:number of urls > {value}"
                    elif operator == '<': predicate_string = f"system:number of urls < {value}"
                    elif operator == '!=':
                        predicate_string = [f"system:number of urls < {value}", f"system:number of urls > {value}"]
                        message = "Note: URL count '!=' translated to an OR group."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        warnings_list_ref.append({'level': level, 'message': message})
                    else: warning_msg = f"Warning: Unsupported URL count operator '{operator}'. Skipping."
                else:
                    details_msg_parts = [f"Subtype: {url_subtype or 'N/A'}"]
                    if url_subtype == 'specific': details_msg_parts.append(f"SpecificType: {specific_url_type or 'N/A'}")
                    details_msg_parts.append(f"Operator: {operator or 'N/A'}")
                    if url_subtype in ['specific', 'count']: details_msg_parts.append(f"Value: {value if value is not None else 'N/A'} (Type: {type(value).__name__})")
                    warning_msg = f"Warning: Incomplete/invalid URL condition. Details: {', '.join(details_msg_parts)}. Skipping."

            elif condition_type == 'paste_search':
                warning_msg = "Dev Error: 'paste_search' type unexpectedly reached translate_single_condition_inner."
            elif condition_type:
                warning_msg = f"Warning: Unhandled condition type '{condition_type}'. Skipping."
            else:
                warning_msg = "Warning: Condition has no type. Skipping."
        except Exception as e:
            warning_msg = f"Warning: Error translating condition '{str(condition)[:100]}...': {e}. Skipping."
            logger.error(f"Rule '{rule_name_for_log}': {warning_msg}", exc_info=True)

        if warning_msg:
            ws_ref_is_list = isinstance(warnings_list_ref, list)
            if ws_ref_is_list:
                 full_message = f"Cond (type: {condition.get('type','N/A')}, op: {condition.get('operator','N/A')}): {warning_msg}"
                 level = 'critical' if is_critical_warning(full_message) else 'info'
                 warnings_list_ref.append({'level': level, 'message': full_message})
            else:
                 logger.critical(f"Rule '{rule_name_for_log}': CRITICAL - warnings_list_ref is not a list in translate_single_condition_inner.")
        return predicate_string

    # Main loop for translate_rule_to_hydrus_predicates
    for condition_idx, condition in enumerate(rule_conditions_list):
        if not isinstance(condition, dict):
            message = f"Warning: Cond at idx {condition_idx} not dict. Skipping: {str(condition)[:100]}"
            level = 'critical' if is_critical_warning(message) else 'info'
            translation_warnings.append({'level': level, 'message': message})
            continue

        condition_type = condition.get('type')
        if condition_type == 'limit':
            try:
                val = int(condition.get('value'))
                if val > 0:
                    new_limit_pred = f"system:limit = {val}"
                    if limit_predicate_to_add is None:
                        limit_predicate_to_add = new_limit_pred
                    else:
                        message = f"Note: Multiple 'Limit' conditions found. Only the first valid one ('{limit_predicate_to_add}') will be used."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        translation_warnings.append({'level': level, 'message': message})
                else:
                    message = f"Warning: 'Limit' condition value must be a positive number, but got '{condition.get('value')}'. Ignoring."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
            except (ValueError, TypeError):
                message = f"Warning: Invalid value for 'Limit' condition: '{condition.get('value')}'. Ignoring."
                level = 'critical' if is_critical_warning(message) else 'info'
                translation_warnings.append({'level': level, 'message': message})
            continue

        if condition_type == 'or_group':
            nested_conditions_data = condition.get('conditions', [])
            if not isinstance(nested_conditions_data, list) or not nested_conditions_data:
                message = f"Warning: OR group idx {condition_idx} empty/invalid. Skipping."
                level = 'critical' if is_critical_warning(message) else 'info'
                translation_warnings.append({'level': level, 'message': message})
                continue
            nested_predicate_list = []
            for nested_cond_idx, nested_cond in enumerate(nested_conditions_data):
                if not isinstance(nested_cond, dict) or nested_cond.get('type') in ['or_group', 'paste_search']:
                    message = f"Warning: Invalid nested item in OR group (idx {condition_idx}, nested_idx {nested_cond_idx}). Skipping nested."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                    continue
                nested_res = translate_single_condition_inner(nested_cond, translation_warnings)
                if nested_res:
                    if isinstance(nested_res, list): nested_predicate_list.extend(nested_res)
                    else: nested_predicate_list.append(nested_res)
            if nested_predicate_list: string_predicates.append(nested_predicate_list)
            else:
                message = f"Warning: OR group idx {condition_idx} yielded no predicates."
                level = 'critical' if is_critical_warning(message) else 'info'
                translation_warnings.append({'level': level, 'message': message})
        elif condition_type == 'paste_search':
            raw_text = condition.get('value')
            if not isinstance(raw_text, str) or not raw_text.strip():
                message = f"Warning: 'paste_search' idx {condition_idx} empty. Skipping."
                level = 'critical' if is_critical_warning(message) else 'info'
                translation_warnings.append({'level': level, 'message': message})
                continue
            lines = raw_text.strip().split('\n')
            parsed_paste_preds = []
            for line_num, line in enumerate(lines):
                s_line = line.strip()
                if not s_line or s_line.startswith('#'): continue
                if s_line.lower().startswith('system:limit'):
                    message = f"Note: Ignored 'system:limit' in paste_search (line {line_num + 1})."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                    continue

                or_parts_raw = [p.strip() for p in s_line.split(' OR ') if p.strip()]
                transformed_or_parts = []

                malformed_is_in_prefix = "system:is currently in "
                correct_is_in_prefix = "system:file service currently in "
                malformed_is_not_in_prefix = "system:is not currently in "
                correct_is_not_in_prefix = "system:file service is not currently in "

                for part in or_parts_raw:
                    original_part = part
                    transformed_part = part

                    if part.startswith(malformed_is_in_prefix):
                        service_name_part = part[len(malformed_is_in_prefix):]
                        transformed_part = correct_is_in_prefix + service_name_part
                    elif part.startswith(malformed_is_not_in_prefix):
                        service_name_part = part[len(malformed_is_not_in_prefix):]
                        transformed_part = correct_is_not_in_prefix + service_name_part

                    if transformed_part != original_part:
                        message = f"Note (PasteSearch, Line {line_num + 1}): Auto-corrected predicate '{original_part}' to '{transformed_part}'."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        translation_warnings.append({'level': level, 'message': message})
                    transformed_or_parts.append(transformed_part)

                if len(transformed_or_parts) > 1:
                    parsed_paste_preds.append(transformed_or_parts)
                elif transformed_or_parts:
                    parsed_paste_preds.append(transformed_or_parts[0])

            if parsed_paste_preds:
                string_predicates.extend(parsed_paste_preds)
            elif raw_text.strip() and not all(l.strip().startswith('#') or not l.strip() for l in lines):
                message = f"Warning: 'paste_search' idx {condition_idx} with content yielded no usable predicates after processing."
                level = 'critical' if is_critical_warning(message) else 'info'
                translation_warnings.append({'level': level, 'message': message})
        else:
            res = translate_single_condition_inner(condition, translation_warnings)
            if res:
                if isinstance(res, list) and condition.get('type') == 'tags':
                    string_predicates.extend(res)
                elif isinstance(res, list):
                    string_predicates.append(res)
                else:
                    string_predicates.append(res)

    # Action-Based Exclusion/Inclusion Predicates
    if rule_action_obj and isinstance(rule_action_obj, dict):
        action_type = rule_action_obj.get('type')
        if action_type == 'add_to':
            dest_keys = rule_action_obj.get('destination_service_keys', [])
            if isinstance(dest_keys, str): dest_keys = [dest_keys] if dest_keys else []
            for key in dest_keys:
                if not key: continue
                info = get_service_details(key)
                if info and info.get('name'):
                    service_name_for_predicate = info['name']
                    string_predicates.append(f"system:file service is not currently in {service_name_for_predicate}")
                else:
                    message = f"Warning: Action 'add_to': service key '{key}' not found for exclusion. Skipping exclusion."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})

        elif action_type == 'force_in':
            if force_in_special_check:
                all_local_services = [s for s in available_services_list if isinstance(s, dict) and s.get('type') == 2]
                all_local_service_preds = []
                for service in all_local_services:
                    if service.get('name'):
                        all_local_service_preds.append(f"system:file service currently in {service['name']}")
                    else:
                        message = f"Warning: (ForceIn Special Check) Local service with key '{service.get('service_key')}' is missing a name and was skipped."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        translation_warnings.append({'level': level, 'message': message})

                if all_local_service_preds:
                    string_predicates.append(all_local_service_preds)
                    message = f"Note: For 'force_in' (special check mode), created a large OR group for all {len(all_local_service_preds)} local file services. This search will be split into multiple smaller API calls."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                else:
                    message = "Warning: (ForceIn Special Check) Could not find any named local file services to build the search predicate."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
            else:
                rule_dest_keys = []
                raw_dest_keys = rule_action_obj.get('destination_service_keys', [])
                if isinstance(raw_dest_keys, str):
                    if raw_dest_keys: rule_dest_keys.append(raw_dest_keys)
                elif isinstance(raw_dest_keys, list):
                    rule_dest_keys.extend([k for k in raw_dest_keys if k])

                if not rule_dest_keys:
                    message = f"Warning: Action 'force_in': No destination keys defined. Cannot generate exclusion predicate."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                else:
                    predicates_added = False
                    for key in rule_dest_keys:
                        info = get_service_details(key)
                        if info and info.get('name'):
                            service_name_for_predicate = info['name']
                            string_predicates.append(f"system:file service is not currently in {service_name_for_predicate}")
                            predicates_added = True
                        else:
                            message = f"Warning: Action 'force_in': destination service key '{key}' not found. Cannot add exclusion predicate for it."
                            level = 'critical' if is_critical_warning(message) else 'info'
                            translation_warnings.append({'level': level, 'message': message})
                    
                    if predicates_added:
                        message = f"Note: For 'force_in', predicates were added to find files that are not in the destination service(s)."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        translation_warnings.append({'level': level, 'message': message})

        elif action_type == 'add_tags':
            tag_key_from_action = rule_action_obj.get('tag_service_key')
            tags_to_process = rule_action_obj.get('tags_to_process', [])
            if tag_key_from_action and tags_to_process:
                for tag_str in tags_to_process:
                    clean_tag = tag_str.strip()
                    if clean_tag: string_predicates.append(f"-{clean_tag}")

                relevant_note_exists = any(
                    ("predicates for 'add_tags'" in w['message'] and f"targeting service '{tag_key_from_action}'" in w['message'] and "evaluated against 'all known tags'" in w['message']) or
                    ("evaluated against 'all known tags'" in w['message'] and "'add_tags'" in w['message'] and f"targeting service '{tag_key_from_action}'" in w['message'])
                    for w in translation_warnings
                )
                if not relevant_note_exists:
                    message = (
                        f"Note: For 'add_tags' action targeting service '{tag_key_from_action}', "
                        f"implicit search predicates (e.g., for tag absence) will be evaluated "
                        f"against 'all known tags' (Hydrus default)."
                    )
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
            else:
                if not tag_key_from_action:
                    message = "Warning: Action 'add_tags': missing 'tag_service_key'. Skipping generation of implicit exclusion predicates."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                if not tags_to_process:
                    message = "Note: Action 'add_tags': 'tags_to_process' is empty. No implicit exclusion predicates generated."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})

        elif action_type == 'remove_tags':
            tag_key_from_action = rule_action_obj.get('tag_service_key')
            tags_to_process = rule_action_obj.get('tags_to_process', [])
            if tag_key_from_action and tags_to_process:
                for tag_str in tags_to_process:
                    clean_tag = tag_str.strip()
                    if clean_tag: string_predicates.append(clean_tag)

                relevant_note_exists = any(
                    ("predicates for 'remove_tags'" in w['message'] and f"targeting service '{tag_key_from_action}'" in w['message'] and "evaluated against 'all known tags'" in w['message']) or
                    ("evaluated against 'all known tags'" in w['message'] and "'remove_tags'" in w['message'] and f"targeting service '{tag_key_from_action}'" in w['message'])
                    for w in translation_warnings
                )
                if not relevant_note_exists:
                     message = (
                         f"Note: For 'remove_tags' action targeting service '{tag_key_from_action}', "
                         f"implicit search predicates (e.g., for tag presence) will be evaluated "
                         f"against 'all known tags' (Hydrus default)."
                     )
                     level = 'critical' if is_critical_warning(message) else 'info'
                     translation_warnings.append({'level': level, 'message': message})
            else:
                if not tag_key_from_action:
                    message = "Warning: Action 'remove_tags': missing 'tag_service_key'. Skipping generation of implicit inclusion predicates."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                if not tags_to_process:
                    message = "Note: Action 'remove_tags': 'tags_to_process' is empty. No implicit inclusion predicates generated."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})

        elif action_type == 'remove_tags':
            tag_key_from_action = rule_action_obj.get('tag_service_key')
            tags_to_process = rule_action_obj.get('tags_to_process', [])
            if tag_key_from_action and tags_to_process:
                for tag_str in tags_to_process:
                    clean_tag = tag_str.strip()
                    if clean_tag: string_predicates.append(clean_tag)

                relevant_note_exists = any(
                    ("predicates for 'remove_tags'" in w and f"targeting service '{tag_key_from_action}'" in w and "evaluated against 'all known tags'" in w) or
                    ("evaluated against 'all known tags'" in w and "'remove_tags'" in w and f"targeting service '{tag_key_from_action}'" in w)
                    for w in translation_warnings
                )
                if not relevant_note_exists:
                     message = (
                         f"Note: For 'remove_tags' action targeting service '{tag_key_from_action}', "
                         f"implicit search predicates (e.g., for tag presence) will be evaluated "
                         f"against 'all known tags' (Hydrus default)."
                     )
                     level = 'critical' if is_critical_warning(message) else 'info'
                     translation_warnings.append({'level': level, 'message': message})
            else:
                if not tag_key_from_action:
                    message = "Warning: Action 'remove_tags': missing 'tag_service_key'. Skipping generation of implicit inclusion predicates."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
                if not tags_to_process:
                    message = "Note: Action 'remove_tags': 'tags_to_process' is empty. No implicit inclusion predicates generated."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})

        elif action_type == 'modify_rating':
            rating_key = rule_action_obj.get('rating_service_key')
            target_val = rule_action_obj.get('rating_value')
            info = get_service_details(rating_key)
            if info and info.get('name'):
                s_name = info['name']; s_type = info['type']; s_max_stars = info.get('max_stars')
                action_exclusion_preds = []
                if target_val is None:
                    action_exclusion_preds.append(f"system:has a rating for {s_name}")
                elif isinstance(target_val, bool):
                    if s_type == 7:
                        other_state_keyword = 'dislike' if target_val is True else 'like'
                        action_exclusion_preds.append(f"system:rating for {s_name} is {other_state_keyword}")
                        action_exclusion_preds.append(f"system:does not have a rating for {s_name}")
                    else:
                        message = f"Note: Action modify_rating (bool) for non-Like/Dislike service '{s_name}'. No specific exclusion."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        translation_warnings.append({'level': level, 'message': message})
                elif isinstance(target_val, (int, float)):
                    num_target = int(target_val)
                    if s_type == 6:
                        action_exclusion_preds.append(f"system:does not have a rating for {s_name}")
                        action_exclusion_preds.append(f"system:rating for {s_name} < {num_target}" + (f"/{s_max_stars}" if s_max_stars else ""))
                        action_exclusion_preds.append(f"system:rating for {s_name} > {num_target}" + (f"/{s_max_stars}" if s_max_stars else ""))
                    elif s_type == 22:
                        action_exclusion_preds.append(f"system:does not have a rating for {s_name}")
                        action_exclusion_preds.append(f"system:rating for {s_name} < {num_target}")
                        action_exclusion_preds.append(f"system:rating for {s_name} > {num_target}")
                    else:
                        message = f"Note: Action modify_rating (num) for non-num/incdec service '{s_name}'. No specific exclusion."
                        level = 'critical' if is_critical_warning(message) else 'info'
                        translation_warnings.append({'level': level, 'message': message})

                if action_exclusion_preds:
                    if target_val is None:
                        # For "set to no rating", we only want files that HAVE a rating.
                        string_predicates.append(f"system:has a rating for {s_name}")
                    else:
                        # For setting a specific value, we want an OR group of all other states.
                        string_predicates.append(action_exclusion_preds)
                elif not any("No specific exclusion" in w['message'] for w in translation_warnings if f"'{s_name}'" in w['message']) and target_val is not None:
                    message = f"Note: Action modify_rating for '{s_name}' to '{target_val}': No specific search exclusion predicates added. Relying on post-search override logic or Hydrus idempotency."
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})
            elif rating_key:
                 message = f"Warning: Action modify_rating: service key '{rating_key}' not found for exclusion. Skipping specific search exclusion predicates."
                 level = 'critical' if is_critical_warning(message) else 'info'
                 translation_warnings.append({'level': level, 'message': message})

    # After all predicates have been added, add a note if any were implicitly generated by an action
    action_type = rule_action_obj.get('type')
    if action_type in ['add_to', 'force_in', 'add_tags', 'remove_tags', 'modify_rating']:
        note_text = f"Note: Action '{action_type}' generated implicit predicates. Final search query: {string_predicates}"
        if not any(note_text in w['message'] for w in translation_warnings):
             level = 'critical' if is_critical_warning(note_text) else 'info'
             translation_warnings.append({'level': level, 'message': note_text})
    if limit_predicate_to_add:
        string_predicates.append(limit_predicate_to_add)

    if not string_predicates:
        has_substantive_user_conditions = False
        if rule_conditions_list:
            for c in rule_conditions_list:
                if isinstance(c, dict):
                    c_type = c.get('type')
                    if c_type == 'paste_search':
                        paste_val = c.get('value', '').strip()
                        if paste_val and not all(line.strip().startswith('#') or not line.strip() for line in paste_val.split('\n')):
                            has_substantive_user_conditions = True; break
                    elif c_type == 'or_group':
                        if c.get('conditions'): has_substantive_user_conditions = True; break
                    elif c_type and c_type != 'limit':
                        has_substantive_user_conditions = True; break

        is_critical_empty_search = False
        reason_for_critical = ""

        if has_substantive_user_conditions:
            is_critical_empty_search = True
            reason_for_critical = "Substantive user-defined conditions were specified but yielded no search terms."
        elif rule_action_obj and rule_action_obj.get('type'):
            action_type_for_msg = rule_action_obj.get('type')
            is_critical_empty_search = True
            reason_for_critical = (f"Action '{action_type_for_msg}' without any user-defined conditions, "
                                   f"and the action itself did not generate any implicit search-narrowing predicates. "
                                   f"This would target all files.")
        elif not rule_action_obj or not rule_action_obj.get('type'):
            is_critical_empty_search = True
            reason_for_critical = "Rule has no substantive conditions and no defined action. Cannot proceed."

        if is_critical_empty_search:
            message = (f"CRITICAL Warning: No Hydrus search predicates were generated. "
                       f"This rule would match ALL files. Reason: {reason_for_critical} "
                       f"Aborting rule.")

            current_critical_warnings = [w['message'] for w in translation_warnings if w['level'] == 'critical']
            if not any( ("yielded no search terms" in c_w or "yielded no usable predicates" in c_w or "target all files" in c_w) for c_w in current_critical_warnings):
                if not any(message.split(":",1)[1].strip() == c_w.split(":",1)[1].strip() for c_w in current_critical_warnings):
                    level = 'critical' if is_critical_warning(message) else 'info'
                    translation_warnings.append({'level': level, 'message': message})

        elif not translation_warnings:
             message = f"Note: No Hydrus search predicates were generated from rule conditions or action logic. Rule may not find files as expected or may not be effective."
             level = 'critical' if is_critical_warning(message) else 'info'
             translation_warnings.append({'level': level, 'message': message})

    return string_predicates, translation_warnings