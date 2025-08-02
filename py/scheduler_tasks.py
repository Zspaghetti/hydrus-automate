import logging
from datetime import datetime, timedelta
import uuid  # For run_id
import os

from flask_apscheduler import APScheduler
from rule_processing.orchestrator import execute_single_rule
from database import get_all_set_data, get_db_connection, mark_rule_as_run, get_rules_first_run_status, prune_duplicate_logs, get_app_state, set_app_state, get_last_run_timestamp_for_rule
from app_config import load_rules as app_config_load_rule

logger = logging.getLogger(__name__)
scheduler = APScheduler()

def _should_perform_deep_run(db_conn, rule):
    """
    Determines if a 'force_in' rule should perform its special deep check based on its configuration.
    This function has NO side effects.
    """
    rule_id = rule['id']
    rule_name = rule.get('name', rule_id)
    
    frequency = rule.get('force_in_check_frequency', 'first_run_only')

    if frequency == 'always':
        logger.info(f"Deep run for '{rule_name}': Frequency is 'always'. Performing deep run.")
        return True
    
    if frequency == 'never':
        logger.info(f"Deep run for '{rule_name}': Frequency is 'never'. Skipping deep run.")
        return False

    if frequency == 'every_x_runs':
        interval = rule.get('force_in_check_interval_runs')
        run_count = rule.get('run_count', 0)
        
        if not isinstance(interval, int) or interval <= 0:
            logger.warning(f"Deep run for '{rule_name}': Mode is 'every_x_runs' but interval is invalid ({interval}). Skipping deep run.")
            return False
        
        # We check if the *next* run (current run_count + 1) is a multiple of the interval.
        # This makes the logic intuitive: if interval is 5, it runs on the 5th, 10th, 15th... execution.
        # A run_count of 4 means the next run is the 5th.
        if (run_count + 1) % interval == 0:
            logger.info(f"Deep run for '{rule_name}': Mode is 'every {interval} runs' and current run count is {run_count}. Performing deep run for execution #{run_count + 1}.")
            return True
        else:
            logger.info(f"Deep run for '{rule_name}': Mode is 'every {interval} runs', current run count is {run_count}. Not due for deep run.")
            return False

    # Default case: frequency == 'first_run_only'
    run_count = rule.get('run_count', 0)
    if run_count == 0:
        logger.info(f"Deep run for '{rule_name}': Frequency is 'first_run_only' and rule has a run_count of 0. Performing deep run.")
        return True
    
    logger.info(f"Deep run for '{rule_name}': Frequency is 'first_run_only' but rule has already run (run_count > 0). Skipping deep run.")
    return False

def run_log_pruning_job(app):
    """
    Scheduled job that connects to the database and prunes old, duplicate log entries.
    """
    with app.app_context():
        logger.info("--- Log Pruning Job: Starting daily check ---")
        db_conn = None
        try:
            db_conn = get_db_connection()
            # The prune_duplicate_logs function handles its own logging and commit/rollback.
            deleted_count = prune_duplicate_logs(db_conn)
            if deleted_count > 0:
                logger.info(f"Log Pruning Job: Successfully pruned {deleted_count} log entries.")
            elif deleted_count == 0:
                logger.info("Log Pruning Job: No log entries needed pruning.")
            else: # deleted_count is -1 on error
                logger.error("Log Pruning Job: The pruning task encountered a database error.")
        except Exception as e:
            logger.error(f"Log Pruning Job: Unhandled exception during execution: {e}", exc_info=True)
        finally:
            if db_conn:
                db_conn.close()
            logger.info("--- Log Pruning Job: Finished ---")


