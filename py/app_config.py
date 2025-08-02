import os
import json
import secrets
import logging
import database

# from functools import cmp_to_key # No longer needed

# Configure logging (can be more sophisticated later if needed)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SETTINGS_FILE = os.path.join(BASE_DIR, 'settings.json')
RULES_FILE = os.path.join(BASE_DIR, 'rules.json')

DEFAULT_SETTINGS = {
    'api_address': 'http://localhost:45869',
    'api_key': '',
    'rule_interval_seconds': 0,
    'last_viewed_threshold_seconds': 0,
    'secret_key': None,
    'show_run_notifications': True,
    'show_run_all_notifications': True,
    'show_run_summary_notifications': True,
    'show_run_all_summary_notifications': True,
    'theme': 'modern_Default',
    'available_themes': ['modern_Default'],
    'background_image': 'Plexus',
    'available_backgrounds': [],
    'butler_name': 'Hydrus Automate',
    'log_overridden_actions': False,
    'force_in_run_on_startup': True,
    'force_in_run_on_all_local': False,
    'force_in_periodic_run_frequency': 0,
    'enable_log_pruning': True
}


def _discover_themes():
    """Scans for available themes in the static/css directory."""
    available_themes_discovered = []
    themes_dir = os.path.join(BASE_DIR, 'static', 'css')
    if os.path.exists(themes_dir) and os.path.isdir(themes_dir):
        for filename in os.listdir(themes_dir):
            if filename.endswith('.css'):
                theme_name = filename[:-4]
                available_themes_discovered.append(theme_name)
        if not available_themes_discovered:
            available_themes_discovered.append('modern_Default') # Fallback if no CSS found
            logger.warning(f"No CSS files found in {themes_dir}. Defaulting to 'available_themes': ['modern_Default'].")
    else:
        logger.warning(f"Themes directory {themes_dir} not found. Defaulting to 'available_themes': ['modern_Default'].")
        available_themes_discovered.append('modern_Default')
    return sorted(list(set(available_themes_discovered)))


def _discover_backgrounds():
    """Scans for available background images in the static/images/backgrounds directory."""
    available_backgrounds = []
    backgrounds_dir = os.path.join(BASE_DIR, 'static', 'images', 'backgrounds')
    if os.path.exists(backgrounds_dir) and os.path.isdir(backgrounds_dir):
        supported_extensions = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
        for filename in os.listdir(backgrounds_dir):
            if filename.lower().endswith(supported_extensions):
                available_backgrounds.append(filename)
    else:
        logger.warning(f"Backgrounds directory {backgrounds_dir} not found. No custom backgrounds will be available.")
    return sorted(available_backgrounds)


