# rule_processing/actions.py
"""
Contains functions for performing actions via the Hydrus API.

This module acts as the API interaction layer for the rule processing engine.
It includes functions for fetching data (like services and metadata) and executing
state-changing actions on files (like adding/removing tags, moving files,
and modifying ratings). These functions are called by the orchestrator after
search and filtering logic is complete.
"""

import json
import logging
from typing import List, Dict, Any, Tuple

from hydrus_interface import call_hydrus_api
from .context import RuleExecutionContext

logger = logging.getLogger(__name__)


def batch_api_call_with_retry(
    ctx: RuleExecutionContext,
    endpoint: str,
    method: str,
    items_to_process: list,
    batch_size: int,
    batch_payload_formatter,
    single_item_payload_formatter,
    action_description: str,
    timeout_per_call: int = 120
) -> Dict[str, list]:
    """
    Helper for batch API calls with individual retries on batch failure.

    Args:
        ctx: The RuleExecutionContext for API settings and logging context.
        endpoint: The Hydrus API endpoint to call.
        method: The HTTP method (e.g., 'POST').
        items_to_process: The list of items (e.g., hashes) to process.
        batch_size: The number of items to include in each batch call.
        batch_payload_formatter: A lambda that formats a list of items into a batch payload.
        single_item_payload_formatter: A lambda that formats a single item for retry calls.
        action_description: A string describing the action for logging.
        timeout_per_call: Timeout in seconds for each API call.

    Returns:
        A dictionary with 'successful_items' and 'failed_items_with_errors'.
    """
    settings = ctx.app_config.get('HYDRUS_SETTINGS', {})
    api_address = settings.get('hydrus_api_url') or settings.get('api_address')
    api_key = settings.get('hydrus_api_key') or settings.get('api_key')

    successful_items = []
    failed_items_with_errors = []

    if not items_to_process:
        return {"successful_items": [], "failed_items_with_errors": []}

    if not api_address:
        logger.error(f"Rule '{ctx.rule_name}': API address not set for batch API call '{action_description}'.")
        for item in items_to_process:
            failed_items_with_errors.append((item, "API address not configured.", None))
        return {"successful_items": [], "failed_items_with_errors": failed_items_with_errors}

    logger.info(f"Rule '{ctx.rule_name}': Batch processing {len(items_to_process)} items for '{action_description}' (batch size {batch_size}).")

    for i in range(0, len(items_to_process), batch_size):
        batch_items = items_to_process[i : i + batch_size]
        batch_num = (i // batch_size) + 1

        if not batch_items: continue

        batch_payload = batch_payload_formatter(batch_items)
        batch_result, batch_status = call_hydrus_api(
            api_address, api_key, endpoint, method=method,
            json_data=batch_payload, timeout=timeout_per_call
        )

        if batch_result.get("success"):
            successful_items.extend(batch_items)
        else:
            batch_err_msg = batch_result.get('message', f"Unknown API error for batch {batch_num}")
            logger.warning(f"Rule '{ctx.rule_name}': Batch {batch_num} for '{action_description}' failed: {batch_err_msg}. Status: {batch_status}. Retrying individually...")
            for single_item in batch_items:
                single_payload = single_item_payload_formatter(single_item)
                retry_result, retry_status = call_hydrus_api(
                    api_address, api_key, endpoint, method=method,
                    json_data=single_payload, timeout=timeout_per_call
                )
                if retry_result.get("success"):
                    successful_items.append(single_item)
                else:
                    retry_err_msg = retry_result.get('message', f"Unknown API error for item {str(single_item)[:50]}")
                    logger.warning(f"Rule '{ctx.rule_name}': Retry for item '{str(single_item)[:50]}' (batch {batch_num}) failed: {retry_err_msg}. Status: {retry_status}")
                    failed_items_with_errors.append((single_item, retry_err_msg, retry_status))

    logger.info(f"Rule '{ctx.rule_name}': Batch '{action_description}' complete. Succeeded: {len(successful_items)}, Failed: {len(failed_items_with_errors)}.")
    if failed_items_with_errors:
        logger.debug(f"  Failed items/errors for '{action_description}': {failed_items_with_errors}")
    return {"successful_items": successful_items, "failed_items_with_errors": failed_items_with_errors}


def ensure_services_are_loaded(ctx: RuleExecutionContext) -> List[Dict[str, Any]]:
    """
    Ensures Hydrus services list is loaded, fetching if necessary.
    Uses app_config for HYDRUS_SETTINGS and to cache AVAILABLE_SERVICES.
    """
    available_services_cache = ctx.app_config.get('AVAILABLE_SERVICES')
    if isinstance(available_services_cache, list) and available_services_cache:
        return available_services_cache

    log_prefix = f"Rule '{ctx.rule_name}'"
    logger.info(f"{log_prefix}: Available services cache empty or invalid. Attempting to fetch.")

    settings = ctx.app_config.get('HYDRUS_SETTINGS', {})
    api_address = settings.get('hydrus_api_url') or settings.get('api_address')
    api_key = settings.get('hydrus_api_key') or settings.get('api_key')

    if not api_address:
        logger.warning(f"{log_prefix}: Hydrus API address not configured. Cannot fetch services.")
        ctx.app_config['AVAILABLE_SERVICES'] = []
        return []

    services_result, _ = call_hydrus_api(api_address, api_key, '/get_services')

    if services_result.get("success"):
        services_data = services_result.get('data')
        if isinstance(services_data, dict):
            services_object = services_data.get('services')
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
                    else:
                        logger.warning(f"{log_prefix}: Service details for key '{key}' not a dict. Skipping.")
                ctx.app_config['AVAILABLE_SERVICES'] = services_list
                logger.info(f"{log_prefix}: Fetched and cached {len(services_list)} services.")
                return services_list
            else:
                logger.error(f"{log_prefix} failed: 'services' object not a dict. Data: {str(services_data)[:500]}")
        else:
            logger.error(f"{log_prefix} failed: 'data' field not a dict. Result: {str(services_result)[:500]}")
    else:
        logger.error(f"{log_prefix} failed: API call /get_services: {services_result.get('message', 'Unknown API error')}")

    ctx.app_config['AVAILABLE_SERVICES'] = []
    return []


def fetch_metadata(ctx: RuleExecutionContext, hashes_list: List[str], batch_size: int = 256) -> Tuple[list, list]:
    """Fetches metadata for file hashes in batches."""
    all_files_metadata = []
    metadata_errors_list = []
    num_hashes = len(hashes_list)

    if num_hashes == 0:
        return [], []

    logger.info(f"Rule '{ctx.rule_name}': Fetching metadata for {num_hashes} files (batch size {batch_size}).")
    settings = ctx.app_config.get('HYDRUS_SETTINGS', {})
    api_address = settings.get('hydrus_api_url') or settings.get('api_address')
    api_key = settings.get('hydrus_api_key') or settings.get('api_key')

    if not api_address:
        logger.error(f"Rule '{ctx.rule_name}': API address not set for metadata fetch.")
        return [], [{"message": "API address not configured.", "hashes_in_batch": hashes_list, "status_code": None}]

    for i in range(0, num_hashes, batch_size):
        batch_hashes = hashes_list[i : i + batch_size]
        params = {
            'hashes': json.dumps(batch_hashes),
            'include_services_object': json.dumps(True)
        }
        result, status = call_hydrus_api(api_address, api_key, '/get_files/file_metadata', params=params)

        if result.get("success") and isinstance(result.get('data'), dict):
            batch_metadata = result.get('data', {}).get('metadata', [])
            all_files_metadata.extend(batch_metadata)
        else:
            msg = f"Metadata fetch failed for a batch: {result.get('message', 'Unknown API error')}"
            logger.warning(f"Rule '{ctx.rule_name}': {msg}")
            metadata_errors_list.append({"message": msg, "hashes_in_batch": batch_hashes, "status_code": status})

    logger.info(f"Rule '{ctx.rule_name}': Metadata fetch complete. Retrieved for {len(all_files_metadata)} of {num_hashes} files.")
    if metadata_errors_list:
        logger.warning(f"Rule '{ctx.rule_name}': {len(metadata_errors_list)} metadata fetch errors.")
    return all_files_metadata, metadata_errors_list


def add_to_services(ctx: RuleExecutionContext, file_hashes: List[str], destination_service_keys: List[str], batch_size: int = 64) -> Dict[str, Any]:
    """Performs 'add_to' action for files in batches."""
    if not file_hashes or not destination_service_keys:
        return {"success": True, "total_successful_migrations": 0, "total_failed_migrations": 0, "files_with_some_errors": {}, "overall_errors": []}

    overall_success_flag = True
    total_successful_migrations = 0
    total_failed_migrations = 0
    files_with_errors_map = {}
    endpoint = '/add_files/migrate_files'

    for dest_key in destination_service_keys:
        logger.info(f"Rule '{ctx.rule_name}': Processing 'add_to' for service '{dest_key}' for {len(file_hashes)} files.")
        batch_results = batch_api_call_with_retry(
            ctx, endpoint, 'POST', file_hashes, batch_size,
            lambda batch_h: {"hashes": batch_h, "file_service_key": dest_key},
            lambda single_h: {"hash": single_h, "file_service_key": dest_key},
            f"add files to service '{dest_key}'", timeout_per_call=180
        )
        total_successful_migrations += len(batch_results["successful_items"])
        if batch_results["failed_items_with_errors"]:
            overall_success_flag = False
            total_failed_migrations += len(batch_results["failed_items_with_errors"])
            for h, msg, status in batch_results["failed_items_with_errors"]:
                files_with_errors_map.setdefault(h, []).append({"destination_service_key": dest_key, "message": msg, "status_code": status})

    return {"success": overall_success_flag, "total_successful_migrations": total_successful_migrations,
            "total_failed_migrations": total_failed_migrations, "files_with_some_errors": files_with_errors_map, "overall_errors": []}


def force_in_services(ctx: RuleExecutionContext, files_metadata_list: List[Dict], rule_configured_destination_keys: List[str], batch_size: int = 64) -> Dict[str, Any]:
    """
    Performs 'force_in' action in batches (copy, verify, delete).
    
    Args:
        ctx: The execution context.
        files_metadata_list: List of metadata objects for candidate files.
        rule_configured_destination_keys: The destinations defined in this specific force_in rule.
        batch_size: The size for batch API calls.
        
    Returns:
        A dictionary summarizing the result of the operation.
    """
    initial_candidates = len(files_metadata_list)
    if not files_metadata_list:
        return {"success": True, "files_fully_successful": [], "files_with_errors": {}, "summary_counts": {"initial_candidates":0, "copied_phase_success_count":0, "verified_phase_success_count":0, "deleted_phase_success_count":0}, "overall_errors": []}

    if not isinstance(rule_configured_destination_keys, list) or not rule_configured_destination_keys or not all(isinstance(k, str) and k.strip() for k in rule_configured_destination_keys):
        msg = (f"Rule '{ctx.rule_name}': 'force_in' action was called with invalid or empty destination keys. "
               f"This is a critical safety violation. Aborting 'force_in' operation. "
               f"Keys provided: {rule_configured_destination_keys}")
        logger.critical(msg)
        return {"success": False, "files_fully_successful": [], "files_with_errors": {},
                "summary_counts": {"initial_candidates": initial_candidates, "copied_phase_success_count": 0, "verified_phase_success_count": 0, "deleted_phase_success_count": 0},
                "overall_errors": [msg]}

    # We need the full list of local services to know what to delete from.
    all_local_service_keys_set = {s['service_key'] for s in ctx.available_services if s.get('type') == 2}

    files_with_errors_map = {}
    candidate_hashes = [fm.get('hash') for fm in files_metadata_list if fm.get('hash')]

    # Phase 1: Copy
    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Phase 1 (Copy) for {len(candidate_hashes)} files to {rule_configured_destination_keys}")
    hashes_copied_to_all_dests = set(candidate_hashes)
    for dest_key in rule_configured_destination_keys:
        if not hashes_copied_to_all_dests: break
        copy_results = batch_api_call_with_retry(
            ctx, '/add_files/migrate_files', 'POST', list(hashes_copied_to_all_dests), batch_size,
            lambda bh: {"hashes": bh, "file_service_key": dest_key},
            lambda sh: {"hash": sh, "file_service_key": dest_key},
            f"ForceIn-Copy to '{dest_key}'", timeout_per_call=180
        )
        for h, msg, status in copy_results["failed_items_with_errors"]:
            hashes_copied_to_all_dests.discard(h)
            files_with_errors_map.setdefault(h, {"phase": "copy", "errors": []})["errors"].append({"service_key": dest_key, "message": f"Copy fail: {msg}", "status_code": status})
    copied_count = len(hashes_copied_to_all_dests)
    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Phase 1 (Copy) complete. {copied_count} files potentially copied.")
    if not hashes_copied_to_all_dests:
        return {"success": False, "files_fully_successful": [], "files_with_errors": files_with_errors_map, "summary_counts": {"initial_candidates":initial_candidates, "copied_phase_success_count":0, "verified_phase_success_count":0, "deleted_phase_success_count":0}, "overall_errors": ["No files copied."]}

    # Phase 2: Verify
    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Phase 2 (Verify) for {len(hashes_copied_to_all_dests)} files.")
    fresh_meta, meta_errs = fetch_metadata(ctx, list(hashes_copied_to_all_dests))
    if meta_errs:
        for err in meta_errs:
            for h_err in err.get("hashes_in_batch", []):
                if h_err in hashes_copied_to_all_dests:
                    hashes_copied_to_all_dests.discard(h_err) # Verification failed
                    files_with_errors_map.setdefault(h_err, {"phase": "verify", "errors": []})["errors"].append({"message": f"Meta fetch fail: {err.get('message')}", "status_code": err.get("status_code")})

    hashes_verified_in_all_dests = set()
    dest_set_for_verification = set(rule_configured_destination_keys)
    for meta in fresh_meta:
        h = meta.get('hash')
        if not h or h not in hashes_copied_to_all_dests: continue
        current_services = set(meta.get('file_services', {}).get('current', {}).keys())
        if dest_set_for_verification.issubset(current_services):
            hashes_verified_in_all_dests.add(h)
        else:
            missing = dest_set_for_verification - current_services
            files_with_errors_map.setdefault(h, {"phase": "verify", "errors": []})["errors"].append({"message": f"Verify fail. Missing in rule's configured destinations: {missing}. Current services: {current_services}"})
    verified_count = len(hashes_verified_in_all_dests)
    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Phase 2 (Verify) complete. {verified_count} files verified.")
    if not hashes_verified_in_all_dests:
         return {"success": False, "files_fully_successful": [], "files_with_errors": files_with_errors_map, "summary_counts": {"initial_candidates":initial_candidates, "copied_phase_success_count":copied_count, "verified_phase_success_count":0, "deleted_phase_success_count":0}, "overall_errors": ["No files verified."]}

    # Phase 3: Delete from other local services
    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Phase 3 (Delete from others) for {len(hashes_verified_in_all_dests)} files.")
    deletions_by_service = {}
    meta_map_verified = {m['hash']: m for m in fresh_meta if m.get('hash') in hashes_verified_in_all_dests}

    for h_verified in list(hashes_verified_in_all_dests):
        meta_obj = meta_map_verified.get(h_verified)
        if not meta_obj:
            logger.warning(f"Rule '{ctx.rule_name}': Missing fresh metadata for verified hash {h_verified} during delete prep.")
            hashes_verified_in_all_dests.discard(h_verified)
            files_with_errors_map.setdefault(h_verified, {"phase": "delete_prep", "errors": []})["errors"].append({"message": "Missing fresh metadata for delete."})
            continue
        current_services = set(meta_obj.get('file_services', {}).get('current', {}).keys())
        to_delete_from = (current_services.intersection(all_local_service_keys_set)) - set(rule_configured_destination_keys)
        for sk_del in to_delete_from:
            deletions_by_service.setdefault(sk_del, []).append(h_verified)

    hashes_deleted_successfully_from_extras = set(hashes_verified_in_all_dests)
    for service_key_del, hashes_on_service in deletions_by_service.items():
        if not hashes_on_service or not hashes_deleted_successfully_from_extras: break
        delete_results = batch_api_call_with_retry(
            ctx, '/add_files/delete_files', 'POST',
            [h for h in hashes_on_service if h in hashes_deleted_successfully_from_extras], batch_size,
            lambda bh: {"hashes": bh, "file_service_key": service_key_del},
            lambda sh: {"hash": sh, "file_service_key": service_key_del},
            f"ForceIn-Delete from '{service_key_del}'", timeout_per_call=180
        )
        for h, msg, status in delete_results["failed_items_with_errors"]:
            hashes_deleted_successfully_from_extras.discard(h)
            files_with_errors_map.setdefault(h, {"phase": "delete", "errors": []})["errors"].append({"service_key": service_key_del, "message": f"Delete fail: {msg}", "status_code": status})

    files_fully_successful = []
    deleted_phase_count = 0
    for h_v in hashes_verified_in_all_dests:
        needed_del = any(h_v in h_list for h_list in deletions_by_service.values())
        if not needed_del:
            files_fully_successful.append(h_v)
            deleted_phase_count +=1
        elif h_v in hashes_deleted_successfully_from_extras:
            files_fully_successful.append(h_v)
            deleted_phase_count +=1

    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Phase 3 (Delete) complete. {deleted_phase_count} successful cleanups from other local services.")
    logger.info(f"Rule '{ctx.rule_name}': ForceIn - Overall: {len(files_fully_successful)} fully successful.")

    final_success = (len(files_with_errors_map) == 0 and len(files_fully_successful) == initial_candidates)
    return {"success": final_success, "files_fully_successful": files_fully_successful, "files_with_errors": files_with_errors_map,
            "summary_counts": {"initial_candidates":initial_candidates, "copied_phase_success_count":copied_count, "verified_phase_success_count":verified_count, "deleted_phase_success_count":deleted_phase_count},
            "overall_errors": []}


def manage_tags(ctx: RuleExecutionContext, file_hashes: List[str], tag_service_key: str, tags_to_process: List[str], action_mode: int) -> Dict[str, Any]:
    """Performs tag management (add/remove)."""
    if not file_hashes: return {"success": True, "message": "No files for tag action.", "files_processed_count": 0, "errors": []}
    if not tag_service_key: return {"success": False, "message": "Tag service key missing.", "files_processed_count": 0, "errors": ["Missing tag_service_key."]}
    if not tags_to_process: return {"success": True, "message": "No tags specified.", "files_processed_count": len(file_hashes), "errors": []}

    settings = ctx.app_config.get('HYDRUS_SETTINGS', {})
    api_address = settings.get('hydrus_api_url') or settings.get('api_address')
    api_key = settings.get('hydrus_api_key') or settings.get('api_key')
    if not api_address: return {"success": False, "message": "API address not set for tag action.", "files_processed_count": 0, "errors": ["API address not configured."]}

    action_str = "add" if action_mode == 0 else "remove"
    logger.info(f"Rule '{ctx.rule_name}': '{action_str} tags' for {len(file_hashes)} files on service '{tag_service_key}'. Tags: {tags_to_process}")
    payload = {
        "hashes": file_hashes,
        "service_keys_to_actions_to_tags": {tag_service_key: {str(action_mode): tags_to_process}}
    }
    if action_mode == 0: payload["override_previously_deleted_mappings"] = True
    else: payload["create_new_deleted_mappings"] = True

    result, status = call_hydrus_api(api_address, api_key, '/add_tags/add_tags', method='POST', json_data=payload, timeout=120)
    if result.get("success"):
        msg = f"Successfully sent '{action_str} tags' request for {len(file_hashes)} files to '{tag_service_key}'."
        return {"success": True, "message": msg, "files_processed_count": len(file_hashes), "errors": []}
    else:
        err_msg = f"Failed to {action_str} tags for {len(file_hashes)} files on '{tag_service_key}': {result.get('message', 'API error')}"
        logger.warning(f"Rule '{ctx.rule_name}': {err_msg}")
        return {"success": False, "message": err_msg, "files_processed_count": len(file_hashes), "errors": [{"message": err_msg, "status_code": status}]}


def modify_rating(ctx: RuleExecutionContext, file_hash: str, rating_service_key: str, rating_value) -> Dict[str, Any]:
    """Performs 'modify_rating' action."""
    if not file_hash: return {"success": False, "message": "File hash missing for rating.", "errors": ["File hash missing."]}
    if not rating_service_key: return {"success": False, "message": "Rating service key missing.", "errors": ["Rating service key missing."]}

    settings = ctx.app_config.get('HYDRUS_SETTINGS', {})
    api_address = settings.get('hydrus_api_url') or settings.get('api_address')
    api_key = settings.get('hydrus_api_key') or settings.get('api_key')
    if not api_address: return {"success": False, "message": "API address not set for rating action.", "errors": ["API address not configured."]}

    logger.info(f"Rule '{ctx.rule_name}': Modifying rating for {file_hash} on '{rating_service_key}' to {rating_value}.")
    payload = {"hash": file_hash, "rating_service_key": rating_service_key, "rating": rating_value}
    result, status = call_hydrus_api(api_address, api_key, '/edit_ratings/set_rating', method='POST', json_data=payload, timeout=60)

    if result.get("success"):
        msg = f"Successfully set rating for {file_hash} on '{rating_service_key}' to '{rating_value}'."
        return {"success": True, "message": msg, "errors": []}
    else:
        err_msg = f"Failed to set rating for {file_hash} on '{rating_service_key}': {result.get('message', 'API error')}"
        logger.warning(f"Rule '{ctx.rule_name}': {err_msg}")
        return {"success": False, "message": err_msg, "errors": [{"message": err_msg, "status_code": status}]}