# rule_processing/orchestrator.py
"""
Orchestrates the execution of a single Hydrus Butler rule.

This module contains the high-level logic for processing a rule. It coordinates
the other modules in the package to perform the necessary steps in order:
1. Initialize context and log the start of the execution.
2. Translate the rule into Hydrus search predicates.
3. Search for matching files in Hydrus.
4. Filter the matched files based on override logic and other criteria.
5. Perform the specified action on the final set of candidate files.
6. Log the results and final status to the database.
"""

import json
import uuid
import traceback
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Tuple, List, Optional


from hydrus_interface import call_hydrus_api
from database import get_db_connection, start_run_log, update_run_log_summary, log_file_event

# --- Relative imports from our new package structure ---
from .context import RuleExecutionContext
from . import translator
from . import actions
from . import overrides
from . import utils

logger = logging.getLogger(__name__)

def estimate_rule_impact(app_config, rule, is_deep_run=False, is_bypass_override=False) -> Tuple[bool, dict]:
    """
    Estimates the impact of a rule without executing actions or writing to the permanent log.

    This function simulates a rule's execution flow: translation, search, and filtering,
    then returns the counts at each stage. It's intended for UI previews.

    Args:
        app_config: The main application configuration.
        rule: The dictionary for the rule to be estimated.
        is_deep_run: Flag indicating if a 'force_in' rule should be estimated in "deep" mode.
        is_bypass_override: Flag indicating if override logic should be bypassed for this rule.

    Returns:
        A tuple of (success_boolean, result_dictionary).
        The result dictionary contains counts and debug information.
    """
    db_conn = None
    hydrus_predicates = []
    translation_warnings = []
    try:
        db_conn = get_db_connection()
        # Create a minimal, temporary context for the estimation process.
        ctx = RuleExecutionContext(
            app_config=app_config,
            db_conn=db_conn,
            rule=rule,
            run_id=str(uuid.uuid4()),  # Dummy ID for internal consistency
            rule_execution_id=str(uuid.uuid4()),  # Dummy ID
            is_manual_run=True,
            deep_run_list=[rule['id']] if is_deep_run else [],
            override_bypass_list=[rule['id']] if is_bypass_override else []
        )

        ctx.available_services = actions.ensure_services_are_loaded(ctx)
        if not ctx.available_services:
            raise Exception("Critical: Could not load Hydrus services for estimation.")

        hydrus_predicates, translation_warnings = translator.translate_rule_to_hydrus_predicates(
            ctx, force_in_special_check=is_deep_run
        )
        if any(w['level'] == 'critical' for w in translation_warnings):
            crit_warns = [w['message'] for w in translation_warnings if w['level'] == 'critical']
            raise Exception(f"Rule has critical translation warnings, cannot estimate: {', '.join(crit_warns)}")

        settings = app_config.get('HYDRUS_SETTINGS', {})
        api_address = settings.get('hydrus_api_url') or settings.get('api_address')
        api_key = settings.get('hydrus_api_key') or settings.get('api_key')

        list_of_predicate_sets = translator.prepare_sequential_searches_if_needed(hydrus_predicates)
        all_matched_hashes = set()

        for current_search_predicates in list_of_predicate_sets:
            search_api_params = {
                'tags': json.dumps(current_search_predicates), 'return_hashes': json.dumps(True), 'return_file_ids': json.dumps(False)
            }
            search_result, _ = call_hydrus_api(api_address, api_key, '/get_files/search_files', params=search_api_params)
            if not search_result.get("success"):
                raise Exception(f"Hydrus file search failed during estimation: {search_result.get('message', 'API Error')}")
            all_matched_hashes.update(search_result.get('data', {}).get('hashes', []))

        num_matched_files_by_search_raw = len(all_matched_hashes)
        eligible_hashes = all_matched_hashes

        # --- Recently Viewed Filter ---
        skipped_recent_view = 0
        last_viewed_threshold_seconds = settings.get('last_viewed_threshold_seconds', 0)
        if last_viewed_threshold_seconds > 0 and eligible_hashes:
            threshold_dt = datetime.now() - timedelta(seconds=last_viewed_threshold_seconds)
            recent_predicates = [f"system:last viewed time > {threshold_dt.strftime('%Y-%m-%d %H:%M:%S')}"]
            search_params = {'tags': json.dumps(recent_predicates), 'return_hashes': json.dumps(True)}
            recent_res, _ = call_hydrus_api(api_address, api_key, '/get_files/search_files', params=search_params)
            recently_viewed_hashes_set = set(recent_res.get('data', {}).get('hashes', [])) if recent_res.get("success") else set()

            recently_viewed_in_match = eligible_hashes.intersection(recently_viewed_hashes_set)
            skipped_recent_view = len(recently_viewed_in_match)
            eligible_hashes.difference_update(recently_viewed_in_match)

        # --- Override Filter ---
        skipped_override = 0
        final_candidate_hashes = []
        for file_hash in list(eligible_hashes):
            status, _ = overrides.check_override(ctx, file_hash)
            if status == 'skipped':
                skipped_override += 1
            else:
                final_candidate_hashes.append(file_hash)

        return True, {
            "message": "Estimation successful.",
            "raw_search_matches": num_matched_files_by_search_raw,
            "skipped_recent_view": skipped_recent_view,
            "skipped_override": skipped_override,
            "estimated_actionable_files": len(final_candidate_hashes),
            "translation_warnings": translation_warnings,
            "search_predicates": hydrus_predicates
        }
    except Exception as e:
        return False, {
            "message": str(e),
            "raw_search_matches": 0, "skipped_recent_view": 0, "skipped_override": 0,
            "estimated_actionable_files": 0, "translation_warnings": translation_warnings, "search_predicates": hydrus_predicates
        }
    finally:
        if db_conn:
            db_conn.close()


