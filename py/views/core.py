# --- Standard Library Imports ---
import os
from functools import wraps

# --- Third-Party Imports ---
from flask import (
    current_app, flash, jsonify, redirect, render_template,
    request, send_from_directory, url_for
)

# --- Local Application Imports ---
from . import views_bp  # <-- Import the shared blueprint
from app_config import save_settings_to_file
from database import get_db_connection
from hydrus_interface import call_hydrus_api
from rule_processing.actions import ensure_services_are_loaded
from rule_processing.context import RuleExecutionContext
from scheduler_tasks import schedule_log_pruning_job, schedule_rules_tick_job

def _get_available_backgrounds():
    """Scans the static/images/backgrounds directory for available images."""
    backgrounds_dir = os.path.join(current_app.static_folder, 'images', 'backgrounds')
    if not os.path.isdir(backgrounds_dir):
        return []
    try:
        # List files, filter for common image extensions, and return the list
        supported_extensions = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
        return [f for f in os.listdir(backgrounds_dir) if f.lower().endswith(supported_extensions)]
    except OSError:
        current_app.logger.error(f"Could not read directory: {backgrounds_dir}")
        return []

# --- Decorators and Helpers ---

def hydrus_online_required(f):
    """
    A decorator to protect routes that require a live connection to Hydrus.
    If Hydrus is not online, it returns a 503 Service Unavailable error.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        status_info = current_app.config.get('HYDRUS_CONNECTION_STATUS', {})
        if status_info.get('status') != 'ONLINE':
            return jsonify({
                "success": False,
                "error_code": "HYDRUS_OFFLINE",
                "message": f"Action failed because Hydrus is offline. Last status: {status_info.get('message', 'Unknown')}"
            }), 503
        return f(*args, **kwargs)
    return decorated_function

def _retry_connection_logic():
    """
    Centralized logic for attempting to connect to Hydrus. This is intentionally
    similar to the initial check in app.py.
    Updates the global app config with the result.
    """
    hydrus_settings = current_app.config.get('HYDRUS_SETTINGS', {})
    api_url = hydrus_settings.get('hydrus_api_url')
    api_key = hydrus_settings.get('hydrus_api_key')

    if not api_url:
        current_app.config['HYDRUS_CONNECTION_STATUS'] = {'status': 'OFFLINE', 'message': 'Hydrus API URL is not configured in settings.'}
        return

    try:
        services_result, http_status = call_hydrus_api(api_url, api_key, '/get_services')
        if services_result.get("success") and isinstance(services_result.get('data'), dict):
            services_object = services_result["data"].get('services')
            if isinstance(services_object, dict):
                services_list = []
                for key, details in services_object.items():
                    if isinstance(details, dict):
                        services_list.append({
                            'service_key': key, 'name': details.get('name', 'Unnamed Service'),
                            'type': details.get('type'), 'type_pretty': details.get('type_pretty', 'Unknown Type'),
                            'star_shape': details.get('star_shape'), 'min_stars': details.get('min_stars'),
                            'max_stars': details.get('max_stars'),
                        })
                current_app.config['AVAILABLE_SERVICES'] = services_list
                current_app.config['HYDRUS_CONNECTION_STATUS'] = {'status': 'ONLINE', 'message': f"Successfully connected and fetched {len(services_list)} services."}
            else:
                 raise ConnectionError("Could not parse services object from API response.")
        else:
            error_message = services_result.get('message', 'Unknown API error')
            raise ConnectionError(f"API call failed: {error_message} (HTTP {http_status})")
    except Exception as e:
        current_app.config['HYDRUS_CONNECTION_STATUS'] = {'status': 'OFFLINE', 'message': f'Failed to connect: {e}'}
        current_app.config['AVAILABLE_SERVICES'] = []

def _fetch_available_services_helper(config, log_reason=""):
    """
    Creates a minimal context to fetch services, as ensure_services_are_loaded
    now expects a RuleExecutionContext object.
    """
    db_conn = None
    try:
        db_conn = get_db_connection()
        dummy_ctx = RuleExecutionContext(
            app_config=config, db_conn=db_conn,
            rule={'id': 'dummy', 'name': 'dummy_rule_for_service_fetch'},
            run_id='dummy_run', rule_execution_id='dummy_exec', is_manual_run=False
        )
        return ensure_services_are_loaded(dummy_ctx)
    except Exception as e:
        current_app.logger.error(f"Failed to create context or fetch services ({log_reason}): {e}")
        return []
    finally:
        if db_conn: db_conn.close()

# --- Route Handlers ---

@views_bp.route('/')
def index():
    current_settings = current_app.config.get('HYDRUS_SETTINGS', {})
    # Note: In a real app, this list might be cached in app.config at startup
    # for better performance, rather than scanning the directory on every request.
    available_backgrounds = _get_available_backgrounds()
    return render_template('index.html',
                           current_theme=current_settings.get('theme', 'default'),
                           current_settings=current_settings,
                           available_backgrounds=available_backgrounds)

@views_bp.route('/settings')
def settings_page():
    current_settings = current_app.config.get('HYDRUS_SETTINGS', {})
    settings_for_template = current_settings.copy()
    if 'hydrus_api_key' in settings_for_template:
        settings_for_template['hydrus_api_key'] = '' # Mask API key
    
    current_theme = current_settings.get('theme', 'default')
    available_backgrounds = _get_available_backgrounds()
    
    return render_template('settings.html', 
                           current_settings=settings_for_template,
                           current_theme=current_theme,
                           available_backgrounds=available_backgrounds)

@views_bp.route('/save_settings', methods=['POST'])
def handle_save_settings():
    current_app.logger.info("--- Received request to save settings (views.py) ---")
    
    submitted_data = {
        'hydrus_api_url': request.form.get('hydrus_api_url', '').strip(),
        'hydrus_api_key': request.form.get('hydrus_api_key', '').strip(),
        'rule_interval_seconds': request.form.get('rule_interval_seconds', 60, type=int),
        'last_viewed_threshold_seconds': request.form.get('last_viewed_threshold_seconds', 86400, type=int),
        'show_run_notifications': 'show_run_notifications' in request.form,
        'show_run_all_notifications': 'show_run_all_notifications' in request.form,
        'show_run_summary_notifications': 'show_run_summary_notifications' in request.form,
        'show_run_all_summary_notifications': 'show_run_all_summary_notifications' in request.form,
        'theme': request.form.get('theme', 'default'),
        'background_image': request.form.get('background_image', 'default'),
        'butler_name': request.form.get('butler_name', 'Hydrus Butler').strip(),
        'enable_log_pruning': 'enable_log_pruning' in request.form
    }
    current_app.logger.info(f"Processed form data for save: {submitted_data}")

    save_success, saved_settings_dict = save_settings_to_file(submitted_data, current_app.config)

    if save_success and saved_settings_dict:
        current_app.logger.info("Settings successfully saved to file and app config updated by save_settings_to_file.")
        schedule_rules_tick_job(current_app._get_current_object())
        current_app.logger.info("Scheduler tick job re-evaluated based on new settings.")
        schedule_log_pruning_job(current_app._get_current_object())
        current_app.logger.info("Log pruning job re-evaluated based on new settings.")

        fetch_message = ""
        if saved_settings_dict.get('hydrus_api_url'):
            current_app.logger.info("Attempting to fetch services with new settings...")
            services_list = _fetch_available_services_helper(current_app.config, "SaveSettings")
            if services_list:
                 fetch_message = f"Successfully fetched {len(services_list)} services from Hydrus."
                 current_app.logger.info(fetch_message)
            else:
                 # The outer 'if' confirmed the API URL is set, so this 'else' branch means the connection failed.
                 fetch_message = "Settings saved, but failed to fetch/parse service list from Hydrus API."
                 current_app.logger.warning(fetch_message)
        else:
            current_app.logger.info("Hydrus API URL not configured after saving. Skipping service fetch.")
            current_app.config['AVAILABLE_SERVICES'] = []
            fetch_message = "Settings saved. Hydrus API URL is not configured, so services were not fetched."

        flash(f"Settings saved. {fetch_message}", "success" if "Successfully fetched" in fetch_message or "not configured" in fetch_message else "info")
        return redirect(url_for('views.settings_page'))
    else:
        current_app.logger.error("Failed to save settings (save_settings_to_file returned false).")
        flash("Failed to write settings file. Check file permissions or logs.", "error")
        return redirect(url_for('views.settings_page'))

@views_bp.route('/get_all_services')
@hydrus_online_required
def get_all_services_route():
    services_list = current_app.config.get('AVAILABLE_SERVICES', [])
    return jsonify({"success": True, "services": services_list}), 200

@views_bp.route('/get_client_settings', methods=['GET'])
def get_client_settings_route():
    settings = current_app.config.get('HYDRUS_SETTINGS', {})
    client_settings = {
        'show_run_notifications': settings.get('show_run_notifications', True),
        'show_run_all_notifications': settings.get('show_run_all_notifications', True),
        'show_run_summary_notifications': settings.get('show_run_summary_notifications', True),
        'show_run_all_summary_notifications': settings.get('show_run_all_summary_notifications', True),
        'theme': settings.get('theme', 'default')
    }
    return jsonify({"success": True, "settings": client_settings}), 200

@views_bp.route('/favicon.ico')
def favicon():
    """Serves the favicon."""
    return send_from_directory(current_app.static_folder,
                               'images/favicon.ico', mimetype='image/vnd.microsoft.icon')

@views_bp.route('/static/<path:filename>')
def static_files_route(filename):
    try:
        return send_from_directory(current_app.static_folder, filename)
    except Exception as e:
        current_app.logger.error(f"Could not serve static file {filename}: {e}")
        return "Static file not found", 404

@views_bp.route('/api/v1/status', methods=['GET'])
def get_hydrus_status():
    status = current_app.config.get('HYDRUS_CONNECTION_STATUS', {})
    services = current_app.config.get('AVAILABLE_SERVICES', [])
    return jsonify({
        "success": True,
        "connection": status,
        "services": services
    })

@views_bp.route('/api/v1/connect', methods=['POST'])
def retry_hydrus_connection():
    current_app.logger.info("Manual Hydrus connection attempt triggered via API.")
    _retry_connection_logic()
    return get_hydrus_status()
    
    