def schedule_log_pruning_job(app):
    """
    Manages the APScheduler job for daily log pruning.
    Adds or removes the job based on the 'enable_log_pruning' setting.
    """
    settings = app.config.get('HYDRUS_SETTINGS', {})
    pruning_enabled = settings.get('enable_log_pruning', False)
    job_id = 'log_pruning_job'

    global scheduler
    if scheduler.get_job(job_id):
        logger.info(f"Scheduler: Removing existing job '{job_id}'.")
        scheduler.remove_job(job_id)

    if pruning_enabled:
        logger.info(f"Scheduler: Scheduling job '{job_id}' to run daily at 03:00 local time.")
        scheduler.add_job(
            id=job_id,
            func=run_log_pruning_job,
            args=[app],
            trigger='cron',
            hour=3,
            minute=0,
            replace_existing=True,
            misfire_grace_time=3600  # Allow job to run up to 1 hour late
        )
    else:
        logger.info(f"Scheduler: Log pruning is disabled. Job '{job_id}' will not be scheduled.")

def run_rules_tick_job(app):
    """
    Scheduled "tick" job that uses the database for all state management.
    It determines which rules to run based on a hierarchy:
    1. A rule's individual 'custom' schedule.
    2. A rule's set's 'custom' schedule.
    3. The global default schedule.
    A rule is triggered if *any* of its applicable schedules are due.
    """
    with app.app_context():
        tick_start_time = datetime.utcnow()
        logger.debug(f"--- Scheduler Tick at {tick_start_time.strftime('%Y-%m-%d %H:%M:%S UTC')} ---")

        db_conn = None
        try:
            db_conn = get_db_connection()
            current_settings = app.config['HYDRUS_SETTINGS']
            global_interval = current_settings.get('rule_interval_seconds', 0)
            
            all_rules = app_config_load_rule(db_conn)
            set_data = get_all_set_data(db_conn)

            if not all_rules:
                logger.debug("No rules defined. Skipping tick processing.")
                return

            rules_to_run_ids = set()
            sets_triggered_this_tick = set()

            def is_due(last_run_iso, interval_sec, current_time):
                if not last_run_iso: return True
                if not isinstance(interval_sec, int) or interval_sec <= 0: return False
                try:
                    last_run_dt = datetime.fromisoformat(str(last_run_iso).replace('Z', ''))
                    return current_time >= last_run_dt + timedelta(seconds=interval_sec)
                except (ValueError, TypeError):
                    logger.warning(f"Could not parse last_run_iso '{last_run_iso}'. Scheduling to run now.")
                    return True

            custom_timed_set_ids = {
                s['id'] for s in set_data.get('sets', [])
                if s.get('execution_override') == 'custom' and s.get('interval_seconds', 0) > 0
            }
            rules_governed_by_sets = {
                assoc['rule_id'] for assoc in set_data.get('associations', [])
                if assoc['set_id'] in custom_timed_set_ids
            }

            for rule in all_rules:
                if rule.get('execution_override') == 'custom' and rule.get('interval_seconds', 0) > 0:
                    last_run = get_last_run_timestamp_for_rule(db_conn, rule['id'])
                    if is_due(last_run, rule['interval_seconds'], tick_start_time):
                        rules_to_run_ids.add(rule['id'])
            
            for a_set in set_data.get('sets', []):
                if a_set['id'] in custom_timed_set_ids:
                    last_set_run = get_app_state(db_conn, f"last_run_ts_set_{a_set['id']}")
                    if is_due(last_set_run, a_set['interval_seconds'], tick_start_time):
                        sets_triggered_this_tick.add(a_set['id'])
                        for assoc in set_data.get('associations', []):
                            if assoc['set_id'] == a_set['id']:
                                rules_to_run_ids.add(assoc['rule_id'])
            
            if global_interval > 0:
                for rule in all_rules:
                    is_custom_rule = rule.get('execution_override') == 'custom' and rule.get('interval_seconds', 0) > 0
                    is_in_custom_set = rule['id'] in rules_governed_by_sets
                    if not is_custom_rule and not is_in_custom_set:
                        last_run = get_last_run_timestamp_for_rule(db_conn, rule['id'])
                        if is_due(last_run, global_interval, tick_start_time):
                            rules_to_run_ids.add(rule['id'])

            rules_to_run_this_tick = [rule for rule in all_rules if rule['id'] in rules_to_run_ids]

            if not rules_to_run_this_tick:
                logger.debug("Tick finished. No rules were due to run.")
                return

            logger.info(f"Scheduler Tick: {len(rules_to_run_this_tick)} unique rule(s) are due for execution.")
            
            parent_run_id = f"scheduled_tick_{uuid.uuid4()}"

            # Note: A separate connection is used for each rule execution to ensure isolation
            # and prevent a single failure from halting the entire tick.
            for i, rule in enumerate(rules_to_run_this_tick):
                rule_db_conn = None
                try:
                    rule_name_log = rule.get('name', rule.get('id', 'Unnamed'))
                    logger.info(f"\nScheduler (Parent Run {parent_run_id[:8]}): Executing Due Rule {i+1}/{len(rules_to_run_this_tick)}: '{rule_name_log}'")
                    
                    rule_db_conn = get_db_connection()
                    is_force_in_rule = rule.get('action', {}).get('type') == 'force_in'
                    force_in_special_check = False

                    if is_force_in_rule:
                        force_in_special_check = _should_perform_deep_run(rule_db_conn, rule)

                    # (Assuming Bug 1 fix is already applied to this call)
                    deep_run_rules = [rule['id']] if force_in_special_check else []
                    execute_single_rule(
                        app_config=app.config, db_conn=rule_db_conn, rule=rule,
                        current_run_id=parent_run_id, execution_order_in_run=i + 1,
                        is_manual_run=False,
                        deep_run_list=deep_run_rules
                    )

                except Exception as e:
                    logger.error(f"Scheduler-level unhandled error during execution of rule '{rule.get('name')}': {e}", exc_info=True)
                finally:
                    if rule_db_conn:
                        rule_db_conn.close()
            
            # --- Update state in the database at the end ---
            for set_id in sets_triggered_this_tick:
                set_app_state(db_conn, f"last_run_ts_set_{set_id}", tick_start_time.isoformat() + "Z")
            
            db_conn.commit()
            logger.info(f"--- Scheduler Tick (Parent Run {parent_run_id[:8]}) Finished ---")

        except Exception as e:
            logger.error(f"Scheduler tick job failed: {e}", exc_info=True)
            if db_conn: db_conn.rollback()
        finally:
            if db_conn:
                db_conn.close()


