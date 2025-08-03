# --- Standard Library Imports ---
import json
import os
import sqlite3
import uuid

# --- Third-Party Imports ---
from flask import current_app, jsonify, request, render_template

# --- Local Application Imports ---
from . import views_bp
from .core import hydrus_online_required  # <-- Import the decorator
from app_config import (
    RULES_FILE,
    save_rules_to_file,
    load_rules as app_config_load_rules
)
from database import (
    add_rule_to_set, clear_rule_from_file_state, get_db_connection,
    get_rules_first_run_status, save_rule
)
from rule_processing.orchestrator import estimate_rule_impact, execute_single_rule
from scheduler_tasks import schedule_rules_tick_job

# --- Helpers ---

def _load_rules_from_file_user_order():
    """Loads rules from rules.json, preserving the user-defined file order."""
    if os.path.exists(RULES_FILE):
        try:
            with open(RULES_FILE, 'r') as f:
                rules = json.load(f)
                return rules if isinstance(rules, list) else []
        except (IOError, json.JSONDecodeError) as e:
            current_app.logger.error(f"Could not read or parse {RULES_FILE} for user-order list: {e}")
            return []
    return []

def _get_rule_action_details(rule):
    """
    Helper function to safely extract the action type and destination key(s) from a rule object.
    """
    action = rule.get('action', {})
    action_type = action.get('type')
    destination = None
    if action_type == 'rating':
        destination = action.get('rating_service_key')
    elif action_type in ['add_to', 'force_in']:
        destination = action.get('destination_service_keys', [])
    return action_type, destination

# --- Route Handlers ---

@views_bp.route('/rules', methods=['GET'])
def get_rules_route():
    rules = _load_rules_from_file_user_order()
    return jsonify({"success": True, "rules": rules}), 200