def load_settings():
    """
    Loads settings from file, merging with defaults.
    Generates and saves a new secret_key if one is missing.
    Scans for available themes.
    """
    logger.info("--- Loading settings ---")
    settings = {}
    settings_file_exists = os.path.exists(SETTINGS_FILE)

    if settings_file_exists:
        logger.info(f"Settings file exists: {SETTINGS_FILE}")
        try:
            with open(SETTINGS_FILE, 'r') as f:
                loaded_settings = json.load(f)
                if isinstance(loaded_settings, dict):
                    settings = loaded_settings
                    logger.info("Successfully loaded settings from file.")
                else:
                    logger.warning(f"Settings file {SETTINGS_FILE} contains non-dict data. Using default settings.")
                    settings_file_exists = False
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Error loading settings from {SETTINGS_FILE}: {e}")
            settings = {}
            settings_file_exists = False
    else:
        logger.info(f"Settings file not found: {SETTINGS_FILE}. Using default settings.")

    key_generated = False
    if 'secret_key' not in settings or not settings['secret_key']:
        logger.info("Secret key not found or is empty. Generating a new one...")
        generated_key_bytes = secrets.token_bytes(24)
        settings['secret_key'] = generated_key_bytes.hex()
        key_generated = True
        logger.info("New secret key generated.")
    else:
        settings['secret_key'] = str(settings['secret_key'])

    discovered_themes = _discover_themes()
    settings['available_themes'] = discovered_themes

    discovered_backgrounds = _discover_backgrounds()
    settings['available_backgrounds'] = discovered_backgrounds

    final_settings = {**DEFAULT_SETTINGS, **settings} # Start with defaults, override with loaded/generated

    # Validate and sanitize specific settings
    if final_settings.get('theme') not in final_settings['available_themes']:
        logger.warning(f"Saved theme '{final_settings.get('theme')}' is not in available themes {final_settings['available_themes']}. Falling back to default '{DEFAULT_SETTINGS['theme']}'.")
        final_settings['theme'] = DEFAULT_SETTINGS['theme']
        if final_settings['theme'] not in final_settings['available_themes'] and final_settings['available_themes']:
            final_settings['theme'] = final_settings['available_themes'][0]
        elif not final_settings['available_themes']:
            final_settings['theme'] = 'default'

    try:
        final_settings['rule_interval_seconds'] = int(final_settings.get('rule_interval_seconds', DEFAULT_SETTINGS['rule_interval_seconds']))
    except (ValueError, TypeError):
        logger.warning("Invalid value for rule_interval_seconds. Using default.")
        final_settings['rule_interval_seconds'] = DEFAULT_SETTINGS['rule_interval_seconds']

    try:
        final_settings['last_viewed_threshold_seconds'] = int(final_settings.get('last_viewed_threshold_seconds', DEFAULT_SETTINGS['last_viewed_threshold_seconds']))
    except (ValueError, TypeError):
        logger.warning("Invalid value for last_viewed_threshold_seconds. Using default.")
        final_settings['last_viewed_threshold_seconds'] = DEFAULT_SETTINGS['last_viewed_threshold_seconds']

    if not isinstance(final_settings.get('show_run_notifications'), bool):
        logger.warning("Invalid value for show_run_notifications. Using default.")
        final_settings['show_run_notifications'] = DEFAULT_SETTINGS['show_run_notifications']

    if not isinstance(final_settings.get('show_run_all_notifications'), bool):
        logger.warning("Invalid value for show_run_all_notifications. Using default.")
        final_settings['show_run_all_notifications'] = DEFAULT_SETTINGS['show_run_all_notifications']

    if not isinstance(final_settings.get('show_run_summary_notifications'), bool):
        logger.warning("Invalid value for show_run_summary_notifications. Using default.")
        final_settings['show_run_summary_notifications'] = DEFAULT_SETTINGS['show_run_summary_notifications']

    if not isinstance(final_settings.get('show_run_all_summary_notifications'), bool):
        logger.warning("Invalid value for show_run_all_summary_notifications. Using default.")
        final_settings['show_run_all_summary_notifications'] = DEFAULT_SETTINGS['show_run_all_summary_notifications']
    
    if not isinstance(final_settings.get('log_overridden_actions'), bool):
        logger.warning("Invalid value for log_overridden_actions. Using default.")
        final_settings['log_overridden_actions'] = DEFAULT_SETTINGS['log_overridden_actions']

    if not isinstance(final_settings.get('force_in_run_on_startup'), bool):
        logger.warning("Invalid value for force_in_run_on_startup. Using default.")
        final_settings['force_in_run_on_startup'] = DEFAULT_SETTINGS['force_in_run_on_startup']

    if not isinstance(final_settings.get('force_in_run_on_all_local'), bool):
        logger.warning("Invalid value for force_in_run_on_all_local. Using default.")
        final_settings['force_in_run_on_all_local'] = DEFAULT_SETTINGS['force_in_run_on_all_local']

    if not isinstance(final_settings.get('enable_log_pruning'), bool):
        logger.warning("Invalid value for enable_log_pruning. Using default.")
        final_settings['enable_log_pruning'] = DEFAULT_SETTINGS['enable_log_pruning']
    
    try:
        final_settings['force_in_periodic_run_frequency'] = int(final_settings.get('force_in_periodic_run_frequency', DEFAULT_SETTINGS['force_in_periodic_run_frequency']))
        if final_settings['force_in_periodic_run_frequency'] < 0:
             final_settings['force_in_periodic_run_frequency'] = 0
    except (ValueError, TypeError):
        logger.warning("Invalid value for force_in_periodic_run_frequency. Using default.")
        final_settings['force_in_periodic_run_frequency'] = DEFAULT_SETTINGS['force_in_periodic_run_frequency']

    if not isinstance(final_settings.get('theme'), str):
        logger.warning(f"Invalid type for theme. Using default '{DEFAULT_SETTINGS['theme']}'.")
        final_settings['theme'] = DEFAULT_SETTINGS['theme']
        if final_settings['theme'] not in final_settings['available_themes'] and final_settings['available_themes']:
            final_settings['theme'] = final_settings['available_themes'][0]
        elif not final_settings['available_themes']:
            final_settings['theme'] = 'default'
            
    if not isinstance(final_settings.get('butler_name'), str) or not final_settings.get('butler_name').strip():
        logger.warning(f"Invalid or empty value for butler_name. Using default '{DEFAULT_SETTINGS['butler_name']}'.")
        final_settings['butler_name'] = DEFAULT_SETTINGS['butler_name']
    else:
        final_settings['butler_name'] = final_settings['butler_name'].strip()

    if final_settings.get('background_image') != 'default' and final_settings.get('background_image') not in final_settings['available_backgrounds']:
        logger.warning(f"Saved background '{final_settings.get('background_image')}' is not in available backgrounds {final_settings['available_backgrounds']}. Falling back to default.")
        final_settings['background_image'] = DEFAULT_SETTINGS['background_image']

    # Determine if the file needs to be saved
    should_save_file = (
        key_generated or
        not settings_file_exists or
        settings.get('available_themes') != final_settings['available_themes'] or
        settings.get('theme') != final_settings['theme'] or # If theme was reset
        'show_run_all_notifications' not in settings or # If new setting missing
        'show_run_summary_notifications' not in settings or
        'show_run_all_summary_notifications' not in settings or
        'butler_name' not in settings or final_settings['butler_name'] != settings.get('butler_name') or # Sanitized or new
        'log_overridden_actions' not in settings or
        'force_in_run_on_startup' not in settings or
        'force_in_run_on_all_local' not in settings or
        'force_in_periodic_run_frequency' not in settings or
        'enable_log_pruning' not in settings or
        'background_image' not in settings or
        'available_backgrounds' not in settings or settings.get('available_backgrounds') != final_settings.get('available_backgrounds')
    )
    if should_save_file:
        logger.info("Saving settings file to persist changes (key, theme, available_themes, new setting, or new file).")
        try:
            with open(SETTINGS_FILE, 'w') as f:
                json.dump(final_settings, f, indent=4)
            logger.info(f"Settings file saved: {SETTINGS_FILE}")
        except IOError as e:
            logger.critical(f"Could not save settings file {SETTINGS_FILE}: {e}. Please check file permissions.")
            # Potentially raise or handle this more gracefully if it's critical for app start

    logger.info(f"Final processed settings: {final_settings}")
    logger.info("--- Finished loading settings ---")
    return final_settings

