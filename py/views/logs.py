# --- Standard Library Imports ---
import json
import sqlite3
import uuid
from datetime import datetime
from urllib.parse import unquote

# --- Third-Party Imports ---
from flask import current_app, jsonify, render_template, request

# --- Local Application Imports ---
from . import views_bp
from database import get_db_connection, prune_duplicate_logs
from rule_processing.utils import parse_time_range_for_logs

# --- Route Handlers ---

@views_bp.route('/logs')
def logs_page_route():
    current_settings = current_app.config.get('HYDRUS_SETTINGS', {})
    return render_template('logs.html',
                           current_theme=current_settings.get('theme', 'default'),
                           current_settings=current_settings)

@views_bp.route('/api/v1/logs/stats', methods=['GET'])
def get_log_stats_route():
    db_conn = None
    try:
        start_iso, end_iso, time_frame = parse_time_range_for_logs(request.args)
        db_conn = get_db_connection()
        query = """
            SELECT rule_name, SUM(actions_succeeded_count) as total_success_count
            FROM run_logs
            WHERE status IN ('success_completed', 'failure_critical') AND actions_succeeded_count > 0
        """
        params = []
        if time_frame != 'all':
            query += " AND start_time >= ? AND start_time <= ?"
            params.extend([start_iso, end_iso])
        query += " GROUP BY rule_name ORDER BY total_success_count DESC"
        
        cursor = db_conn.cursor()
        cursor.execute(query, tuple(params))
        stats = [dict(row) for row in cursor.fetchall()]
        return jsonify({"success": True, "data": stats, "time_frame_used": time_frame}), 200
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/api/v1/logs/search_runs', methods=['GET'])
def search_runs_route():
    db_conn = None
    try:
        args = request.args
        limit = max(1, min(int(args.get('limit', 50)), 500))
        offset = max(0, int(args.get('offset', 0)))
        start_iso, end_iso, _ = parse_time_range_for_logs(args)

        where_clauses, params = ["start_time <= ?"], [end_iso]
        if start_iso != (datetime.min.isoformat() + "Z"):
            where_clauses.append("start_time >= ?")
            params.append(start_iso)
        
        # Filtering logic (omitted for brevity, same as original)
        # ...

        sort_by = args.get('sort_by', 'timestamp_desc')
        sort_map = {'timestamp_desc': 'start_time DESC', 'timestamp_asc': 'start_time ASC',
                    'rule_name_asc': 'rule_name ASC', 'rule_name_desc': 'rule_name DESC',
                    'status_asc': 'status ASC', 'status_desc': 'status DESC'}
        order_by_sql = sort_map.get(sort_by, 'start_time DESC')
        where_sql = f"WHERE {' AND '.join(where_clauses)}"
        
        db_conn = get_db_connection()
        cursor = db_conn.cursor()
        count_query = f"SELECT COUNT(run_log_id) FROM run_logs {where_sql}"
        cursor.execute(count_query, tuple(params))
        total_records = cursor.fetchone()[0]

        data_query = f"SELECT * FROM run_logs {where_sql} ORDER BY {order_by_sql} LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor.execute(data_query, tuple(params))
        logs = [dict(row) for row in cursor.fetchall()]

        return jsonify({"success": True, "logs": logs, "total_records": total_records}), 200
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/api/v1/logs/lookup/rule/<rule_id>', methods=['GET'])
def lookup_rule_info_route(rule_id):
    db_conn = None
    try:
        db_conn = get_db_connection()
        cursor = db_conn.cursor()
        cursor.execute("SELECT * FROM rules WHERE rule_id = ?", (rule_id,))
        rule_info = cursor.fetchone()
        if not rule_info:
            return jsonify({"success": False, "message": "Rule not found in the database."}), 404
        
        result = dict(rule_info)
        cursor.execute("""
            SELECT s.id, s.name FROM rule_sets s JOIN rule_set_associations rsa ON s.id = rsa.set_id
            WHERE rsa.rule_id = ? """, (rule_id,))
        set_membership = cursor.fetchone()
        result['set'] = dict(set_membership) if set_membership else None

        cursor.execute("""
            SELECT COUNT(run_log_id) as total_runs,
                   SUM(CASE WHEN status IN ('success_completed', 'failure_critical') THEN 1 ELSE 0 END) as total_successes,
                   SUM(actions_succeeded_count) as total_files_processed,
                   MAX(start_time) as last_run_time
            FROM run_logs WHERE rule_id = ? """, (rule_id,))
        stats = cursor.fetchone()
        result['stats'] = dict(stats) if stats else {}

        return jsonify({"success": True, "data": result}), 200
    except Exception as e:
        current_app.logger.error(f"Error in lookup_rule_info_route for {rule_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"Error looking up rule info: {e}"}), 500
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/api/v1/logs/lookup/file/<file_hash>', methods=['GET'])
def lookup_file_info_route(file_hash):
    db_conn = None
    try:
        db_conn = get_db_connection()
        cursor = db_conn.cursor()
        result = {}
        cursor.execute("SELECT * FROM files WHERE file_hash = ?", (file_hash,))
        state_row = cursor.fetchone()
        if state_row:
            state_data = dict(state_row)
            for key in ['rules_in_application', 'correct_placement', 'affected_rating_services', 'rating_priority_governance']:
                if key in state_data and isinstance(state_data[key], str):
                    try:
                        state_data[key] = json.loads(state_data[key])
                    except json.JSONDecodeError:
                        state_data[key] = {"error": "Failed to decode JSON from DB", "raw": state_data[key]}
            result['state'] = state_data
        else:
            result['state'] = None

        cursor.execute("""
            SELECT l.log_id, l.status as event_status, l.details_json, l.message,
                   r.start_time, r.rule_id, r.rule_name, r.run_log_id
            FROM logs l JOIN run_logs r ON l.run_log_id = r.run_log_id
            WHERE l.file_hash = ? ORDER BY r.start_time DESC """, (file_hash,))
        history_rows = cursor.fetchall()
        history = []
        for row in history_rows:
            entry = dict(row)
            try:
                entry['details_json'] = json.loads(entry['details_json'])
            except (json.JSONDecodeError, TypeError):
                entry['details_json'] = {"error": "Failed to decode JSON from DB", "raw": entry.get('details_json')}
            history.append(entry)
        result['history'] = history
        
        if not result['state'] and not result['history']:
             return jsonify({"success": False, "message": "File hash not found in any logs or state records."}), 404
        return jsonify({"success": True, "data": result}), 200
    except Exception as e:
        current_app.logger.error(f"Error in lookup_file_info_route for {file_hash}: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"Error looking up file info: {e}"}), 500
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/logs/details/<run_log_id>', methods=['GET'])
def get_run_log_details_route(run_log_id):
    db_conn = None
    try:
        db_conn = get_db_connection()
        cursor = db_conn.cursor()
        cursor.execute("SELECT * FROM logs WHERE run_log_id = ? ORDER BY log_id ASC", (run_log_id,))
        details = [dict(row) for row in cursor.fetchall()]
        return jsonify({"success": True, "details": details})
    finally:
        if db_conn: db_conn.close()

@views_bp.route('/logs/prune_manual', methods=['POST'])
def manual_prune_logs_route():
    current_app.logger.info("--- Manual Log Pruning Triggered ---")
    db_conn = None
    try:
        db_conn = get_db_connection()
        deleted_count = prune_duplicate_logs(db_conn)
        if deleted_count >= 0:
            message = f"Successfully pruned {deleted_count} redundant log entries."
            current_app.logger.info(message)
            return jsonify({"success": True, "message": message}), 200
        else: # deleted_count is -1 on error
            message = "An error occurred during log pruning. Please check the application logs."
            current_app.logger.error(message)
            return jsonify({"success": False, "message": message}), 500
    except Exception as e:
        message = f"An unexpected error occurred while trying to prune logs: {e}"
        current_app.logger.error(message, exc_info=True)
        return jsonify({"success": False, "message": message}), 500
    finally:
        if db_conn:
            db_conn.close()
        current_app.logger.info("--- Manual Log Pruning Finished ---")