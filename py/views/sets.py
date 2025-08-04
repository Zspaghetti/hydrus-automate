# --- Standard Library Imports ---
import sqlite3
import uuid

# --- Third-Party Imports ---
from flask import current_app, jsonify, request, render_template

# --- Local Application Imports ---
from . import views_bp
from .core import hydrus_online_required
from app_config import load_rules as app_config_load_rules
from database import (
    delete_set, get_all_set_data, get_db_connection, remove_rule_from_set, # <-- Already correctly imported
    save_set_configuration
)
from rule_processing.orchestrator import execute_single_rule

# --- Route Handlers ---

@views_bp.route('/sets')
def sets_page():
    current_settings = current_app.config.get('HYDRUS_SETTINGS', {})
    return render_template('sets.html',
                           current_theme=current_settings.get('theme', 'default'),
                           current_settings=current_settings)

@views_bp.route('/api/v1/sets', methods=['GET'])
def get_all_sets_route():
    db_conn = None
    try:
        db_conn = get_db_connection()
        set_data = get_all_set_data(db_conn)
        return jsonify({"success": True, "data": set_data}), 200
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/api/v1/sets', methods=['POST'])
def save_sets_route():
    if not request.is_json:
        return jsonify({"success": False, "message": "Request must be JSON."}), 415

    data_from_frontend = request.get_json()
    if not isinstance(data_from_frontend, list):
        return jsonify({"success": False, "message": "Expected a list of set objects."}), 400

    db_conn = None
    try:
        sets_for_db = []
        associations_for_db = []
        for frontend_set in data_from_frontend:
            for assoc in frontend_set.get('associations', []):
                associations_for_db.append({"rule_id": assoc['rule_id'], "set_id": frontend_set['id']})
            
            set_copy = frontend_set.copy()
            if 'associations' in set_copy:
                del set_copy['associations']
            sets_for_db.append(set_copy)
        
        payload_for_db = {"sets": sets_for_db, "associations": associations_for_db}

        db_conn = get_db_connection()
        save_set_configuration(db_conn, payload_for_db)
        return jsonify({"success": True, "message": "Rule sets saved successfully."}), 200
    except (sqlite3.Error, KeyError) as e:
        return jsonify({"success": False, "message": f"An error occurred while saving: {e}"}), 500
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/api/v1/sets/<set_id>', methods=['DELETE'])
def delete_set_route(set_id):
    db_conn = None
    try:
        db_conn = get_db_connection()
        delete_set(db_conn, set_id)
        return jsonify({"success": True, "message": f"Set {set_id} deleted."}), 200
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/api/v1/sets/<set_id>/rules/<rule_id>', methods=['DELETE'])
def remove_rule_from_set_route(set_id, rule_id):
    """Removes a single rule's association from a single set."""
    current_app.logger.info(f"API request to remove rule '{rule_id}' from set '{set_id}'.")
    db_conn = None
    try:
        db_conn = get_db_connection()
        remove_rule_from_set(db_conn, rule_id, set_id) 
        return jsonify({"success": True, "message": "Rule removed from set successfully."}), 200
    except sqlite3.Error as e:
        # The DB function handles the Rollback,
        # but we still need to catch the raised exception to send a failure response.
        current_app.logger.error(f"Database error removing rule '{rule_id}' from set '{set_id}': {e}", exc_info=True)
        return jsonify({"success": False, "message": f"Database error: {e}"}), 500
    finally:
        if db_conn:
            db_conn.close()

@views_bp.route('/api/v1/run_set/<set_id>', methods=['POST'])
@hydrus_online_required
def run_set_route(set_id):
    parent_run_id = f"manual_set_run_{uuid.uuid4()}"
    current_app.logger.info(f"\n--- Manual Set Trigger: Run ID {parent_run_id[:8]} for Set {set_id[:8]} ---")
    db_conn = None
    results_per_rule = []
    summary_totals = {'rules_processed': 0, 'rules_with_errors': 0, 'files_matched_by_search': 0,
                      'files_action_attempted_on': 0, 'files_skipped_due_to_override': 0}

    try:
        data = request.get_json() or {}
        override_bypass_list = data.get('override_bypass_list', [])
        deep_run_list = data.get('deep_run_list', [])
        db_conn = get_db_connection()
        all_rules_from_db = app_config_load_rules(db_conn)
        
        if set_id == 'all':
            rules_to_run = all_rules_from_db
        else:
            cursor = db_conn.cursor()
            cursor.execute("SELECT rule_id FROM rule_set_associations WHERE set_id = ?", (set_id,))
            rule_ids_in_set = {row['rule_id'] for row in cursor.fetchall()}
            rules_to_run = [rule for rule in all_rules_from_db if rule['id'] in rule_ids_in_set]

        rules_to_run.sort(key=lambda r: r.get('priority', 0))
        summary_totals['rules_processed'] = len(rules_to_run)

        for i, rule in enumerate(rules_to_run):
            exec_result = execute_single_rule(
                app_config=current_app.config, db_conn=db_conn, rule=rule,
                current_run_id=parent_run_id, execution_order_in_run=i + 1,
                is_manual_run=True,
                override_bypass_list=override_bypass_list, deep_run_list=deep_run_list
            )
            results_per_rule.append(exec_result)
            if not exec_result.get('success', False): summary_totals['rules_with_errors'] += 1
            summary_totals['files_matched_by_search'] += exec_result.get('files_matched_by_search', 0)
            summary_totals['files_action_attempted_on'] += exec_result.get('files_action_attempted_on', 0)
            summary_totals['files_skipped_due_to_override'] += exec_result.get('files_skipped_due_to_override', 0)

        message = f"Set run finished. Processed {summary_totals['rules_processed']} rules."
        return jsonify({"success": True, "message": message, "results_per_rule": results_per_rule, "summary_totals": summary_totals}), 200
    except Exception as e:
        current_app.logger.error(f"Error in run_set_route for Set {set_id[:8]}: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if db_conn: db_conn.close()

        current_app.logger.info(f"--- Manual Set Trigger Finished: Run ID {parent_run_id[:8]} ---")