def schedule_rules_tick_job(app):
    """
    Manages the APScheduler tick job. This job runs at a fixed interval
    to check which rules are due.
    """
    settings = app.config.get('HYDRUS_SETTINGS', {})
    # The tick job should run if the global interval is set, or if ANY rule
    # or ANY set has a custom interval defined.
    db_conn = None
    rules = []
    set_data = {}
    try:
        db_conn = get_db_connection()
        rules = app_config_load_rule(db_conn)
        set_data = get_all_set_data(db_conn)
    finally:
        if db_conn:
            db_conn.close()

    # The 'execution_override' is a simple string 'custom', not a dict.
    has_custom_rule_interval = any(r.get('execution_override') == 'custom' for r in rules)
    has_custom_set_interval = any(s.get('execution_override') == 'custom' for s in set_data.get('sets', []))
    global_interval_enabled = settings.get('rule_interval_seconds', 0) > 0

    job_id = 'rules_tick_job'
    tick_interval_seconds = 10  # A fixed, short interval for checking.
    initial_delay_seconds = 30
    
    global scheduler
    if scheduler.get_job(job_id):
        logger.info(f"Scheduler: Removing existing job '{job_id}'.")
        scheduler.remove_job(job_id)

    if global_interval_enabled or has_custom_rule_interval or has_custom_set_interval:
        first_run_time = datetime.now() + timedelta(seconds=initial_delay_seconds)
        logger.info(f"Scheduler: Scheduling job '{job_id}' to run in {initial_delay_seconds} seconds (at {first_run_time.strftime('%Y-%m-%d %H:%M:%S')}) and then every {tick_interval_seconds} seconds.")
        
        scheduler.add_job(
            id=job_id,
            func=run_rules_tick_job,
            args=[app],
            trigger='interval',
            seconds=tick_interval_seconds,
            next_run_time=first_run_time,
            replace_existing=True,
            misfire_grace_time=30 
        )
    else:
        logger.info(f"Scheduler: Global rule interval is disabled and no rules have custom intervals. Tick job will not be scheduled.")