def execute_single_rule(app_config, db_conn, rule, current_run_id, execution_order_in_run, is_manual_run: bool, override_bypass_list: Optional[List[str]] = None, deep_run_list: Optional[List[str]] = None):
    """
    Main function to execute a single rule's logic from start to finish.
    """
    rule_execution_id = str(uuid.uuid4())
    try:
        ctx = RuleExecutionContext(
            app_config=app_config,
            db_conn=db_conn,
            rule=rule,
            run_id=current_run_id,
            rule_execution_id=rule_execution_id,
            is_manual_run=is_manual_run,
            override_bypass_list=override_bypass_list,
            deep_run_list=deep_run_list
        )
    except ValueError as e:
        logger.critical(f"Failed to create RuleExecutionContext: {e}")
        return {"success": False, "message": str(e)}

    manual_run_log_str = "(Manual Run)"
    log_prefix = f"RuleExec ID {ctx.rule_execution_id[:8]} (Rule '{ctx.rule_name}', RunID {ctx.run_id[:8]})"
    logger.info(f"{log_prefix}: Executing (Importance: {ctx.rule_importance}, Type: {ctx.action_type}) {manual_run_log_str}")

    # Initialize tracking variables and final details object
    final_details = utils.create_default_details()
    num_matched_files_by_search_raw = 0
    files_to_attempt_action_on = []
    succeeded_count_total = 0
    failed_count_total = 0
    overall_rule_success_flag = True
    final_summary_message_str = f"Rule '{ctx.rule_name}' processing started."

    try:
        # --- 1. PREPARATION AND LOGGING ---
        start_run_log(db_conn, ctx.rule_execution_id, ctx.run_id, ctx.rule, execution_order_in_run)
        # --- FIX: Commit the initial log entry immediately to release the database lock ---
        db_conn.commit()

        # Ensure services are loaded and attach to context for other modules to use
        ctx.available_services = actions.ensure_services_are_loaded(ctx)
        if not ctx.available_services:
            raise Exception("Critical - Could not load Hydrus services. Aborting.")

        # --- 2. TRANSLATION ---
        is_deep_run = ctx.action_type == 'force_in' and ctx.rule_id in ctx.deep_run_list
        hydrus_predicates, translation_warnings = translator.translate_rule_to_hydrus_predicates(
            ctx, force_in_special_check=is_deep_run
        )
        final_details["translation_warnings"] = translation_warnings
        if any(w['level'] == 'critical' for w in translation_warnings):
            crit_warns = [w['message'] for w in translation_warnings if w['level'] == 'critical']
            error_details = "\n - ".join(crit_warns)
            raise Exception(
                f"Rule aborted for safety due to critical configuration issues:\n - {error_details}"
            )

        # --- 3 SEARCH ---
        settings = app_config.get('HYDRUS_SETTINGS', {})
        api_address = settings.get('hydrus_api_url') or settings.get('api_address')
        api_key = settings.get('hydrus_api_key') or settings.get('api_key')

        list_of_predicate_sets = translator.prepare_sequential_searches_if_needed(hydrus_predicates)
        all_matched_hashes = set()

        logger.info(f"{log_prefix}: Searching Hydrus with {len(list_of_predicate_sets)} predicate set(s).")
        for i, current_search_predicates in enumerate(list_of_predicate_sets):
            logger.info(f"{log_prefix}: Search {i+1}/{len(list_of_predicate_sets)}: {str(current_search_predicates)}")
            search_api_params = {
                'tags': json.dumps(current_search_predicates),
                'return_hashes': json.dumps(True),
                'return_file_ids': json.dumps(False)
            }
            search_result, _ = call_hydrus_api(api_address, api_key, '/get_files/search_files', params=search_api_params)

            if not search_result.get("success"):
                if len(list_of_predicate_sets) > 1:
                    logger.warning(f"{log_prefix}: Sequential search {i+1} failed and was skipped: {search_result.get('message', 'API Error')}")
                    continue
                else:
                    raise Exception(f"Hydrus file search failed: {search_result.get('message', 'API Error')}")

            all_matched_hashes.update(search_result.get('data', {}).get('hashes', []))

        matched_hashes_raw = list(all_matched_hashes)
        num_matched_files_by_search_raw = len(matched_hashes_raw)
        logger.info(f"{log_prefix}: Hydrus search returned {num_matched_files_by_search_raw} raw matches.")

        # --- 4. FILTERING ---
        eligible_hashes_after_view_filter = []
        last_viewed_threshold_seconds = settings.get('last_viewed_threshold_seconds', 0)
        if last_viewed_threshold_seconds > 0:
            threshold_dt = datetime.now() - timedelta(seconds=last_viewed_threshold_seconds)
            recent_predicates = [f"system:last viewed time > {threshold_dt.strftime('%Y-%m-%d %H:%M:%S')}"]
            search_params = {'tags': json.dumps(recent_predicates), 'return_hashes': json.dumps(True)}
            recent_res, _ = call_hydrus_api(api_address, api_key, '/get_files/search_files', params=search_params)
            recently_viewed_hashes_set = set(recent_res.get('data', {}).get('hashes', [])) if recent_res.get("success") else set()

            for h in matched_hashes_raw:
                if h in recently_viewed_hashes_set:
                    final_details["files_skipped_due_to_recent_view"] += 1
                    log_file_event(db_conn, ctx.rule_execution_id, h, "skipped_recent_view", {"reason": "File was viewed recently"})
                else:
                    eligible_hashes_after_view_filter.append(h)
        else:
            eligible_hashes_after_view_filter = matched_hashes_raw

        for file_hash in eligible_hashes_after_view_filter:
            status, reason = overrides.check_override(ctx, file_hash)
            if status == 'skipped':
                final_details["files_skipped_due_to_override"] += 1
                log_file_event(db_conn, ctx.rule_execution_id, file_hash, "skipped_override", {"reason": reason})
            else:
                files_to_attempt_action_on.append(file_hash)

        logger.info(
            f"{log_prefix}: After filters -> View: {final_details['files_skipped_due_to_recent_view']} skipped, "
            f"Override: {final_details['files_skipped_due_to_override']} skipped. "
            f"Proceeding with {len(files_to_attempt_action_on)} candidates."
        )

        # --- 5. ACTION ---
        if files_to_attempt_action_on:
            action_data = ctx.action
            action_type = ctx.action_type
            logger.info(f"{log_prefix}: Attempting '{action_type}' for {len(files_to_attempt_action_on)} files.")

            if action_type == 'add_to':
                dest_keys = action_data.get('destination_service_keys', [])
                result = actions.add_to_services(ctx, files_to_attempt_action_on, dest_keys)
                succeeded_hashes = list(set(files_to_attempt_action_on) - set(result.get('files_with_some_errors', {}).keys()))
                succeeded_count_total = len(succeeded_hashes)
                failed_count_total = len(result.get('files_with_some_errors', {}))
                if failed_count_total > 0: overall_rule_success_flag = False

                final_details["action_processing_results"].append({**result, "action_type": action_type})

                for h in succeeded_hashes:
                    log_file_event(db_conn, ctx.rule_execution_id, h, "success", {"action": action_type, "destinations": dest_keys})
                    overrides.update_state_after_success(ctx, h)
                for h, errs in result.get('files_with_some_errors', {}).items():
                    log_file_event(db_conn, ctx.rule_execution_id, h, "failure", {"action": action_type, "errors": errs}, str(errs))

            elif action_type == 'force_in':
                dest_keys = action_data.get('destination_service_keys', [])
                meta_list, meta_errs = actions.fetch_metadata(ctx, files_to_attempt_action_on)
                final_details["metadata_errors"].extend(meta_errs)

                result = actions.force_in_services(ctx, meta_list, dest_keys)
                succeeded_hashes = result.get("files_fully_successful", [])
                succeeded_count_total = len(succeeded_hashes)
                failed_count_total = len(result.get("files_with_errors", {}))
                if failed_count_total > 0: overall_rule_success_flag = False

                final_details["action_processing_results"].append({**result, "action_type": action_type})

                for h in succeeded_hashes:
                    log_file_event(db_conn, ctx.rule_execution_id, h, "success", {"action": action_type, "destinations": dest_keys})
                    overrides.update_state_after_success(ctx, h)
                for h, err_detail in result.get("files_with_errors", {}).items():
                    log_file_event(db_conn, ctx.rule_execution_id, h, "failure", {"action": action_type, "failure_details": err_detail}, str(err_detail))

            elif action_type in ['add_tags', 'remove_tags']:
                mode = 0 if action_type == 'add_tags' else 1
                result = actions.manage_tags(ctx, files_to_attempt_action_on, action_data['tag_service_key'], action_data['tags_to_process'], mode)
                final_details["action_processing_results"].append({**result, "action_type": action_type})
                if result.get("success"):
                    succeeded_count_total = len(files_to_attempt_action_on)
                    log_status = "success"
                else:
                    overall_rule_success_flag = False
                    failed_count_total = len(files_to_attempt_action_on)
                    log_status = "failure"
                for h in files_to_attempt_action_on:
                    log_file_event(db_conn, ctx.rule_execution_id, h, log_status, {"action": action_type, **action_data}, result.get("message"))

            elif action_type == 'modify_rating':
                succeeded_hashes = []
                for h in files_to_attempt_action_on:
                    result = actions.modify_rating(ctx, h, action_data['rating_service_key'], action_data['rating_value'])
                    final_details["action_processing_results"].append({**result, "hash": h, "action_type": action_type})
                    if result.get("success"):
                        succeeded_hashes.append(h)
                        log_file_event(db_conn, ctx.rule_execution_id, h, "success", {"action": action_type, **action_data})
                        overrides.update_state_after_success(ctx, h)
                    else:
                        overall_rule_success_flag = False
                        failed_count_total += 1
                        log_file_event(db_conn, ctx.rule_execution_id, h, "failure", {"action": action_type, **action_data}, result.get("message"))
                succeeded_count_total = len(succeeded_hashes)

        # --- 6. FINAL SUMMARY ---
        if num_matched_files_by_search_raw == 0:
            final_summary_message_str = "Completed. No files matched the search criteria."
        elif not files_to_attempt_action_on:
            final_summary_message_str = f"Completed. All {num_matched_files_by_search_raw} matched files were filtered out."
        elif overall_rule_success_flag:
            final_summary_message_str = f"Completed successfully. Action '{ctx.action_type}' applied to {succeeded_count_total} of {len(files_to_attempt_action_on)} candidates."
        else:
            final_summary_message_str = f"Completed with errors. Succeeded for {succeeded_count_total}, failed for {failed_count_total} of {len(files_to_attempt_action_on)} candidates."

        logger.info(f"{log_prefix}: {final_summary_message_str}")

    except Exception as main_exc:
        overall_rule_success_flag = False
        final_summary_message_str = str(main_exc)
        logger.error(f"{log_prefix}: CRITICAL EXCEPTION: {final_summary_message_str}", exc_info=True)
        final_details["critical_error"] = str(main_exc)
        final_details["critical_error_traceback_summary"] = traceback.format_exc(limit=3)

    finally:
        # --- 7. FINAL DATABASE UPDATE ---
        # Increment the run counter for scheduled runs AFTER the execution attempt is complete.
        if not ctx.is_manual_run:
            from database import increment_rule_run_count
            increment_rule_run_count(db_conn, ctx.rule_id)

        final_status = "success_completed" if overall_rule_success_flag else "failure_critical"
        try:
            counts = {
                'matched': num_matched_files_by_search_raw,
                'eligible': len(files_to_attempt_action_on),
                'succeeded': succeeded_count_total,
                'failed': failed_count_total
            }
            details_json_db = json.dumps(final_details)
            update_run_log_summary(
                db_conn, ctx.rule_execution_id, final_status, counts,
                final_summary_message_str, details_json_db
            )
            db_conn.commit()
        except sqlite3.Error as e_db_final:
            logger.error(f"{log_prefix}: DB Error during final UPDATE: {e_db_final}")
            db_conn.rollback()

    return {
        "success": overall_rule_success_flag, "message": final_summary_message_str,
        "rule_id": ctx.rule_id, "rule_name": ctx.rule_name,
        "rule_execution_id_for_log": ctx.rule_execution_id,
        "action_performed": ctx.action_type,
        "files_matched_by_search": num_matched_files_by_search_raw,
        "files_action_attempted_on": len(files_to_attempt_action_on),
        "files_succeeded_count": succeeded_count_total,
        "files_skipped_due_to_override": final_details['files_skipped_due_to_override'],
        "files_skipped_due_to_recent_view": final_details['files_skipped_due_to_recent_view'],
        "details": final_details

    }