@views_bp.route('/add_rule', methods=['POST'])
def add_rule_route():
    current_app.logger.info("Attempting to add or update rule (views.py).")
    if not request.is_json:
        return jsonify({"success": False, "message": "Request must be JSON."}), 415

    data = request.get_json()
    rule_id = data.get('id')
    is_update = bool(rule_id)
    
    # --- VALIDATION (omitted for brevity, same as original) ---
    
    rules_list = _load_rules_from_file_user_order()
    db_conn = None
    
    try:
        db_conn = get_db_connection()
        if is_update:
            found_idx = next((i for i, r in enumerate(rules_list) if r.get('id') == rule_id), -1)
            if found_idx == -1:
                db_conn.close()
                return jsonify({"success": False, "message": f"Rule ID {rule_id} not found for update."}), 404
            
            old_rule_state = rules_list[found_idx]
            rules_list[found_idx] = data
            save_rule(db_conn, data)
            
            old_type, old_destinations = _get_rule_action_details(old_rule_state)
            if old_type and old_destinations:
                dest_list = old_destinations if isinstance(old_destinations, list) else [old_destinations]
                for dest in dest_list:
                    clear_rule_from_file_state(db_conn, rule_id, old_type, dest)

            action_performed_text = 'updated'
            final_message = f"Successfully updated rule: '{data['name']}'."
        else: # Add new rule
            new_rule = data
            
            #Auto-naming logic
            rule_name = new_rule.get('name', '').strip()
            if not rule_name:
                # Load existing rules to determine the next available number.
                # app_config_load_rules provides the canonical, active list of rules.
                existing_rules_for_count = app_config_load_rules(db_conn)
                next_rule_number = len(existing_rules_for_count) + 1
                generated_name = f"Rule #{next_rule_number}"
                new_rule['name'] = generated_name
                current_app.logger.info(f"Rule name was empty. Auto-generated name: '{generated_name}'.")
            #END: Auto-naming logic
            
            new_rule['id'] = str(uuid.uuid4())
            set_ids = new_rule.pop('set_ids', [])
            save_rule(db_conn, new_rule)
            if set_ids:
                for set_id in set_ids:
                    add_rule_to_set(db_conn, new_rule['id'], set_id)
            rules_list.append(new_rule)
            action_performed_text = 'added'
            final_message = f"Successfully added new rule: '{new_rule['name']}'."
        
        db_conn.commit()
        if save_rules_to_file(rules_list, current_app.config, db_conn):
            current_app.logger.info(f"Rule(s) '{data['name']}' {action_performed_text} successfully. Transaction committed.")
            return jsonify({"success": True, "message": final_message, "rule_id": data.get('id')}), 200
        else:
            db_conn.rollback()
            current_app.logger.error("Failed to save rules to file. DB changes were rolled back.")
            return jsonify({"success": False, "message": "Failed to save main rule list to file."}), 500
    except (sqlite3.Error, ValueError, TypeError) as e:
        if db_conn: db_conn.rollback()
        current_app.logger.error(f"Error during add/update rule: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"An error occurred: {e}"}), 500
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/rules/<rule_id>', methods=['DELETE'])
def delete_rule_route(rule_id):
    rules_list = _load_rules_from_file_user_order()
    rule_to_delete = next((r for r in rules_list if r.get('id') == rule_id), None)
    if not rule_to_delete:
        return jsonify({"success": False, "message": f"Rule ID {rule_id} not found."}), 404

    db_conn = None
    try:
        db_conn = get_db_connection()
        action_type, destinations = _get_rule_action_details(rule_to_delete)
        if action_type and destinations:
            dest_list = destinations if isinstance(destinations, list) else [destinations]
            for dest in dest_list:
                clear_rule_from_file_state(db_conn, rule_id, action_type, dest)
        
        cursor = db_conn.cursor()
        cursor.execute("DELETE FROM rule_set_associations WHERE rule_id = ?", (rule_id,))
        cursor.execute("DELETE FROM rules WHERE rule_id = ?", (rule_id,))
        
        rules_after_delete = [r for r in rules_list if r.get('id') != rule_id]
        
        if save_rules_to_file(rules_after_delete, current_app.config, db_conn):
            db_conn.commit()
            rule_name_for_log = rule_to_delete.get('name', rule_id)
            current_app.logger.info(f"Rule '{rule_name_for_log}' (ID: {rule_id}) successfully deleted.")
            return jsonify({"success": True, "message": f"Successfully deleted rule: '{rule_name_for_log}'."}), 200
        else:
            db_conn.rollback()
            return jsonify({"success": False, "message": "Failed to update rules file. Check logs."}), 500
    except Exception as e:
        if db_conn: db_conn.rollback()
        current_app.logger.error(f"Error during delete rule {rule_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"Unexpected error: {e}"}), 500
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/rules/first_run_status', methods=['POST'])
def get_first_run_status_route():
    data = request.get_json() or {}
    rule_ids_to_check = data.get('rule_ids', [])
    if not isinstance(rule_ids_to_check, list):
        return jsonify({"success": False, "message": "Payload must contain a 'rule_ids' list."}), 400

    db_conn = None
    try:
        db_conn = get_db_connection()
        statuses = get_rules_first_run_status(db_conn, rule_ids_to_check)
        return jsonify({"success": True, "statuses": statuses}), 200
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/rules/estimate_impact/<rule_id>', methods=['GET', 'POST'])
@hydrus_online_required
def estimate_rule_impact_route(rule_id):
    rules = current_app.config.get('AUTOMATION_RULES', [])
    rule_to_estimate = next((r for r in rules if r.get('id') == rule_id), None)
    if not rule_to_estimate:
        return jsonify({"success": False, "message": f"Rule with ID {rule_id} not found."}), 404

    data = request.get_json() or {}
    is_deep_run_flag = data.get('deep_run', False)
    is_bypass_override_flag = data.get('bypass_override', False)

    success, result = estimate_rule_impact(
        current_app.config, rule_to_estimate, 
        is_deep_run=is_deep_run_flag, is_bypass_override=is_bypass_override_flag
    )
    if success:
        return jsonify({"success": True, **result}), 200
    else:
        return jsonify({"success": False, **result}), 500

@views_bp.route('/run_rule/<rule_id_from_path>', methods=['POST'])
@hydrus_online_required
def run_single_rule_route(rule_id_from_path):
    parent_run_id = f"manual_single_run_{uuid.uuid4()}"
    current_app.logger.info(f"\n--- Manual Single Rule Trigger: Run ID {parent_run_id[:8]} for Rule {rule_id_from_path[:8]} ---")
    db_conn = None
    exec_result = {}
    try:
        data = request.get_json() or {}
        override_bypass_list = data.get('override_bypass_list', [])
        deep_run_list = data.get('deep_run_list', [])

        rules = current_app.config.get('AUTOMATION_RULES', [])
        rule_to_run = next((r for r in rules if r.get('id') == rule_id_from_path), None)
        if not rule_to_run:
            raise ValueError(f"Rule ID {rule_id_from_path} not found.")

        db_conn = get_db_connection()
        exec_result = execute_single_rule(
            app_config=current_app.config, db_conn=db_conn, rule=rule_to_run,
            current_run_id=parent_run_id, execution_order_in_run=1,
            is_manual_run=True,
            override_bypass_list=override_bypass_list, deep_run_list=deep_run_list
        )
    except Exception as e:
        current_app.logger.error(f"Error in run_single_rule_route for Rule {rule_id_from_path[:8]}: {e}", exc_info=True)
        exec_result = {"success": False, "message": str(e), "rule_id": rule_id_from_path}
    finally:
        if db_conn: db_conn.close()
        current_app.logger.info(f"--- Manual Single Rule Finished: Run ID {parent_run_id[:8]} ---")
    
    http_status = 200 if exec_result.get("success", False) else 500
    return jsonify(exec_result), http_status

@views_bp.route('/run_all_rules_manual', methods=['POST'])
@hydrus_online_required
def run_all_rules_manual_route():
    parent_run_id = f"manual_all_rules_run_{uuid.uuid4()}"
    current_app.logger.info(f"\n--- Manual 'Run All Rules' Trigger: Run ID {parent_run_id[:8]} ---")
    all_results = []
    failed_rules = 0
    db_conn = None
    try:
        data = request.get_json() or {}
        override_bypass_list = data.get('override_bypass_list', [])
        deep_run_list = data.get('deep_run_list', [])
        db_conn = get_db_connection()
        rules = app_config_load_rules(db_conn) 
        if not rules:
            if db_conn: db_conn.close() # Close connection early if no rules
            current_app.logger.info("--- Manual 'Run All Rules' Finished (no rules to run): Run ID {parent_run_id[:8]} ---")
            return jsonify({"success": True, "message": "No rules to run.", "results_per_rule": []}), 200
        rules.sort(key=lambda r: r.get('priority', 0))

        for i, rule in enumerate(rules):
            result = execute_single_rule(
                app_config=current_app.config, db_conn=db_conn, rule=rule,
                current_run_id=parent_run_id, execution_order_in_run=i + 1,
                override_bypass_list=override_bypass_list, deep_run_list=deep_run_list
            )
            all_results.append(result)
            if not result.get('success'):
                failed_rules += 1
    except Exception as e:
        current_app.logger.error(f"Global error in run_all_rules_manual_route: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"A critical error stopped the run: {e}"}), 500
    finally:
        if db_conn: db_conn.close()
        current_app.logger.info(f"--- Manual 'Run All Rules' Finished: Run ID {parent_run_id[:8]} ---")

    summary_msg = f"Run complete. Processed {len(all_results)} rules. Rules with errors: {failed_rules}."
    overall_success = failed_rules == 0
    return jsonify({
        "success": overall_success, "message": summary_msg, 
        "run_id_for_log": parent_run_id, "results_per_rule": all_results
    }), 200

@views_bp.route('/rule_intervals')
def rule_intervals_page():
    current_settings = current_app.config.get('HYDRUS_SETTINGS', {})
    return render_template('rule_intervals.html', 
                           current_theme=current_settings.get('theme', 'default'),
                           current_settings=current_settings)

@views_bp.route('/save_rule_intervals', methods=['POST'])
def save_rule_intervals_route():
    if not request.is_json:
        return jsonify({"success": False, "message": "Request must be JSON."}), 415
    intervals_data = request.get_json()
    if not isinstance(intervals_data, list):
        return jsonify({"success": False, "message": "Payload must be a list of interval settings."}), 400

    db_conn = None
    try:
        db_conn = get_db_connection()
        rules_map = {rule['id']: rule for rule in _load_rules_from_file_user_order()}
        for interval_setting in intervals_data:
            rule_id = interval_setting.get('rule_id')
            if rule_id in rules_map:
                rule_to_update = rules_map[rule_id]
                override_type = interval_setting.get('type', 'default')
                if override_type == 'custom':
                    rule_to_update['execution_override'] = 'custom'
                    try:
                        rule_to_update['interval_seconds'] = int(interval_setting.get('value'))
                    except (ValueError, TypeError, AttributeError):
                         rule_to_update['interval_seconds'] = 0 # Default to 0 on error
                elif override_type == 'none':
                     rule_to_update['execution_override'] = 'none'
                     rule_to_update['interval_seconds'] = None
                else: # 'default' case
                     rule_to_update['execution_override'] = None
                     rule_to_update['interval_seconds'] = None
                save_rule(db_conn, rule_to_update)
        db_conn.commit()
        schedule_rules_tick_job(current_app._get_current_object())
        return jsonify({"success": True, "message": "Rule intervals saved successfully."}), 200
    except (sqlite3.Error, KeyError) as e:
        if db_conn: db_conn.rollback()
        return jsonify({"success": False, "message": f"An error occurred while saving intervals: {e}"}), 500
    finally:

        if db_conn: db_conn.close()
