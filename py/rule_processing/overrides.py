# rule_processing/overrides.py
"""
Manages rule override logic and state updates.

This module is responsible for the conflict resolution system. It interacts with
the `files` table in the database to determine if a rule's action on a specific
file should be skipped due to a higher-priority rule's previous action. It also
handles the logic for updating a file's state in the database after an action
has been successfully performed.
"""

import json
import logging
from datetime import datetime
from typing import Tuple, Dict, Any, Optional

from .context import RuleExecutionContext

logger = logging.getLogger(__name__)


def check_override(ctx: RuleExecutionContext, file_hash: str) -> Tuple[str, Optional[str]]:
    """
    Checks if the current rule should be skipped for a file due to override logic.

    This function queries the `files` state table and applies the conflict
    resolution logic based on rule type and priority.

    Args:
        ctx: The RuleExecutionContext for the current rule.
        file_hash: The hash of the file to check.

    Returns:
        A tuple containing:
        - A status string: 'run' or 'skipped'.
        - A reason string if skipped, otherwise None.
    """
    # If the user explicitly chose to bypass overrides for this rule, do so.
    if ctx.rule_id in ctx.override_bypass_list:
        return ('run', 'Override bypassed by user for manual run.')

    # If the rule type doesn't use the override system, just run it.
    if ctx.action_type not in ['add_to', 'force_in', 'modify_rating']:
        return ('run', 'Action type does not use the override system.')

    cursor = ctx.db_conn.cursor()
    cursor.execute("SELECT * FROM files WHERE file_hash = ?", (file_hash,))
    file_state_row = cursor.fetchone()

    # If file is not in the state table, no overrides apply yet.
    if not file_state_row:
        return ('run', 'File is not yet tracked in the override system.')

    # Load state from the DB row
    try:
        force_in_priority_governance = file_state_row['force_in_priority_governance']
        rating_priority_governance = json.loads(file_state_row['rating_priority_governance'])
    except (KeyError, json.JSONDecodeError) as e:
        logger.warning(f"Could not parse state for file {file_hash[:8]}. Allowing run. Error: {e}")
        return ('run', 'File has corrupted state data.')

    # Apply override logic based on the current rule's action type
    run_action = False
    skip_reason = ""

    if ctx.action_type == 'modify_rating':
        rating_service_key = ctx.action.get('rating_service_key')
        if not rating_service_key: # Should be caught by orchestrator, but as a safeguard
             return ('run', 'Modify_rating action is missing a service key.')

        winning_priority = rating_priority_governance.get(rating_service_key, -1) # Use -1 to allow priority 0 rules
        if ctx.rule_importance > winning_priority:
            run_action = True
        else:
            skip_reason = f"A rule with priority {winning_priority} or higher has already won for this rating service."

    elif ctx.action_type == 'add_to':
        # 'add_to' can run if its priority is >= any winning 'force_in' rule.
        # This allows adding to multiple services, but prevents adding to a service if a
        # 'force_in' rule has decided the file should *only* be somewhere else.
        if ctx.rule_importance >= force_in_priority_governance:
            run_action = True
        else:
            skip_reason = f"A 'force_in' rule with higher priority ({force_in_priority_governance}) governs this file's placement."

    elif ctx.action_type == 'force_in':
        # A 'force_in' rule can only run if its priority is strictly greater than
        # any existing 'force_in' rule that has already run on the file.
        if ctx.rule_importance > force_in_priority_governance:
            run_action = True
        else:
            skip_reason = f"Another 'force_in' rule with priority {force_in_priority_governance} or higher has already won."

    if run_action:
        return ('run', None)
    else:
        logger.debug(f"SKIP file {file_hash[:8]} for rule {ctx.rule_id[:8]}. Reason: {skip_reason}")
        return ('skipped', skip_reason)


def update_state_after_success(ctx: RuleExecutionContext, file_hash: str):
    """
    Updates the `files` table for a file after a managed action was successful.

    This function should only be called after an action has successfully completed
    and the transaction is ready to be committed.

    Args:
        ctx: The RuleExecutionContext for the rule that just ran.
        file_hash: The hash of the file whose state needs updating.
    """
    if ctx.action_type not in ['add_to', 'force_in', 'modify_rating']:
        # Do not update state for manual runs or unmanaged actions
        return

    cursor = ctx.db_conn.cursor()
    cursor.execute("SELECT * FROM files WHERE file_hash = ?", (file_hash,))
    file_state_row = cursor.fetchone()

    # --- 1. Initialize State ---
    # Either load existing state or create a fresh default state
    if file_state_row:
        try:
            state = {
                'rules_in_application': json.loads(file_state_row['rules_in_application']),
                'force_in_priority_governance': file_state_row['force_in_priority_governance'],
                'correct_placement': json.loads(file_state_row['correct_placement']),
                'affected_rating_services': json.loads(file_state_row['affected_rating_services']),
                'rating_priority_governance': json.loads(file_state_row['rating_priority_governance']),
            }
        except (KeyError, json.JSONDecodeError):
            # If data is corrupt, start fresh
            state = _get_default_file_state()
    else:
        state = _get_default_file_state()

    # --- 2. Mutate State based on the successful action ---
    # Ensure current rule ID is tracked
    if ctx.rule_id not in state['rules_in_application']:
        state['rules_in_application'].append(ctx.rule_id)

    # Apply state changes based on action type
    if ctx.action_type == 'modify_rating':
        rating_service_key = ctx.action.get('rating_service_key')
        if rating_service_key:
            if rating_service_key not in state['affected_rating_services']:
                state['affected_rating_services'].append(rating_service_key)
            state['rating_priority_governance'][rating_service_key] = ctx.rule_importance

    elif ctx.action_type == 'add_to':
        # We only care about the *first* destination key for placement logic, as per design.
        # But a rule can have multiple destinations, so we iterate.
        dest_keys = ctx.action.get('destination_service_keys', [])
        for key in dest_keys:
            if key and key not in state['correct_placement']:
                state['correct_placement'].append(key)

    elif ctx.action_type == 'force_in':
        # 'force_in' is decisive: it overwrites previous placements and sets the governance priority.
        dest_keys = ctx.action.get('destination_service_keys', [])
        state['correct_placement'] = [key for key in dest_keys if key] # Set placement to only this rule's destinations
        state['force_in_priority_governance'] = ctx.rule_importance

    # --- 3. Write Updated State to DB ---
    cursor.execute('''
        INSERT OR REPLACE INTO files (
            file_hash, rules_in_application, force_in_priority_governance,
            correct_placement, affected_rating_services, rating_priority_governance, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        file_hash,
        json.dumps(state['rules_in_application']),
        state['force_in_priority_governance'],
        json.dumps(state['correct_placement']),
        json.dumps(state['affected_rating_services']),
        json.dumps(state['rating_priority_governance']),
        datetime.utcnow().isoformat() + "Z"
    ))


def _get_default_file_state() -> Dict[str, Any]:
    """Returns a dictionary representing the default state for a new file."""
    return {
        'rules_in_application': [],
        'force_in_priority_governance': -1, # Start at -1 so priority 0 rules can win
        'correct_placement': [],
        'affected_rating_services': [],
        'rating_priority_governance': {},
    }