def save_settings_to_file(submitted_settings_data, current_app_config):
    """
    Saves submitted settings to the settings.json file and updates the live app config.
    """
    logger.info("--- Saving settings (app_config.py) ---")
    logger.info(f"Received submitted_data: {submitted_settings_data}")

    #Load settings from the live app config, NOT by re-reading the file.
    # avoids potential race conditions.
    if current_app_config:
        settings_to_save = current_app_config.get('HYDRUS_SETTINGS', {}).copy()
    else:
        # Fallback for testing or contexts without an app, but main flow uses the above.
        settings_to_save = load_settings()

    # Get the currently stored credentials before updating.
    # This safely handles the migration from old key names ('api_address', 'api_key').
    current_settings = current_app_config.get('HYDRUS_SETTINGS', {})
    existing_url = current_settings.get('hydrus_api_url', current_settings.get('api_address'))
    existing_key = current_settings.get('hydrus_api_key', current_settings.get('api_key'))

    # Update the settings object with all submitted data.
    settings_to_save.update(submitted_settings_data)

    # --- Special handling for API URL and key ---
    # If a submitted field was blank, restore the existing value to avoid accidental clearing.
    if not submitted_settings_data.get('hydrus_api_url'):
        settings_to_save['hydrus_api_url'] = existing_url
    
    if not submitted_settings_data.get('hydrus_api_key'):
        settings_to_save['hydrus_api_key'] = existing_key
    
    # Clean up old, obsolete keys to finalize the migration.
    settings_to_save.pop('api_address', None)
    settings_to_save.pop('api_key', None)

    # Ensure butler_name is not empty
    if not settings_to_save.get('butler_name'):
        settings_to_save['butler_name'] = DEFAULT_SETTINGS['butler_name']
    
    # The 'available_themes', 'available_backgrounds', and 'secret_key' are managed internally
    # and should not be overwritten by the form submission. We ensure they persist from the current state.
    if current_app_config:
        settings_to_save['available_themes'] = current_app_config.get('HYDRUS_SETTINGS', {}).get('available_themes', [])
        settings_to_save['available_backgrounds'] = current_app_config.get('HYDRUS_SETTINGS', {}).get('available_backgrounds', [])
        settings_to_save['secret_key'] = current_app_config.get('HYDRUS_SETTINGS', {}).get('secret_key')

    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings_to_save, f, indent=4)
        logger.info(f"Settings successfully written to file: {SETTINGS_FILE}")
        
        # Update the live app config with the newly saved settings
        if current_app_config:
            current_app_config['HYDRUS_SETTINGS'] = settings_to_save.copy()
            logger.info("Live app config HYDRUS_SETTINGS updated.")
        
        return True, settings_to_save
    except IOError as e:
        logger.error(f"Could not write settings to {SETTINGS_FILE}: {e}")
        return False, None


