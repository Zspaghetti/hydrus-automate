import os
import sys
import logging
import threading
from flask import Flask
from waitress import serve 


# Initialize Logging Early
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__) # Logger for this main app.py

from app_config import (
    load_settings as app_config_load_settings,
    load_rules as app_config_load_rules
)
from database import init_db, get_db_connection
from hydrus_interface import call_hydrus_api # For initial service fetch
from views import views_bp # Import the Blueprint from the views package
from scheduler_tasks import scheduler, schedule_rules_tick_job as schedule_job_from_tasks_module, schedule_log_pruning_job

def initial_hydrus_connection_check(app):
    """
    Performs the initial Hydrus connection check in a background thread
    to avoid blocking the main application startup. Updates the global app config
    with the connection status.
    """
    logger.info("Background thread started for initial Hydrus connection check...")
    with app.app_context():
        hydrus_settings = app.config.get('HYDRUS_SETTINGS', {})
        api_url = hydrus_settings.get('hydrus_api_url')
        api_key = hydrus_settings.get('hydrus_api_key')

        if not api_url:
            logger.warning("Hydrus API address not configured. Skipping initial connection check.")
            app.config['HYDRUS_CONNECTION_STATUS'] = {'status': 'OFFLINE', 'message': 'Hydrus API URL is not configured in settings.'}
            return

        try:
            # Attempt to get services as a connection test
            services_result, http_status = call_hydrus_api(api_url, api_key, '/get_services')

            if services_result.get("success") and isinstance(services_result.get('data'), dict):
                # This is the same service parsing logic from the original startup block
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
                    app.config['AVAILABLE_SERVICES'] = services_list
                    app.config['HYDRUS_CONNECTION_STATUS'] = {'status': 'ONLINE', 'message': f"Successfully connected and fetched {len(services_list)} services."}
                    logger.info(f"Initial connection to Hydrus successful. {len(services_list)} services loaded.")
                else: # Should not happen with a valid API response, but good to handle
                     raise ConnectionError("Could not parse services object from API response.")
            else:
                # The API call was made but returned a failure (e.g., bad API key)
                error_message = services_result.get('message', 'Unknown API error')
                raise ConnectionError(f"API call failed: {error_message} (HTTP {http_status})")

        except Exception as e:
            # Catches connection errors, timeouts, or parsing errors from the try block
            logger.warning(f"Initial connection to Hydrus failed: {e}")
            app.config['HYDRUS_CONNECTION_STATUS'] = {'status': 'OFFLINE', 'message': f'Failed to connect to Hydrus: {e}'}
            app.config['AVAILABLE_SERVICES'] = [] # Ensure services are empty on failure

def create_app():
    """
    Application factory function.
    Configures and returns the Flask application instance.
    """
    logger.info("Application Starting...")

    # Determine project paths and initialize Flask app with correct folder locations.
    # This corrects the application factory pattern and sets template/static folders.
    PY_DIR = os.path.abspath(os.path.dirname(__file__))
    PROJECT_ROOT_DIR = os.path.dirname(PY_DIR)
    
    app = Flask(__name__,
                template_folder=os.path.join(PROJECT_ROOT_DIR, 'templates'),
                static_folder=os.path.join(PROJECT_ROOT_DIR, 'static'))

    logger.info(f"Project root determined as: {PROJECT_ROOT_DIR}")
    logger.info(f"Static folder set to: {app.static_folder}")
    logger.info(f"Template folder set to: {app.template_folder}")

    # Load Core Configurations
    # The results are stored in app.config
    app.config['HYDRUS_SETTINGS'] = app_config_load_settings()
    app.config['AUTOMATION_RULES'] = [] # Initialize as empty, will be populated below
    app.config['AVAILABLE_SERVICES'] = [] # Initialize as empty list

    # Initialize the connection status. It will be updated by the background thread.
    app.config['HYDRUS_CONNECTION_STATUS'] = {
        'status': 'UNKNOWN',
        'message': 'Attempting to connect to Hydrus on startup...'
    }

    # Database must be initialized before rules can be loaded, as rule sorting depends on it.
    db_conn = None
    try:
        logger.info("Attempting to initialize database...")
        init_db()
        logger.info("Database initialization process completed.")

        logger.info("Getting DB connection to load rules...")
        db_conn = get_db_connection()
        # The app_config_load_rules function now requires a db connection
        app.config['AUTOMATION_RULES'] = app_config_load_rules(db_conn)

    except Exception as e:
        logger.fatal(f"FATAL: Failed to initialize database or load rules: {e}. Application cannot start.", exc_info=True)
        if db_conn:
            db_conn.close()
        sys.exit(1) # Exit if DB initialization or rule loading fails
    finally:
        if db_conn:
            logger.info("Closing DB connection after loading rules.")
            db_conn.close()

    # Set Flask Secret Key
    secret_key_hex = app.config['HYDRUS_SETTINGS'].get('secret_key')
    if secret_key_hex:
        try:
            app.secret_key = bytes.fromhex(secret_key_hex)
            logger.info("Flask secret_key set from loaded settings.")
        except ValueError:
            logger.critical(f"CRITICAL ERROR: Could not convert secret_key from hex. Using temporary key.")
            app.secret_key = os.urandom(24)
    else:
        logger.critical("CRITICAL ERROR: No secret_key found in settings. Using temporary key.")
        app.secret_key = os.urandom(24)

    # Register Blueprints (contains all the routes)
    app.register_blueprint(views_bp)
    logger.info("Views blueprint registered.")

    # Initialize Scheduler
    scheduler.init_app(app)
    logger.info("APScheduler initialized with Flask app.")

    return app

# --- Main Execution ---
if __name__ == '__main__':
    print("---")
    print("INFO: Hydrus Automate starting up.")
    print("---")
    app_instance = create_app()
    # non-blocking background thread.
    logger.info("Starting initial Hydrus connection check in a background thread.")
    connection_thread = threading.Thread(
        target=initial_hydrus_connection_check,
        args=(app_instance,),
        daemon=True  # A daemon thread will exit when the main program exits
    )
    connection_thread.start()

    # The logic to detect the Werkzeug reloader is no longer needed.
    # We will start the scheduler directly.
    logger.info("Starting APScheduler...")
    scheduler.start()
    logger.info("APScheduler started.")
    # Initial scheduling of jobs (within app context)
    with app_instance.app_context():
        logger.info("Performing initial scheduling of rules job...")
        schedule_job_from_tasks_module(app_instance) # Pass the app_instance
        logger.info("Performing initial scheduling of log pruning job...")
        schedule_log_pruning_job(app_instance) # Pass the app_instance

    # Run the application using the Waitress production server
    host = '127.0.0.1'
    port = 5556
    logger.info(f"Starting Waitress server on http://{host}:{port}/")
    serve(
        app_instance,
        host=host,
        port=port,
        threads=8 # A sensible default for thread count
    )