def _get_rule_sort_key(rule):
    """
    Helper function to generate a sort key for a rule to determine its running order.
    Less important rules run first, allowing more important rules to override their effects.
    The 'priority' field from the UI is treated as 'importance_number' internally.

    Input: A merged rule dictionary containing 'priority' and 'creation_timestamp'.
    Output: tuple for sorting (importance_number, is_not_force_in, creation_timestamp)

    Sorting criteria (ascending for each component):
    1.  `importance_number`: (Derived from UI 'priority') Rules with a lower numerical `importance_number`
        are considered less important and run EARLIER. (e.g., Importance 1 runs before Importance 5).
        Default importance is 1 if not specified or invalid.
    2.  `is_not_force_in` (0 for 'force_in', 1 for others): If importance_numbers are the SAME,
        a rule with the `force_in` action type runs before other action types.
    3.  `creation_timestamp`: If importance and action type are identical, rules run based on their
        creation timestamp (earlier first). This provides a stable, predictable tie-breaker.
    """
    try:
        # 'priority' from UI/JSON is treated as 'importance_number'. Lower value = lower importance.
        importance_number = int(rule.get('priority', 1))
    except (ValueError, TypeError):
        importance_number = 1

    action_type = rule.get('action', {}).get('type', '')
    # 0 for 'force_in', 1 for other types. Sorts 'force_in' (0) earlier.
    is_not_force_in_flag = 0 if action_type == 'force_in' else 1

    # The new tie-breaker. Assumes the timestamp is in a format that sorts lexicographically (like ISO 8601).
    # A default value is provided for safety, though it should always exist for a valid rule.
    creation_timestamp = rule.get('creation_timestamp', '1970-01-01 00:00:00')

    return (importance_number, is_not_force_in_flag, creation_timestamp)


def _sort_rules_for_execution(rules):
    """
    Sorts a list of merged rule dictionaries to determine their running order.
    The sorting uses `_get_rule_sort_key`.

    Input: list of rule_dict. Each dict MUST contain 'creation_timestamp'.
    Output: list of rule_dict, sorted for execution (running order).
    """
    if not rules:
        return []

    # Use the custom sort key. Standard sort is ascending by tuple elements.
    sorted_rules = sorted(rules, key=_get_rule_sort_key)

    return sorted_rules


def load_rules(db_conn):
    """
    Loads rule definitions from rules.json, merges them with metadata from the database
    (like scheduling and creation_timestamp), and sorts them for execution.
    NOTE: This function now requires a database connection.
    """
    logger.info("--- Loading and sorting rules ---")
    
    # 1. Load core rule definitions from JSON file
    raw_rules = []
    if os.path.exists(RULES_FILE):
        try:
            with open(RULES_FILE, 'r') as f:
                loaded_data = json.load(f)
                if isinstance(loaded_data, list):
                    raw_rules = loaded_data
                else:
                    logger.warning(f"Rules file {RULES_FILE} contains non-list data. Returning empty list.")
                    return []
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Error loading rules from {RULES_FILE}: {e}")
            return []
    else:
        logger.info(f"Rules file {RULES_FILE} not found. Returning empty list.")
        return []

    # 2. Load rule metadata from the database
    try:
        db_rules_list = database.get_rules(db_conn)
        db_rules_map = {rule['rule_id']: rule for rule in db_rules_list}
    except Exception as e:
        logger.error(f"Failed to fetch rules from database: {e}. Cannot sort rules. Returning empty list.")
        return []

    # 3. Merge JSON data with DB data
    merged_rules = []
    for rule_from_json in raw_rules:
        if not isinstance(rule_from_json, dict) or 'id' not in rule_from_json:
            logger.warning(f"Skipping invalid item in rules.json: {rule_from_json}")
            continue

        rule_id = rule_from_json['id']
        db_record = db_rules_map.get(rule_id)

        if db_record:
            # Rule exists in both places, merge them. JSON is source for core logic.
            # DB is source for sorting timestamp and scheduling.
            merged_rule = rule_from_json.copy()
            merged_rule = rule_from_json.copy()
            merged_rule['creation_timestamp'] = db_record.get('creation_timestamp')
            
            # --- Parse the execution_override JSON from the database ---
            override_str = db_record.get('execution_override')
            override_data = {}
            if override_str:
                try:
                    override_data = json.loads(override_str)
                    if not isinstance(override_data, dict):
                        # Handle case where DB might contain a non-dict value (e.g., "custom") from an old version
                        logger.warning(f"Rule '{rule_from_json.get('name', rule_id)}' has a non-dictionary execution_override. Re-interpreting.")
                        override_data = {'type': str(override_str)}
                except json.JSONDecodeError:
                    logger.warning(f"Could not parse execution_override JSON for rule '{rule_from_json.get('name', rule_id)}'. Value: '{override_str}'. Treating as simple string.")
                    # Fallback for old, non-JSON values like 'custom'
                    override_data = {'type': override_str}
            
            # Attach the parsed dictionary to the rule object
            merged_rule['execution_override'] = override_data
            # We still keep interval_seconds for potential backward compatibility or simple access, but the override dict is the source of truth
            merged_rule['interval_seconds'] = db_record.get('interval_seconds')
            
            # Merge the new 'force_in' and run count properties
            merged_rule['force_in_check_frequency'] = db_record.get('force_in_check_frequency', 'first_run_only')
            merged_rule['force_in_check_interval_runs'] = db_record.get('force_in_check_interval_runs')
            merged_rule['run_count'] = db_record.get('run_count', 0)
            merged_rule['has_been_run'] = bool(db_record.get('has_been_run', 0))


            merged_rules.append(merged_rule)
        else:
            # Rule in JSON but not DB. This can happen if a rule was added but DB save failed.
            # We log a warning and skip it, as it cannot be sorted or scheduled correctly.
            logger.warning(f"Rule '{rule_from_json.get('name', rule_id)}' found in rules.json but not in the database. It will be ignored.")

    # 4. Sort the merged rules for execution
    sorted_rules_for_execution = _sort_rules_for_execution(merged_rules)
    
    logger.info(f"Successfully loaded and sorted {len(sorted_rules_for_execution)} rules for execution.")
    logger.info("--- Finished loading rules ---")
    
    return sorted_rules_for_execution


def save_rules_to_file(rules_data, current_app_config, db_conn):
    """
    Saves the core rule definitions to rules.json (stripping scheduling info).
    Then, re-loads and re-sorts the rules using DB data to update the live app.config.
    NOTE: This function now requires a database connection.
    """
    logger.info(f"Attempting to save {len(rules_data)} rules to file.")

    # 1) Prepare a "clean" version of rules for the JSON file (without scheduling info)
    cleaned_rules_for_json = []
    keys_to_remove = ['execution_override', 'interval_seconds', 'creation_timestamp', 'has_been_run']
    for rule in rules_data:
        if isinstance(rule, dict):
            clean_rule = rule.copy()
            for key in keys_to_remove:
                clean_rule.pop(key, None)
            cleaned_rules_for_json.append(clean_rule)

    try:
        # 2) Save the cleaned rules to rules.json
        with open(RULES_FILE, 'w') as f:
            json.dump(cleaned_rules_for_json, f, indent=4)
        logger.info(f"Successfully saved {len(cleaned_rules_for_json)} core rule definitions to {RULES_FILE}.")

        # 3) Re-load and re-sort the rules to update the live app config
        if current_app_config and db_conn:
            # Calling load_rules ensures we get a fresh, correctly merged and sorted list
            execution_ordered_rules = load_rules(db_conn)
            current_app_config['AUTOMATION_RULES'] = execution_ordered_rules
            
            logger.info(f"Live app config updated with {len(execution_ordered_rules)} execution-sorted rules.")

        return True
    except IOError as e:
        logger.error(f"Error saving rules to {RULES_FILE}: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error saving rules: {e}", exc_info=True)
        return False